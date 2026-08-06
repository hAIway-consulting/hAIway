-- Migration: drop the process / mapping data model (audit 2026-08-06)
--
-- DEPLOY NOTE: like 20260806100000/110000/120000/130000/150000 this file is
-- committed but NOT pushed automatically. It drops customer data (process
-- templates, process instances, external-id mappings, KPI baselines), so take
-- a dump of the six tables before `supabase db push` if any of them still
-- carries rows:
--   pg_dump ... -t public.process_templates -t public.process_template_steps \
--               -t public.process_instances -t public.process_instance_steps \
--               -t public.entity_mappings   -t public.kpi_baselines
--
-- The 2026-08-06 audit struck the process and entity-mapping model. The
-- earlier cleanup commit removed only the TypeScript side
-- (lib/db/queries/{activities,processes}.ts, lib/constants/{activities,
-- processes}.ts, the Zod schemas); the tables, their policies, indexes,
-- triggers and the analysis RPCs stayed behind. This migration finishes the
-- job.
--
-- VERIFIED CALLER-FREE (grep over apps/web/src, supabase/functions, scripts,
-- e2e) for every object dropped below. The only remaining mentions were the
-- two ops wipe scripts (scripts/ops/_lib.mjs,
-- scripts/dev-loop/cleanup-test-org.mjs), which are updated in the same
-- commit, and the schema listing in supabase/CLAUDE.md.
--
-- KEPT ON PURPOSE:
--   public.activities / public.activity_links — supabase/functions/
--     phone-assistant-call-complete writes call activities there and
--     get_caller_context reads them for the caller briefing.
--   public.get_caller_context — kept, but recreated below without its
--     process_instances lookup (section 3).
--   public.kpi_events + record_kpi_event — the phone assistant still writes
--     them; only the never-read `kpi_baselines` comparison table goes.
--   public.connector_sync_log + get_connector_sync_stats — unrelated to
--     entity_mappings, still fed by the connectors.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CALLER-LESS RPCs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dropped before the tables so the drop order documents the dependency
-- (every one of them reads a table removed in section 2).
--
--   get_process_analysis      20260402150000:135
--   get_template_performance  20260402150000:171
--   get_process_dashboard     20260402150000:243
--   get_activities_for_entity 20260402140000:62   (reads activities, but the
--                                                  timeline UI that called it
--                                                  is gone — zero callers)
--   get_activity_links_resolved 20260402140000:89 (same)
--   get_kpi_summary           20260405100000:194
--   get_external_entity       20260405100000:89

DROP FUNCTION IF EXISTS public.get_process_analysis(UUID);
DROP FUNCTION IF EXISTS public.get_template_performance(UUID, UUID);
DROP FUNCTION IF EXISTS public.get_process_dashboard(UUID);
DROP FUNCTION IF EXISTS public.get_activities_for_entity(TEXT, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.get_activity_links_resolved(UUID);
DROP FUNCTION IF EXISTS public.get_kpi_summary(UUID, INT);

-- get_external_entity was hardened by 20260806130000 §2c (search_path +
-- REVOKE) while that migration noted it had zero callers. The hardening block
-- is removed from 20260806130000 in the same commit, so no earlier migration
-- locks down a function this one deletes.
DROP FUNCTION IF EXISTS public.get_external_entity(UUID, TEXT, TEXT, UUID);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. TABLES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Children before parents. CASCADE also removes the attached indexes
-- (idx_process_templates_org, idx_template_steps_template,
-- idx_process_instances_org/_project/_company, idx_instance_steps_instance,
-- idx_entity_mappings_org/_local/_external), the updated_at triggers
-- (set_updated_at_process_templates, set_updated_at_process_instances,
-- set_updated_at_entity_mappings) and the RLS policies
-- (process_templates_org_all, process_template_steps_org_all,
-- process_instances_org_all, process_instance_steps_org_all,
-- entity_mappings_org_all, kpi_baselines_org_all).

DROP TABLE IF EXISTS public.process_instance_steps CASCADE;
DROP TABLE IF EXISTS public.process_instances      CASCADE;
DROP TABLE IF EXISTS public.process_template_steps CASCADE;
DROP TABLE IF EXISTS public.process_templates      CASCADE;
DROP TABLE IF EXISTS public.entity_mappings        CASCADE;
DROP TABLE IF EXISTS public.kpi_baselines          CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. get_caller_context WITHOUT THE PROCESS LOOKUP
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260405100000:254ff queried process_instances for the "Offene Prozesse"
-- line of the caller briefing. With the table gone the function would fail at
-- runtime, so it is recreated without that block and without the now-empty
-- `open_processes` output column. Contact match, recent activities and the
-- next appointment are byte-identical to the original body.
--
-- The return type changes, so CREATE OR REPLACE is not enough — DROP first.
-- That also drops the grants from 20260806130000 §2b, which are re-applied
-- at the end of this section.
--
-- Sole caller: supabase/functions/phone-assistant-rag/index.ts
-- (getCallerContextFromDB, service client). Its CallerContext type and the
-- "Offene Prozesse" briefing line are removed in the same commit.

DROP FUNCTION IF EXISTS public.get_caller_context(UUID, TEXT);

CREATE FUNCTION public.get_caller_context(
  p_org_id UUID,
  p_caller_number TEXT
)
RETURNS TABLE (
  contact_id UUID,
  contact_name TEXT,
  company_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  recent_activities JSONB,
  next_appointment JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contact_id UUID;
  v_contact_name TEXT;
  v_company_name TEXT;
  v_contact_email TEXT;
  v_contact_phone TEXT;
  v_recent_activities JSONB;
  v_next_appointment JSONB;
BEGIN
  -- Match caller to contact
  SELECT c.id, CONCAT(c.first_name, ' ', c.last_name), co.name, c.email, c.phone
  INTO v_contact_id, v_contact_name, v_company_name, v_contact_email, v_contact_phone
  FROM public.contacts c
  LEFT JOIN public.companies co ON co.id = c.company_id
  WHERE c.organization_id = p_org_id
    AND c.phone IS NOT NULL
    AND (
      c.phone = p_caller_number
      OR REPLACE(REPLACE(REPLACE(c.phone, ' ', ''), '-', ''), '+', '') =
         REPLACE(REPLACE(REPLACE(p_caller_number, ' ', ''), '-', ''), '+', '')
    )
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    RETURN;
  END IF;

  -- Last 3 activities linked to this contact
  SELECT COALESCE(jsonb_agg(row_to_json(a)::JSONB), '[]'::JSONB)
  INTO v_recent_activities
  FROM (
    SELECT a.title, a.activity_type, a.description,
           TO_CHAR(a.occurred_at, 'DD.MM.YYYY') AS date
    FROM public.activities a
    JOIN public.activity_links al ON al.activity_id = a.id
    WHERE al.linked_type = 'contact' AND al.linked_id = v_contact_id
      AND a.organization_id = p_org_id
    ORDER BY a.occurred_at DESC
    LIMIT 3
  ) a;

  -- Next upcoming appointment recorded as an activity
  SELECT row_to_json(apt)::JSONB
  INTO v_next_appointment
  FROM (
    SELECT a.title, TO_CHAR(a.occurred_at, 'DD.MM.YYYY HH24:MI') AS datetime
    FROM public.activities a
    JOIN public.activity_links al ON al.activity_id = a.id
    WHERE al.linked_type = 'contact' AND al.linked_id = v_contact_id
      AND a.organization_id = p_org_id
      AND a.activity_type = 'appointment'
      AND a.occurred_at > now()
    ORDER BY a.occurred_at ASC
    LIMIT 1
  ) apt;

  RETURN QUERY SELECT
    v_contact_id, v_contact_name, v_company_name, v_contact_email,
    v_contact_phone, v_recent_activities, v_next_appointment;
END;
$$;

-- Same grants as 20260806130000 §2b: service role only.
REVOKE ALL ON FUNCTION public.get_caller_context(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_caller_context(UUID, TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. FEATURE FLAG 'process_management'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Seeded by 20260402150000:285 and mapped onto premium + enterprise by
-- 20260404100000:90/106. hasFeature() was never called with it (the only keys
-- in the code are 'crm_workspace', 'phone_assistant' and 'agent_mode'), so it
-- was a dead toggle in /admin/kunden/[id] and /organisation even before the
-- tables went. Both FKs are ON DELETE CASCADE — the DELETEs are spelled out
-- so the migration documents itself.

DELETE FROM public.plan_tier_features    WHERE feature_key = 'process_management';
DELETE FROM public.organization_features WHERE feature_key = 'process_management';
DELETE FROM public.feature_flags         WHERE key = 'process_management';
