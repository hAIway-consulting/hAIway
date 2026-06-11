-- Migration: time_saved_kpi (docs/spec-cockpit.md §10)
--
-- KPI v1 "eingesparte Zeit": the consultant sets minutes_saved_per_run on the
-- automations row; saved time = value × successful runs. Every workflow run
-- that reaches 'success' appends one kpi_events row (event_type 'time_saved',
-- value = minutes saved, existing table from the KPI engine migration
-- 20260405100000). Finer measurement models can replace the per-run value
-- later without a schema break — consumers only aggregate kpi_events.

-- ─── TRIGGER FUNCTION ───────────────────────────────────────────────────
-- SECURITY DEFINER: workflow_runs rows are written via the service role, but
-- the function must also work if a future writer runs with invoker rights
-- (kpi_events has no INSERT policy path for plain members on other orgs).

CREATE OR REPLACE FUNCTION public.record_time_saved_kpi()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_minutes NUMERIC;
BEGIN
  -- Only react when a run reaches 'success': INSERT already successful, or
  -- UPDATE transitioning into 'success' (re-fires are skipped).
  IF NEW.status <> 'success' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'success' THEN
    RETURN NEW;
  END IF;

  -- Per-run value from the DB registry; no row or 0 = KPI not configured.
  SELECT a.minutes_saved_per_run INTO v_minutes
  FROM public.automations a
  WHERE a.organization_id = NEW.organization_id
    AND a.key = NEW.workflow_key;

  IF v_minutes IS NULL OR v_minutes <= 0 THEN
    RETURN NEW;
  END IF;

  -- Idempotency: at most one time_saved event per run (covers replays and
  -- repeated status flips, e.g. failed -> success -> failed -> success).
  IF EXISTS (
    SELECT 1 FROM public.kpi_events e
    WHERE e.organization_id = NEW.organization_id
      AND e.event_type = 'time_saved'
      AND e.metadata->>'run_id' = NEW.id::TEXT
  ) THEN
    RETURN NEW;
  END IF;

  -- feature_key stays NULL: automations are tenant-individual workflows, not
  -- gated by a feature flag (kpi_events.feature_key is nullable by design).
  INSERT INTO public.kpi_events (organization_id, event_type, feature_key, value, metadata)
  VALUES (
    NEW.organization_id,
    'time_saved',
    NULL,
    v_minutes,
    jsonb_build_object('workflow_key', NEW.workflow_key, 'run_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

-- ─── TRIGGER ────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_workflow_runs_time_saved ON public.workflow_runs;
CREATE TRIGGER trg_workflow_runs_time_saved
  AFTER INSERT OR UPDATE ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.record_time_saved_kpi();

-- ─── INDEX ──────────────────────────────────────────────────────────────
-- Keeps the idempotency guard cheap; partial so unrelated KPI event types
-- (call_handled, time_saved_seconds, …) stay out of the index.

CREATE INDEX IF NOT EXISTS idx_kpi_events_time_saved_run
  ON public.kpi_events ((metadata->>'run_id'))
  WHERE event_type = 'time_saved';
