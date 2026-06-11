-- Migration: Cockpit registries + run history (docs/spec-cockpit.md §13/§16,
-- docs/spec-berater-dashboard.md §9, docs/spec-admin-dashboard.md §8).
--
-- Foundation for the hAIway Cockpit launch: skills registry, saved agents,
-- DB-backed automations (replacing the code-level AUTOMATION_REGISTRY),
-- audit run tables (agent_runs / skill_runs, pattern: workflow_runs) and
-- per-conversation mode persistence.

-- ─── HELPER: is_org_admin ───────────────────────────────────────────────
-- Berater check (role admin/owner) for RLS policies. Counterpart to
-- is_member_of_org(); SECURITY DEFINER so it can read organization_members
-- from within policies.

CREATE OR REPLACE FUNCTION public.is_org_admin(target_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = target_org_id
      AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
  );
$$;

-- ─── SKILLS REGISTRY ────────────────────────────────────────────────────
-- A skill is a provider-independent construct: prompt template + references
-- to whitelisted registry tools. v1 ships no generated code — code_ref may
-- only point at developer-deployed workers (spec §7.3).

CREATE TABLE IF NOT EXISTS public.skills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = library skill (branchen-scoped, managed by platform admins only)
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  industry_scope  TEXT,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  prompt_template TEXT NOT NULL,
  -- names of tools from the agent tool registry (validated app-side)
  tool_refs       TEXT[] NOT NULL DEFAULT '{}',
  -- v1: developer-deployed worker reference only, never generated code
  code_ref        TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'in_review', 'approved', 'active', 'rejected')),
  version         INT NOT NULL DEFAULT 1,
  review_comment  TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_org_status
  ON public.skills (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_skills_library
  ON public.skills (industry_scope) WHERE organization_id IS NULL;

DROP TRIGGER IF EXISTS trg_skills_updated_at ON public.skills;
CREATE TRIGGER trg_skills_updated_at
  BEFORE UPDATE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skills_org_read" ON public.skills;
CREATE POLICY "skills_org_read" ON public.skills
  FOR SELECT USING (
    organization_id IS NOT NULL AND public.is_member_of_org(organization_id)
  );

DROP POLICY IF EXISTS "skills_library_read" ON public.skills;
CREATE POLICY "skills_library_read" ON public.skills
  FOR SELECT USING (
    organization_id IS NULL AND public.is_platform_admin()
  );

DROP POLICY IF EXISTS "skills_org_insert" ON public.skills;
CREATE POLICY "skills_org_insert" ON public.skills
  FOR INSERT WITH CHECK (
    organization_id IS NOT NULL
    AND public.is_member_of_org(organization_id)
    AND created_by = auth.uid()
  );

-- Status transitions (review workflow) are gated in server actions; library
-- rows are written via service role only. Org members may update their org's
-- skills (coarse policy, repo convention) — tightened with the full review
-- workflow phase.
DROP POLICY IF EXISTS "skills_org_update" ON public.skills;
CREATE POLICY "skills_org_update" ON public.skills
  FOR UPDATE USING (
    organization_id IS NOT NULL AND public.is_member_of_org(organization_id)
  );

-- ─── SKILL REVIEW EVENTS ────────────────────────────────────────────────
-- Lightweight status-change log for the consultant review loop
-- (berater spec §3/§9).

CREATE TABLE IF NOT EXISTS public.skill_review_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id        UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  -- denormalized for RLS (NULL for library skills)
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  comment         TEXT,
  actor           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skill_review_events_skill
  ON public.skill_review_events (skill_id, created_at DESC);

ALTER TABLE public.skill_review_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skill_review_events_read" ON public.skill_review_events;
CREATE POLICY "skill_review_events_read" ON public.skill_review_events
  FOR SELECT USING (
    organization_id IS NOT NULL AND public.is_member_of_org(organization_id)
  );

DROP POLICY IF EXISTS "skill_review_events_insert" ON public.skill_review_events;
CREATE POLICY "skill_review_events_insert" ON public.skill_review_events
  FOR INSERT WITH CHECK (
    organization_id IS NOT NULL
    AND public.is_member_of_org(organization_id)
    AND actor = auth.uid()
  );

-- ─── SAVED AGENTS ───────────────────────────────────────────────────────
-- Customer-created, click-triggered agents (spec §9). Replaces the
-- hardcoded STUB_AGENTS list (seeded in the flags/seeds migration).

CREATE TABLE IF NOT EXISTS public.saved_agents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  -- summarized, customer-reviewed context prompt
  prompt                 TEXT NOT NULL,
  -- NULL = seeded / consultant-curated org agent
  created_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  visibility             TEXT NOT NULL DEFAULT 'private'
                           CHECK (visibility IN ('private', 'org')),
  -- v1 empty; parameterized triggers later (spec §9)
  trigger_config         JSONB NOT NULL DEFAULT '{}',
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'disabled')),
  source_conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  -- UI hints for the overview tile: { "accent": "teal", "icon": "draft" }
  ui                     JSONB NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_agents_org_status
  ON public.saved_agents (organization_id, status);

DROP TRIGGER IF EXISTS trg_saved_agents_updated_at ON public.saved_agents;
CREATE TRIGGER trg_saved_agents_updated_at
  BEFORE UPDATE ON public.saved_agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.saved_agents ENABLE ROW LEVEL SECURITY;

-- Members see org-wide + own private agents; Berater additionally sees all
-- private agents (oversight, Rollen-Matrix spec §11).
DROP POLICY IF EXISTS "saved_agents_read" ON public.saved_agents;
CREATE POLICY "saved_agents_read" ON public.saved_agents
  FOR SELECT USING (
    public.is_member_of_org(organization_id)
    AND (
      visibility = 'org'
      OR created_by = auth.uid()
      OR public.is_org_admin(organization_id)
    )
  );

DROP POLICY IF EXISTS "saved_agents_insert" ON public.saved_agents;
CREATE POLICY "saved_agents_insert" ON public.saved_agents
  FOR INSERT WITH CHECK (
    public.is_member_of_org(organization_id) AND created_by = auth.uid()
  );

-- Owner edits own agents; Berater may update (e.g. disable) any org agent —
-- content edits stay with the owner by app convention.
DROP POLICY IF EXISTS "saved_agents_update" ON public.saved_agents;
CREATE POLICY "saved_agents_update" ON public.saved_agents
  FOR UPDATE USING (
    public.is_member_of_org(organization_id)
    AND (created_by = auth.uid() OR public.is_org_admin(organization_id))
  );

DROP POLICY IF EXISTS "saved_agents_delete" ON public.saved_agents;
CREATE POLICY "saved_agents_delete" ON public.saved_agents
  FOR DELETE USING (
    public.is_member_of_org(organization_id)
    AND (created_by = auth.uid() OR public.is_org_admin(organization_id))
  );

-- ─── AUTOMATION TEMPLATES (internal library, admin spec §3/§8) ──────────
-- Created BEFORE automations because of the template_id FK.

CREATE TABLE IF NOT EXISTS public.automation_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key            TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  requires       TEXT[] NOT NULL DEFAULT '{}',
  default_config JSONB NOT NULL DEFAULT '{}',
  industry_tag   TEXT,
  version        INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_automation_templates_updated_at ON public.automation_templates;
CREATE TRIGGER trg_automation_templates_updated_at
  BEFORE UPDATE ON public.automation_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.automation_templates ENABLE ROW LEVEL SECURITY;

-- Strictly internal: platform admins read; writes via service role.
DROP POLICY IF EXISTS "automation_templates_read" ON public.automation_templates;
CREATE POLICY "automation_templates_read" ON public.automation_templates
  FOR SELECT USING (public.is_platform_admin());

-- ─── AUTOMATIONS (DB registry, replaces AUTOMATION_REGISTRY) ────────────
-- Tenant-scoped background workflows (spec §10). Customers can only read —
-- start/stop/config is consultant territory, enforced at the DB boundary:
-- no client write policies, all writes via service role in gated actions.

CREATE TABLE IF NOT EXISTS public.automations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- joins workflow_runs.workflow_key
  key                   TEXT NOT NULL,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  -- code entrypoint, e.g. "orchestrator/run-complaint"
  workflow_ref          TEXT NOT NULL DEFAULT '',
  -- integration_providers ids this automation depends on
  requires              TEXT[] NOT NULL DEFAULT '{}',
  -- responsible consultant
  owner                 UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'stopped')),
  -- KPI v1 model (spec §10): saved time = value × successful runs
  minutes_saved_per_run NUMERIC NOT NULL DEFAULT 0,
  managed_by_consultant BOOLEAN NOT NULL DEFAULT TRUE,
  template_id           UUID REFERENCES public.automation_templates(id) ON DELETE SET NULL,
  config                JSONB NOT NULL DEFAULT '{}',
  -- append-only change log: [{ at, actor, change }]
  config_history        JSONB NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, key)
);

CREATE INDEX IF NOT EXISTS idx_automations_org_status
  ON public.automations (organization_id, status);

DROP TRIGGER IF EXISTS trg_automations_updated_at ON public.automations;
CREATE TRIGGER trg_automations_updated_at
  BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automations_read" ON public.automations;
CREATE POLICY "automations_read" ON public.automations
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── AGENT RUNS (audit, spec §13) ───────────────────────────────────────
-- One row per agentic request or saved-agent click. pending_action +
-- awaiting_confirmation carry the write-confirmation flow (spec §12.2).

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  saved_agent_id  UUID REFERENCES public.saved_agents(id) ON DELETE SET NULL,
  triggered_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  model           TEXT,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'awaiting_confirmation', 'success', 'failed', 'cancelled')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INT,
  -- [{ tool, input_digest, result_digest, confirmed }]
  tool_calls      JSONB NOT NULL DEFAULT '[]',
  -- write action awaiting UI confirmation: { id, tool, input, preview }
  pending_action  JSONB,
  token_usage     JSONB,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_org_started
  ON public.agent_runs (organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_failed
  ON public.agent_runs (organization_id, started_at DESC)
  WHERE status = 'failed';

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_runs_read" ON public.agent_runs;
CREATE POLICY "agent_runs_read" ON public.agent_runs
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── SKILL RUNS (audit, spec §13) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.skill_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  skill_id        UUID REFERENCES public.skills(id) ON DELETE SET NULL,
  skill_version   INT,
  trigger         TEXT NOT NULL DEFAULT 'cockpit'
                    CHECK (trigger IN ('cockpit', 'sandbox', 'automation')),
  triggered_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  model           TEXT,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'failed')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INT,
  input_digest    TEXT,
  output_ref      TEXT,
  token_usage     JSONB,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_org_started
  ON public.skill_runs (organization_id, started_at DESC);

ALTER TABLE public.skill_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skill_runs_read" ON public.skill_runs;
CREATE POLICY "skill_runs_read" ON public.skill_runs
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── CHAT CONVERSATIONS: MODE ───────────────────────────────────────────
-- Explicit chat/agent mode per conversation (spec §12.4). No mixed
-- conversations — switching modes starts a new conversation.

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'chat'
    CHECK (mode IN ('chat', 'agent'));
