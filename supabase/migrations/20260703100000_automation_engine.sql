-- Automation engine foundation.
--
-- Mirrors the integration registry pattern deliberately:
--   automation_templates          ~ integration_providers   (platform registry)
--   automation_template_versions  ~ (new: immutable versioned definitions)
--   organization_automations      ~ organization_integrations (per-org activation + params)
--   automation_runs / step_runs   ~ integration_runs         (audit + KPI)
--
-- Definitions are JSONB (schema: packages/contracts/src/automations.ts).
-- The repo (customers/_templates) is the source of truth; the sync script
-- upserts versions here. Runs are executed by the worker-automation edge
-- function draining the `automation` pgmq queue.

-- ─── REGISTRY ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.automation_templates (
  id                 TEXT PRIMARY KEY,          -- e.g. 'shopware-reklamation'
  name               TEXT NOT NULL,
  description        TEXT,
  current_version    INT  NOT NULL DEFAULT 1,
  required_providers TEXT[] NOT NULL DEFAULT '{}',
  feature_key        TEXT REFERENCES public.feature_flags(key),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.automation_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_templates_read" ON public.automation_templates;
CREATE POLICY "automation_templates_read" ON public.automation_templates
  FOR SELECT USING (TRUE);
-- Writes: service role only (sync script).

-- Immutable versioned definitions. The sync script never updates a version
-- in place — changed content bumps current_version and inserts a new row,
-- so runs stay auditable against the exact definition they executed.
CREATE TABLE IF NOT EXISTS public.automation_template_versions (
  template_id     TEXT NOT NULL REFERENCES public.automation_templates(id) ON DELETE CASCADE,
  version         INT  NOT NULL,
  definition      JSONB NOT NULL,
  definition_hash TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (template_id, version)
);

ALTER TABLE public.automation_template_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_template_versions_read" ON public.automation_template_versions;
CREATE POLICY "automation_template_versions_read" ON public.automation_template_versions
  FOR SELECT USING (TRUE);

-- ─── PER-ORG ACTIVATION ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organization_automations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id     TEXT NOT NULL REFERENCES public.automation_templates(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'paused', 'disabled')),
  -- Org-specific parameters (inbox address, trello list id, prompt
  -- overrides under params.prompts.<step_key>, ...). Rendered in the
  -- Cockpit from the definition's params_schema.
  params          JSONB NOT NULL DEFAULT '{}',
  -- NULL = follow the template's current_version.
  pinned_version  INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_automations_active
  ON public.organization_automations (organization_id) WHERE status = 'active';

ALTER TABLE public.organization_automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organization_automations_read" ON public.organization_automations;
CREATE POLICY "organization_automations_read" ON public.organization_automations
  FOR SELECT USING (public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS "organization_automations_write" ON public.organization_automations;
CREATE POLICY "organization_automations_write" ON public.organization_automations
  FOR ALL USING (public.is_member_of_org(organization_id));

-- ─── RUNS (audit + KPI) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id       TEXT NOT NULL,
  template_version  INT  NOT NULL,
  org_automation_id UUID REFERENCES public.organization_automations(id) ON DELETE SET NULL,
  trigger_type      TEXT NOT NULL
                      CHECK (trigger_type IN ('event', 'cron', 'webhook', 'manual', 'replay')),
  -- e.g. {provider_id, entity_type, external_id, payload_hash} → raw_events
  trigger_ref       JSONB NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'running', 'waiting_approval',
                                        'succeeded', 'failed', 'rejected', 'cancelled')),
  -- Accumulated step outputs: context.<step_key> = output. Persisted after
  -- every step so a crashed worker resumes instead of redoing work.
  context           JSONB NOT NULL DEFAULT '{}',
  current_step_key  TEXT,
  error_message     TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_org
  ON public.automation_runs (organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_waiting
  ON public.automation_runs (organization_id) WHERE status = 'waiting_approval';

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_runs_read" ON public.automation_runs;
CREATE POLICY "automation_runs_read" ON public.automation_runs
  FOR SELECT USING (public.is_member_of_org(organization_id));
-- Writes: service role only (worker).

CREATE TABLE IF NOT EXISTS public.automation_step_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  -- Denormalised for RLS without a join.
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_key        TEXT NOT NULL,
  step_kind       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'waiting_approval', 'succeeded',
                                      'failed', 'skipped', 'rejected')),
  input           JSONB NOT NULL DEFAULT '{}',
  output          JSONB,
  -- model, tokens, prompt_hash, connector details, ...
  metadata        JSONB NOT NULL DEFAULT '{}',
  error_message   TEXT,
  attempt         INT NOT NULL DEFAULT 1,
  -- human_approval decision lives on the step run itself.
  decided_by      UUID REFERENCES public.profiles(id),
  decided_at      TIMESTAMPTZ,
  decision_comment TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  UNIQUE (run_id, step_key, attempt)
);

CREATE INDEX IF NOT EXISTS idx_automation_step_runs_run
  ON public.automation_step_runs (run_id, started_at);
CREATE INDEX IF NOT EXISTS idx_automation_step_runs_approval_inbox
  ON public.automation_step_runs (organization_id, started_at DESC)
  WHERE status = 'waiting_approval';

ALTER TABLE public.automation_step_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_step_runs_read" ON public.automation_step_runs;
CREATE POLICY "automation_step_runs_read" ON public.automation_step_runs
  FOR SELECT USING (public.is_member_of_org(organization_id));
-- Writes: service role (worker) + decide_automation_step() RPC.

-- ─── QUEUE ──────────────────────────────────────────────────────────────

SELECT pgmq.create('automation');

-- ─── TRIGGER DISPATCH ───────────────────────────────────────────────────
-- Called by worker-normalize after a Bronze message is processed: find all
-- active org automations whose template trigger matches this event, create
-- a run each and enqueue it. Returns the number of runs started.

CREATE OR REPLACE FUNCTION public.dispatch_automation_triggers(
  p_org_id      UUID,
  p_provider_id TEXT,
  p_entity_type TEXT,
  p_trigger_ref JSONB DEFAULT '{}'
)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgmq AS $$
DECLARE
  v_rec     RECORD;
  v_run_id  UUID;
  v_started INT := 0;
BEGIN
  FOR v_rec IN
    SELECT
      oa.id AS org_automation_id,
      oa.template_id,
      COALESCE(oa.pinned_version, t.current_version) AS version
    FROM public.organization_automations oa
    JOIN public.automation_templates t ON t.id = oa.template_id
    JOIN public.automation_template_versions tv
      ON tv.template_id = oa.template_id
     AND tv.version     = COALESCE(oa.pinned_version, t.current_version)
    WHERE oa.organization_id = p_org_id
      AND oa.status = 'active'
      AND t.is_active = TRUE
      AND tv.definition -> 'trigger' ->> 'type' = 'event'
      AND tv.definition -> 'trigger' ->> 'provider_id' = p_provider_id
      AND tv.definition -> 'trigger' ->> 'entity_type' = p_entity_type
      AND (t.feature_key IS NULL OR public.org_has_feature(p_org_id, t.feature_key))
  LOOP
    INSERT INTO public.automation_runs
      (organization_id, template_id, template_version, org_automation_id,
       trigger_type, trigger_ref, status)
    VALUES
      (p_org_id, v_rec.template_id, v_rec.version, v_rec.org_automation_id,
       'event', p_trigger_ref, 'pending')
    RETURNING id INTO v_run_id;

    PERFORM pgmq.send('automation', jsonb_build_object('run_id', v_run_id));
    v_started := v_started + 1;
  END LOOP;

  RETURN v_started;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_automation_triggers(UUID, TEXT, TEXT, JSONB) TO service_role;

-- ─── HUMAN APPROVAL ─────────────────────────────────────────────────────
-- Berater decision on a waiting step. approve → step succeeds and the run
-- is re-enqueued; reject → step and run are marked rejected.

CREATE OR REPLACE FUNCTION public.decide_automation_step(
  p_step_run_id UUID,
  p_decision    TEXT,                -- 'approve' | 'reject'
  p_comment     TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgmq AS $$
DECLARE
  v_step  public.automation_step_runs%ROWTYPE;
  v_role  TEXT;
BEGIN
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'decision must be approve or reject';
  END IF;

  SELECT * INTO v_step FROM public.automation_step_runs WHERE id = p_step_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'step run % not found', p_step_run_id;
  END IF;
  IF v_step.status <> 'waiting_approval' THEN
    RAISE EXCEPTION 'step run % is not waiting for approval (status: %)', p_step_run_id, v_step.status;
  END IF;

  -- Berater role (admin/owner) in the org, or platform admin.
  SELECT role INTO v_role
  FROM public.organization_members
  WHERE organization_id = v_step.organization_id AND user_id = auth.uid();

  IF (v_role IS NULL OR v_role NOT IN ('admin', 'owner'))
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden: berater role required';
  END IF;

  UPDATE public.automation_step_runs
  SET status           = CASE WHEN p_decision = 'approve' THEN 'succeeded' ELSE 'rejected' END,
      decided_by       = auth.uid(),
      decided_at       = NOW(),
      decision_comment = p_comment,
      finished_at      = NOW()
  WHERE id = p_step_run_id;

  IF p_decision = 'approve' THEN
    UPDATE public.automation_runs
    SET status = 'running'
    WHERE id = v_step.run_id;
    PERFORM pgmq.send('automation', jsonb_build_object('run_id', v_step.run_id));
  ELSE
    UPDATE public.automation_runs
    SET status = 'rejected', finished_at = NOW()
    WHERE id = v_step.run_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_automation_step(UUID, TEXT, TEXT) TO authenticated;

-- ─── KPI ────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.automation_kpi_daily
WITH (security_invoker = true) AS
SELECT
  organization_id,
  template_id,
  DATE_TRUNC('day', started_at)::DATE AS day,
  COUNT(*)                                             AS run_count,
  COUNT(*) FILTER (WHERE status = 'succeeded')         AS succeeded,
  COUNT(*) FILTER (WHERE status = 'failed')            AS failed,
  COUNT(*) FILTER (WHERE status = 'rejected')          AS rejected,
  COUNT(*) FILTER (WHERE status = 'waiting_approval')  AS waiting_approval,
  AVG(EXTRACT(EPOCH FROM (finished_at - started_at)))
    FILTER (WHERE finished_at IS NOT NULL)             AS avg_duration_sec
FROM public.automation_runs
GROUP BY organization_id, template_id, DATE_TRUNC('day', started_at);

-- ─── FEATURE FLAG ───────────────────────────────────────────────────────

INSERT INTO public.feature_flags (key, name, description, is_core)
VALUES ('automations', 'Automationen',
        'Workflow-Automatisierungen (Outcome-Templates) für diese Organisation',
        FALSE)
ON CONFLICT (key) DO NOTHING;
