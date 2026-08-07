-- Migration: drop the automation complex (audit 2026-08-06)
--
-- The 2026-08-06 feature audit rated the whole automation complex
-- ("Reklamations-Orchestrator", automation templates, workflow runs and the
-- derived time_saved KPI) as "neu aufrollen": it never had a real trigger —
-- only a manual button plus a demo-ticket generator — and it produced a
-- second, competing source of truth for saved time next to kpi_events.
-- The application code (routes /automatisierungen, /admin/automatisierungen,
-- /admin/cockpit/automatisierungen, /admin/bibliothek/automatisierungen,
-- lib/orchestrator/run-complaint.ts, lib/db/queries/workflows.ts and the
-- agent tools get_automation_overview / list_complaint_cases) is removed in
-- the same change, so nothing reads or writes these objects any more.
--
-- KEPT ON PURPOSE: public.kpi_events plus record_kpi_event() and
-- get_phone_kpis() — the phone assistant is their remaining producer and
-- consumer. Shared helpers (set_updated_at, is_member_of_org,
-- is_platform_admin, is_org_admin) are untouched.

-- ─── TRIGGERS ───────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_workflow_runs_time_saved ON public.workflow_runs;

-- ─── FUNCTIONS ──────────────────────────────────────────────────────────
-- record_time_saved_kpi() selects from public.automations, so it has to go
-- before the table drops below.

DROP FUNCTION IF EXISTS public.record_time_saved_kpi();
DROP FUNCTION IF EXISTS public.get_workflow_kpi(UUID, TEXT, INT);

-- ─── INDEXES ────────────────────────────────────────────────────────────
-- Partial index on kpi_events that only served the idempotency guard of the
-- trigger above; kpi_events itself and its other indexes stay.

DROP INDEX IF EXISTS public.idx_kpi_events_time_saved_run;

-- ─── DATA CLEANUP ───────────────────────────────────────────────────────
-- Every 'time_saved' row was written by the dropped trigger (largely from
-- the demo-ticket generator). The phone assistant's event types
-- ('call_handled', 'time_saved_seconds') are not affected.

DELETE FROM public.kpi_events WHERE event_type = 'time_saved';

-- ─── TABLES ─────────────────────────────────────────────────────────────
-- automations.template_id references automation_templates(id), so the child
-- table is dropped first. CASCADE also removes the attached indexes,
-- updated_at triggers and RLS policies.

DROP TABLE IF EXISTS public.workflow_runs CASCADE;
DROP TABLE IF EXISTS public.automations CASCADE;
DROP TABLE IF EXISTS public.automation_templates CASCADE;

-- ─── FEATURE FLAGS ──────────────────────────────────────────────────────
-- No dedicated 'automations' feature flag ever existed — nothing to remove
-- from feature_flags / plan_tier_features / organization_features here.
