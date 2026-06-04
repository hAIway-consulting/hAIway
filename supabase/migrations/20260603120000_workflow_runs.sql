-- Migration: workflow_runs
--
-- Orchestrator run tracking ("Tickets"). One row = one cross-system workflow
-- run (e.g. Shopware complaint -> Trello card). Distinct from integration_runs
-- (per-connector SYNC observability, provider-scoped) — an orchestrator run is
-- a glue-layer outcome with its own audit trail + KPIs for the Berater cockpit.

-- ─── TABLE ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_key    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'failed')),
  trigger         TEXT NOT NULL DEFAULT 'manual'
                    CHECK (trigger IN ('manual', 'simulated')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INT,
  -- ordered list of executed tasks: [{ key, label, status, detail }]
  steps           JSONB NOT NULL DEFAULT '[]',
  -- shopware refs: { product_id, product_name, customer_id, customer_name, ... }
  source_ref      JSONB,
  -- trello refs: { card_id, url, name }
  target_ref      JSONB,
  error_message   TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_org_started
  ON public.workflow_runs (organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_failed
  ON public.workflow_runs (organization_id, started_at DESC)
  WHERE status = 'failed';

-- ─── RLS ────────────────────────────────────────────────────────────────
-- Read for org members; writes go through the service-role client in the
-- server action (bypasses RLS), mirroring integration_runs.

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_runs_read" ON public.workflow_runs;
CREATE POLICY "workflow_runs_read" ON public.workflow_runs
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── KPI FUNCTION ───────────────────────────────────────────────────────
-- Aggregated outcome KPIs for the Berater cockpit. p_workflow_key NULL =
-- across all workflows of the org.

CREATE OR REPLACE FUNCTION public.get_workflow_kpi(
  p_org_id       UUID,
  p_workflow_key TEXT DEFAULT NULL,
  p_days         INT  DEFAULT 30
)
RETURNS TABLE (
  total           BIGINT,
  success         BIGINT,
  failed          BIGINT,
  running         BIGINT,
  last_run_at     TIMESTAMPTZ,
  avg_duration_ms NUMERIC
)
-- Invoker rights: RLS on workflow_runs applies, so callers only aggregate
-- their own org's runs even though p_org_id is an explicit argument.
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE status = 'success')::BIGINT,
    COUNT(*) FILTER (WHERE status = 'failed')::BIGINT,
    COUNT(*) FILTER (WHERE status = 'running')::BIGINT,
    MAX(started_at),
    ROUND(AVG(duration_ms) FILTER (WHERE status = 'success')::NUMERIC, 0)
  FROM public.workflow_runs
  WHERE organization_id = p_org_id
    AND (p_workflow_key IS NULL OR workflow_key = p_workflow_key)
    AND started_at >= NOW() - (p_days || ' days')::INTERVAL;
$$;
