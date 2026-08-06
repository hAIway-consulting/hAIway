-- Migration: security_hardening_and_schema_repair (audit 2026-08-06)
--
-- DEPLOY NOTE: this migration is committed but deliberately NOT pushed as part
-- of the cleanup commit. It revokes privileges, replaces RLS policies and drops
-- a dead Silver table — every one of those is observable in production the
-- second it lands. Apply it as its own, conscious `supabase db push` step and
-- verify afterwards:
--   * phone assistant: inbound call -> caller briefing -> slot search -> booking
--   * /quellen and /admin/integrationen still render the connection list
--   * connector delta syncs still run (needs 20260806100000 deployed first)
--
-- Six independent concerns, all idempotent (CREATE OR REPLACE / IF EXISTS /
-- IF NOT EXISTS / DROP POLICY IF EXISTS before CREATE POLICY):
--
--   1. Auth helpers used by the rest of this file.
--   2. SECURITY DEFINER RPCs that shipped without any authorisation check and
--      without a REVOKE, i.e. executable by every logged-in user for an
--      arbitrary organisation UUID. The worst one, get_org_integration(),
--      returned the raw credentials JSONB (OAuth refresh tokens, the Twenty
--      service password, the Trello token).
--   3. organization_integrations.credentials was readable by every org member
--      through plain RLS. RLS cannot filter columns, so the fix is a
--      column-level GRANT.
--   4. The folder permission model handed FOR ALL to every org member — a
--      regular member could add themselves to any permission group and thereby
--      read every restricted folder.
--   5. Entity extraction has been dead since 20260510120000 dropped tags /
--      entity_tags: four RPCs still reference those tables.
--   6. Schema drift (organizations.settings) plus the cron/Silver-table
--      cleanup for the calendar ingest that nobody reads.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. AUTH HELPERS
-- ═══════════════════════════════════════════════════════════════════════════

-- Inside a SECURITY DEFINER function `current_user` is always the function
-- owner, so it cannot be used to tell a service-role call from a user call.
-- PostgREST does leave the caller's role behind in two places: the JWT claim
-- and the `role` GUC set by SET ROLE (SECURITY DEFINER does not reset it).
--
-- No request context at all (pg_cron, psql, migrations, triggers) means the
-- call is server-side and trusted -> TRUE.
CREATE OR REPLACE FUNCTION public.is_service_request()
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role   TEXT;
  v_claims TEXT;
BEGIN
  v_role := NULLIF(current_setting('request.jwt.claim.role', TRUE), '');

  IF v_role IS NULL THEN
    v_claims := NULLIF(current_setting('request.jwt.claims', TRUE), '');
    IF v_claims IS NOT NULL THEN
      BEGIN
        v_role := v_claims::JSONB ->> 'role';
      EXCEPTION WHEN OTHERS THEN
        v_role := NULL;
      END;
    END IF;
  END IF;

  -- 'none' is the default value of the role GUC outside a PostgREST request.
  IF v_role IS NULL THEN
    v_role := NULLIF(NULLIF(current_setting('role', TRUE), ''), 'none');
  END IF;

  IF v_role IS NULL THEN
    RETURN TRUE;
  END IF;

  RETURN v_role = 'service_role';
END;
$$;

REVOKE ALL ON FUNCTION public.is_service_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_service_request() TO authenticated, service_role;

-- Write check for the folder / permission model. Role list mirrors
-- BERATER_ROLES in apps/web/src/lib/db/org-context.ts:13 and the nav gate in
-- components/layout/nav-berater.tsx — deliberately NOT is_org_admin(), which
-- only knows admin/owner and would lock out the 'manager' and 'berater' roles
-- introduced by 20260611150000_org_roles_manager_berater.sql.
CREATE OR REPLACE FUNCTION public.is_org_berater(target_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = target_org_id
      AND m.user_id = (SELECT auth.uid())
      AND m.role IN ('admin', 'owner', 'manager', 'berater')
  ) OR public.is_platform_admin();
$$;

REVOKE ALL ON FUNCTION public.is_org_berater(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_berater(UUID) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LOCK DOWN THE UNGUARDED SECURITY DEFINER RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 2a. get_org_integration — CRITICAL ────────────────────────────────────
--
-- 20260404100000:241-262 defined it as LANGUAGE sql SECURITY DEFINER with no
-- membership check and no REVOKE. Every authenticated user could pass any
-- organisation UUID and receive that org's credentials JSONB: Google/Microsoft
-- refresh tokens, the Twenty api_key + service password, the Trello token.
--
-- Signature and RETURNS TABLE stay byte-identical; only the body gains a
-- guard. Sole caller is supabase/functions/_shared/integration-registry.ts:23,
-- which runs on getServiceClient() -> is_service_request() is TRUE there.
-- The is_org_admin() branch keeps a future admin UI working without a second
-- round trip through the service client.
CREATE OR REPLACE FUNCTION public.get_org_integration(
  p_org_id UUID,
  p_provider_id TEXT
)
RETURNS TABLE (
  status TEXT,
  credential_mode TEXT,
  credentials JSONB,
  config JSONB,
  error_message TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_service_request() OR public.is_org_admin(p_org_id)) THEN
    RAISE EXCEPTION 'get_org_integration: not authorised for organisation %', p_org_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    oi.status,
    oi.credential_mode,
    oi.credentials,
    oi.config,
    oi.error_message
  FROM public.organization_integrations oi
  WHERE oi.organization_id = p_org_id
    AND oi.provider_id = p_provider_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_integration(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_integration(UUID, TEXT) TO authenticated, service_role;

-- ─── 2b. get_caller_context ────────────────────────────────────────────────
--
-- 20260405100000:254ff — SECURITY DEFINER, no search_path, no authorisation.
-- Returns contact data, recent activities, open processes and the next
-- appointment for an arbitrary org. Sole caller:
-- supabase/functions/phone-assistant-rag/index.ts:1050 on getServiceClient().
-- The body is untouched so the phone assistant keeps its caller briefing.
ALTER FUNCTION public.get_caller_context(UUID, TEXT) SET search_path = public;
REVOKE ALL ON FUNCTION public.get_caller_context(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_caller_context(UUID, TEXT) TO service_role;

-- ─── 2c. get_external_entity ───────────────────────────────────────────────
--
-- 20260405100000:89-102 — SECURITY DEFINER without a check, hands out
-- entity_mappings.external_data for any org. It currently has zero callers
-- (grep over apps/web/src, supabase/functions, scripts, packages, e2e), so it
-- could equally be dropped; locking it down keeps the option of a future
-- mapping UI without another migration.
ALTER FUNCTION public.get_external_entity(UUID, TEXT, TEXT, UUID) SET search_path = public;
REVOKE ALL ON FUNCTION public.get_external_entity(UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_external_entity(UUID, TEXT, TEXT, UUID) TO service_role;

-- ─── 2d. record_kpi_event ──────────────────────────────────────────────────
--
-- 20260405100000:179-192 — SECURITY DEFINER, no search_path, EXECUTE for
-- PUBLIC: any user could forge kpi_events rows for a foreign org.
-- Callers are service-role only:
--   phone-assistant-call-complete/index.ts:296,311,322
--   phone-assistant-rag/index.ts:187
-- The second KPI writer, record_time_saved_kpi (20260611140000), writes into
-- kpi_events directly and does not go through this function.
ALTER FUNCTION public.record_kpi_event(UUID, TEXT, TEXT, NUMERIC, JSONB) SET search_path = public;
REVOKE ALL ON FUNCTION public.record_kpi_event(UUID, TEXT, TEXT, NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_kpi_event(UUID, TEXT, TEXT, NUMERIC, JSONB) TO service_role;

-- ─── 2e. replay_job_failure ────────────────────────────────────────────────
--
-- 20260406100000:182-205 granted EXECUTE to `authenticated`, so any user could
-- push a foreign org's dead-letter message back into the pgmq queue. The only
-- caller, apps/web/src/app/admin/integrationen/actions.ts:16, uses
-- createServiceClient() behind an isPlatformAdmin() gate — the authenticated
-- grant was never needed.
REVOKE ALL ON FUNCTION public.replay_job_failure(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_job_failure(UUID) TO service_role;

-- ─── 2f. start_integration_run ─────────────────────────────────────────────
--
-- 20260406100000:142-203, same over-broad grant: any user could create
-- integration_runs rows for a foreign org (observability spam). Sole caller is
-- supabase/functions/_shared/worker.ts:93 on getServiceClient(). Its
-- counterpart finish_integration_run was already service_role-only.
REVOKE ALL ON FUNCTION public.start_integration_run(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_integration_run(UUID, TEXT, TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. organization_integrations.credentials MUST NOT BE READABLE BY MEMBERS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Policy org_integrations_read (20260404100000:158-160) exposes the whole row —
-- including credentials — to every org member. RLS has no column granularity,
-- so the fix is a column-level GRANT: revoke the table-wide privileges from
-- anon/authenticated and hand back SELECT on everything except `credentials`.
-- The row filter stays with the existing RLS policy.
--
-- Verified against every user-client read of this table (the only two left):
--   apps/web/src/app/quellen/page.tsx:135-136
--     -> provider_id, status, last_synced_at, error_message, config
--   apps/web/src/app/admin/integrationen/page.tsx:92-93
--     -> provider_id, status, updated_at
-- Everything that touches `credentials` runs on createServiceClient() (which
-- bypasses RLS and column privileges): lib/orchestrator/credentials.ts:14,
-- lib/crm/twenty-sync.ts:43,85,91,162,168, lib/features/crm.ts:56,94,
-- lib/db/queries/admin.ts:284, app/admin/crm/{actions.ts,page.tsx},
-- app/admin/integrationen/trello/setup/*, app/quellen/actions.ts:72,291,324,
-- plus every Edge Function via get_org_integration().
--
-- CAUTION for future work: from here on, `select("*")` on this table with a
-- user client fails. New user-client queries must list columns explicitly.

REVOKE ALL ON TABLE public.organization_integrations FROM anon;
REVOKE ALL ON TABLE public.organization_integrations FROM authenticated;

GRANT SELECT (
  id,
  organization_id,
  provider_id,
  status,
  credential_mode,
  config,
  error_message,
  last_synced_at,
  created_at,
  updated_at,
  sync_locked_at,
  sync_locked_by
) ON public.organization_integrations TO authenticated;

-- The FOR ALL policy from 20260404100000:162-165 let every member overwrite
-- credentials. Replaced by admin-only write policies. Nothing breaks: every
-- write path in the app uses the service role, which bypasses RLS anyway.
-- These policies are defence in depth behind the revoked DML privileges.
DROP POLICY IF EXISTS "org_integrations_write" ON public.organization_integrations;

DROP POLICY IF EXISTS "org_integrations_insert" ON public.organization_integrations;
CREATE POLICY "org_integrations_insert" ON public.organization_integrations
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS "org_integrations_update" ON public.organization_integrations;
CREATE POLICY "org_integrations_update" ON public.organization_integrations
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS "org_integrations_delete" ON public.organization_integrations;
CREATE POLICY "org_integrations_delete" ON public.organization_integrations
  FOR DELETE USING (public.is_org_admin(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. FOLDER PERMISSIONS MUST NOT BE SELF-SERVICE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260413100000 gave every org member FOR ALL on all four permission tables.
-- Consequence: a regular member could insert themselves into any permission
-- group and thereby unlock every restricted folder — user_can_access_source()
-- and the sources read policy both resolve through permission_group_members.
--
-- Read stays open for all org members (the app reads these tables with the
-- user client: lib/db/queries/search.ts, app/admin/daten/page.tsx and the read
-- actions in app/berechtigungen/actions.ts). Write is Berater-only.

-- permission_groups
DROP POLICY IF EXISTS "org members write permission_groups" ON public.permission_groups;
DROP POLICY IF EXISTS "org berater insert permission_groups" ON public.permission_groups;
CREATE POLICY "org berater insert permission_groups"
  ON public.permission_groups FOR INSERT
  WITH CHECK (public.is_org_berater(organization_id));
DROP POLICY IF EXISTS "org berater update permission_groups" ON public.permission_groups;
CREATE POLICY "org berater update permission_groups"
  ON public.permission_groups FOR UPDATE
  USING (public.is_org_berater(organization_id))
  WITH CHECK (public.is_org_berater(organization_id));
DROP POLICY IF EXISTS "org berater delete permission_groups" ON public.permission_groups;
CREATE POLICY "org berater delete permission_groups"
  ON public.permission_groups FOR DELETE
  USING (public.is_org_berater(organization_id));

-- permission_group_members
DROP POLICY IF EXISTS "org members write permission_group_members" ON public.permission_group_members;
DROP POLICY IF EXISTS "org berater insert permission_group_members" ON public.permission_group_members;
CREATE POLICY "org berater insert permission_group_members"
  ON public.permission_group_members FOR INSERT
  WITH CHECK (public.is_org_berater(organization_id));
DROP POLICY IF EXISTS "org berater update permission_group_members" ON public.permission_group_members;
CREATE POLICY "org berater update permission_group_members"
  ON public.permission_group_members FOR UPDATE
  USING (public.is_org_berater(organization_id))
  WITH CHECK (public.is_org_berater(organization_id));
DROP POLICY IF EXISTS "org berater delete permission_group_members" ON public.permission_group_members;
CREATE POLICY "org berater delete permission_group_members"
  ON public.permission_group_members FOR DELETE
  USING (public.is_org_berater(organization_id));

-- source_folders — not named in the audit ticket, but the same defect
-- (20260413100000:78-80). Without it a member could rename or delete folders
-- and dismantle the access structure, which would make the other three fixes
-- pointless.
DROP POLICY IF EXISTS "org members write source_folders" ON public.source_folders;
DROP POLICY IF EXISTS "org berater insert source_folders" ON public.source_folders;
CREATE POLICY "org berater insert source_folders"
  ON public.source_folders FOR INSERT
  WITH CHECK (public.is_org_berater(organization_id));
DROP POLICY IF EXISTS "org berater update source_folders" ON public.source_folders;
CREATE POLICY "org berater update source_folders"
  ON public.source_folders FOR UPDATE
  USING (public.is_org_berater(organization_id))
  WITH CHECK (public.is_org_berater(organization_id));
DROP POLICY IF EXISTS "org berater delete source_folders" ON public.source_folders;
CREATE POLICY "org berater delete source_folders"
  ON public.source_folders FOR DELETE
  USING (public.is_org_berater(organization_id));

-- source_folder_access
DROP POLICY IF EXISTS "org members write source_folder_access" ON public.source_folder_access;
DROP POLICY IF EXISTS "org berater insert source_folder_access" ON public.source_folder_access;
CREATE POLICY "org berater insert source_folder_access"
  ON public.source_folder_access FOR INSERT
  WITH CHECK (public.is_org_berater(organization_id));
DROP POLICY IF EXISTS "org berater update source_folder_access" ON public.source_folder_access;
CREATE POLICY "org berater update source_folder_access"
  ON public.source_folder_access FOR UPDATE
  USING (public.is_org_berater(organization_id))
  WITH CHECK (public.is_org_berater(organization_id));
DROP POLICY IF EXISTS "org berater delete source_folder_access" ON public.source_folder_access;
CREATE POLICY "org berater delete source_folder_access"
  ON public.source_folder_access FOR DELETE
  USING (public.is_org_berater(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. REPAIR ENTITY EXTRACTION (dead since 20260510120000)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260510120000_drop_manual_tags.sql dropped public.tags and
-- public.entity_tags, but four RPCs from 20260416085324 still reference them:
--
--   delete_auto_extracted_by_source  DELETEs from entity_tags — and it is the
--     FIRST database call the worker makes after the LLM extraction
--     (worker-extract-entities/index.ts:236, with `if (delErr) throw delErr`).
--     Entity recognition has therefore been 100% dead, not merely degraded.
--   upsert_{company,contact,project}_from_extraction call ensure_entity_tag()
--     in a FOREACH loop over p_tags, which INSERTs into tags/entity_tags.
--
-- All four are redefined below with byte-identical signatures. p_tags stays in
-- the signature because worker-extract-entities/index.ts:241-275 passes it by
-- name on every call — it is simply ignored now. The rest of the bodies is
-- carried over 1:1 from 20260416085324_auto_entity_extraction.sql.
--
-- If tag-derived context ever comes back it belongs in the Silver layer as an
-- auto-derived, read-only attribute (see the note in 20260510120000).

CREATE OR REPLACE FUNCTION public.upsert_company_from_extraction(
  p_org_id           UUID,
  p_source_id        UUID,
  p_name             TEXT,
  p_website          TEXT,
  p_status           TEXT,
  p_extraction_model TEXT,
  p_tags             TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id    UUID;
  v_clean TEXT;
BEGIN
  v_clean := TRIM(p_name);
  IF v_clean = '' THEN RETURN NULL; END IF;

  -- Match by name (case-insensitive) within the org
  SELECT id INTO v_id
  FROM public.companies
  WHERE organization_id = p_org_id AND LOWER(name) = LOWER(v_clean)
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.companies (
      organization_id, name, website, status,
      source_id, extracted_at, extraction_model
    )
    VALUES (
      p_org_id, v_clean, NULLIF(p_website,''), COALESCE(NULLIF(p_status,''), 'active'),
      p_source_id, NOW(), p_extraction_model
    )
    RETURNING id INTO v_id;
  ELSE
    -- Existing row: only touch it if it is itself auto-extracted.
    -- Manual rows stay untouched (user wins).
    UPDATE public.companies
    SET website          = COALESCE(NULLIF(p_website,''), website),
        status           = COALESCE(NULLIF(p_status,''), status),
        source_id        = p_source_id,
        extracted_at     = NOW(),
        extraction_model = p_extraction_model,
        updated_at       = NOW()
    WHERE id = v_id
      AND extracted_at IS NOT NULL;
  END IF;

  -- p_tags is accepted for signature compatibility and intentionally ignored.
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_contact_from_extraction(
  p_org_id           UUID,
  p_source_id        UUID,
  p_first_name       TEXT,
  p_last_name        TEXT,
  p_email            TEXT,
  p_phone            TEXT,
  p_role_title       TEXT,
  p_status           TEXT,
  p_company_name     TEXT,
  p_extraction_model TEXT,
  p_tags             TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id           UUID;
  v_company_id   UUID;
  v_first        TEXT := TRIM(COALESCE(p_first_name, ''));
  v_last         TEXT := TRIM(COALESCE(p_last_name, ''));
  v_email_clean  TEXT := LOWER(NULLIF(TRIM(p_email), ''));
  v_phone_digits TEXT := NULLIF(REGEXP_REPLACE(COALESCE(p_phone,''), '[^0-9]', '', 'g'), '');
BEGIN
  IF v_first = '' AND v_last = '' THEN RETURN NULL; END IF;

  IF NULLIF(TRIM(COALESCE(p_company_name,'')), '') IS NOT NULL THEN
    v_company_id := public.upsert_company_from_extraction(
      p_org_id, p_source_id, p_company_name, NULL, NULL, p_extraction_model, ARRAY[]::TEXT[]
    );
  END IF;

  -- 1) match by email
  IF v_email_clean IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.contacts
    WHERE organization_id = p_org_id AND LOWER(email) = v_email_clean
    LIMIT 1;
  END IF;

  -- 2) match by normalized phone
  IF v_id IS NULL AND v_phone_digits IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.contacts
    WHERE organization_id = p_org_id
      AND REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', '', 'g') = v_phone_digits
    LIMIT 1;
  END IF;

  -- 3) match by (first_name, last_name) within same company
  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.contacts
    WHERE organization_id = p_org_id
      AND LOWER(first_name) = LOWER(v_first)
      AND LOWER(last_name)  = LOWER(v_last)
      AND (v_company_id IS NULL OR company_id IS NOT DISTINCT FROM v_company_id)
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.contacts (
      organization_id, company_id, first_name, last_name,
      email, phone, role_title, status,
      source_id, extracted_at, extraction_model
    )
    VALUES (
      p_org_id, v_company_id,
      COALESCE(NULLIF(v_first,''), 'Unbekannt'),
      COALESCE(NULLIF(v_last,''),  ''),
      NULLIF(TRIM(p_email),''),
      NULLIF(TRIM(p_phone),''),
      NULLIF(TRIM(p_role_title),''),
      COALESCE(NULLIF(p_status,''), 'active'),
      p_source_id, NOW(), p_extraction_model
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.contacts
    SET company_id       = COALESCE(v_company_id, company_id),
        email            = COALESCE(NULLIF(TRIM(p_email),''),      email),
        phone            = COALESCE(NULLIF(TRIM(p_phone),''),      phone),
        role_title       = COALESCE(NULLIF(TRIM(p_role_title),''), role_title),
        status           = COALESCE(NULLIF(p_status,''),           status),
        source_id        = p_source_id,
        extracted_at     = NOW(),
        extraction_model = p_extraction_model,
        updated_at       = NOW()
    WHERE id = v_id
      AND extracted_at IS NOT NULL;
  END IF;

  -- p_tags is accepted for signature compatibility and intentionally ignored.
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_project_from_extraction(
  p_org_id           UUID,
  p_source_id        UUID,
  p_name             TEXT,
  p_company_name     TEXT,
  p_status           TEXT,
  p_description      TEXT,
  p_extraction_model TEXT,
  p_tags             TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id         UUID;
  v_company_id UUID;
  v_clean      TEXT := TRIM(COALESCE(p_name, ''));
BEGIN
  IF v_clean = '' THEN RETURN NULL; END IF;

  IF NULLIF(TRIM(COALESCE(p_company_name,'')), '') IS NOT NULL THEN
    v_company_id := public.upsert_company_from_extraction(
      p_org_id, p_source_id, p_company_name, NULL, NULL, p_extraction_model, ARRAY[]::TEXT[]
    );
  END IF;

  SELECT id INTO v_id
  FROM public.projects
  WHERE organization_id = p_org_id AND LOWER(name) = LOWER(v_clean)
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.projects (
      organization_id, company_id, name, status, description,
      source_id, extracted_at, extraction_model
    )
    VALUES (
      p_org_id, v_company_id, v_clean,
      COALESCE(NULLIF(p_status,''), 'active'),
      NULLIF(TRIM(p_description),''),
      p_source_id, NOW(), p_extraction_model
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.projects
    SET company_id       = COALESCE(v_company_id, company_id),
        status           = COALESCE(NULLIF(p_status,''), status),
        description      = COALESCE(NULLIF(TRIM(p_description),''), description),
        source_id        = p_source_id,
        extracted_at     = NOW(),
        extraction_model = p_extraction_model,
        updated_at       = NOW()
    WHERE id = v_id
      AND extracted_at IS NOT NULL;
  END IF;

  -- p_tags is accepted for signature compatibility and intentionally ignored.
  RETURN v_id;
END;
$$;

-- Same file, same defect: the entity_tags DELETE at 20260416085324:345.
CREATE OR REPLACE FUNCTION public.delete_auto_extracted_by_source(
  p_org_id    UUID,
  p_source_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.contacts
  WHERE organization_id = p_org_id AND source_id = p_source_id AND extracted_at IS NOT NULL;

  DELETE FROM public.projects
  WHERE organization_id = p_org_id AND source_id = p_source_id AND extracted_at IS NOT NULL;

  DELETE FROM public.companies
  WHERE organization_id = p_org_id AND source_id = p_source_id AND extracted_at IS NOT NULL;
END;
$$;

-- CREATE OR REPLACE keeps existing grants; re-stated so the migration is
-- self-contained on a freshly built database.
GRANT EXECUTE ON FUNCTION public.upsert_company_from_extraction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_contact_from_extraction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_project_from_extraction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_auto_extracted_by_source(UUID, UUID) TO service_role;

-- No caller left, and it could only ever fail (tags / entity_tags are gone).
DROP FUNCTION IF EXISTS public.ensure_entity_tag(UUID, TEXT, UUID, TEXT);

-- 20260416120000:121-142 joins entity_tags + tags, so this RPC has thrown on
-- every call since 10.05. Its TypeScript wrapper has already been removed from
-- apps/web/src/lib/db/queries/search.ts.
DROP FUNCTION IF EXISTS public.list_entities_by_status(UUID, TEXT[], TEXT[], INTEGER);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. SCHEMA DRIFT + DEAD CALENDAR INGEST
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 6a. organizations.settings ────────────────────────────────────────────
--
-- The column exists in production but in no migration — a freshly built
-- database breaks in app/admin/ai-settings/{page.tsx,actions.ts},
-- app/admin/branding/*, lib/ai/chat.ts:85 and lib/ai/agent/config.ts:53.
-- Shape expected by the app: a JSON object with the keys `ai`
-- (system_prompt, tone, agent{provider, model, base_url}) and `branding`.
-- Every reader casts to Record<string, unknown> | null and falls back to {},
-- every writer does a read-modify-write of the whole object — so NOT NULL
-- DEFAULT '{}' matches the app and mirrors the neighbouring `metadata` column.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::JSONB;

-- SECURITY: adding the column re-arms a privilege escalation. saveAiSettings
-- (app/admin/ai-settings/actions.ts) writes settings.ai.agent.base_url with a
-- USER client and only checks requireOrgId() — no role check. base_url decides
-- where lib/ai/agent/config.ts sends agent requests, including the platform API
-- key. A plain member must therefore not be able to UPDATE organizations.
--
-- Nothing in the migration history ever created an UPDATE policy on
-- organizations (only "organizations_member_read", 20260401120000:217), which
-- means production carries a hand-made one. Drop whatever UPDATE/ALL policy is
-- there and replace it with an admin-only policy.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'organizations'
      AND cmd IN ('UPDATE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.organizations', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "organizations_admin_update" ON public.organizations
  FOR UPDATE USING (public.is_org_admin(id))
  WITH CHECK (public.is_org_admin(id));

-- ─── 6b. retire the google calendar ingest ─────────────────────────────────
--
-- Cron 'sync-google-calendar-15min' (20260406110000:129-140) fired the
-- sync-google-calendar Edge Function once per active calendar integration,
-- every 15 minutes, filling raw_events (Bronze) and — via worker-normalize —
-- public.entities_calendar_events (Silver).
--
-- entities_calendar_events had exactly one writer
-- (worker-normalize/index.ts:280) and zero readers anywhere in apps/web,
-- supabase/functions, scripts or e2e. It is a data graveyard, so the ingest is
-- removed rather than repaired. The Edge Function and the normalizer branch go
-- with it in the same commit.
--
-- VERIFIED SAFE FOR THE PHONE ASSISTANT: it reaches Google Calendar through a
-- completely different path — phone-assistant-rag/index.ts:853 calls
-- get_calendar_integration_for_org() (table calendar_integrations,
-- 20260403110000) and uses _shared/google-calendar.ts for slot search and
-- booking. sync-google-calendar/index.ts:9 states this itself ("does NOT
-- replace the existing _shared/google-calendar.ts helper"). Neither
-- calendar_integrations nor _shared/google-calendar.ts is touched here.

DO $$ BEGIN PERFORM cron.unschedule('sync-google-calendar-15min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Dropping the table too: with the cron and both writers gone it can only ever
-- hold a stale, unread copy of Google Calendar. Keeping it would invite
-- somebody to "revive" an ingest against a schema nobody validates. Nothing is
-- lost that cannot be re-synced from Google in seconds.
DROP TABLE IF EXISTS public.entities_calendar_events;
