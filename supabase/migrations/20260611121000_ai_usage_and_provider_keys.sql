-- Migration: AI usage tracking + per-tenant provider keys
-- (docs/spec-cockpit.md §5.2/§16, berater spec §7/§9, admin spec §5/§6/§8).
--
-- ai_usage_events is the rollup source for dashboards and quota enforcement;
-- chat_messages.token_usage stays as per-message detail. ai_provider_keys
-- enables per-tenant model routing (tenant key → platform key → env fallback).

-- ─── AI USAGE EVENTS ────────────────────────────────────────────────────
-- One row per model interaction (chat, agent, skill, automation, embedding).
-- Retention/partitioning deliberately deferred (admin spec §9 open question);
-- revisit once volume warrants the raw_events partitioning pattern.

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- additive: enables the open per-user/day quota question without schema break
  user_id             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  purpose             TEXT NOT NULL
                        CHECK (purpose IN ('chat', 'agent', 'skill', 'automation', 'embedding')),
  tokens_in           INT NOT NULL DEFAULT 0,
  tokens_out          INT NOT NULL DEFAULT 0,
  cost_estimate_cents NUMERIC(12,4),
  -- chat_message | agent_run | skill_run | workflow_run | source
  ref_type            TEXT,
  ref_id              UUID,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_time
  ON public.ai_usage_events (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_purpose
  ON public.ai_usage_events (organization_id, purpose, occurred_at DESC);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Org members read their rollup; all writes happen server-side via service
-- role (no client write policy).
DROP POLICY IF EXISTS "ai_usage_events_read" ON public.ai_usage_events;
CREATE POLICY "ai_usage_events_read" ON public.ai_usage_events
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── AI PROVIDER KEYS ───────────────────────────────────────────────────
-- Encrypted per-tenant (or platform-wide, organization_id IS NULL) model
-- provider keys. encrypted_key is AES-256-GCM via the app-side helper
-- (lib/ai/provider-keys.ts, env secret AI_KEYS_ENCRYPTION_SECRET).
--
-- RLS is enabled with ZERO policies = deny-all for clients. Only the
-- service-role client touches this table. This deliberately diverges from
-- organization_integrations.credentials (org-member-readable plaintext) —
-- model keys must never be exposed to browsers; the UI only sees key_hint.

CREATE TABLE IF NOT EXISTS public.ai_provider_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = platform key (fallback for tenants without own assignment)
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  encrypted_key   TEXT NOT NULL,
  -- last 4 chars for the admin UI
  key_hint        TEXT NOT NULL DEFAULT '',
  -- routing constraints, e.g. {"eu_only": true}
  constraints     JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled')),
  rotated_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one active key per scope+provider (platform scope folded onto a
-- sentinel UUID so NULL rows participate in the uniqueness check).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_provider_keys_one_active
  ON public.ai_provider_keys (
    COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    provider
  )
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_ai_provider_keys_updated_at ON public.ai_provider_keys;
CREATE TRIGGER trg_ai_provider_keys_updated_at
  BEFORE UPDATE ON public.ai_provider_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_provider_keys ENABLE ROW LEVEL SECURITY;
-- intentionally no policies: deny-all for authenticated/anon

-- ─── VIEWS ──────────────────────────────────────────────────────────────

-- Org-facing daily rollup (berater spec §9). security_invoker so the
-- caller's RLS on ai_usage_events applies.
CREATE OR REPLACE VIEW public.ai_usage_daily
  WITH (security_invoker = true) AS
SELECT
  organization_id,
  date_trunc('day', occurred_at) AS day,
  purpose,
  model,
  SUM(tokens_in)            AS tokens_in,
  SUM(tokens_out)           AS tokens_out,
  SUM(cost_estimate_cents)  AS cost_cents,
  COUNT(*)                  AS events
FROM public.ai_usage_events
GROUP BY 1, 2, 3, 4;

GRANT SELECT ON public.ai_usage_daily TO authenticated, service_role;

-- Cross-tenant views (admin spec §8): owner rights, service_role grant ONLY.
-- Do not copy the integration_kpi_daily pattern (authenticated grant).
CREATE OR REPLACE VIEW public.ai_usage_platform_daily AS
SELECT
  organization_id,
  date_trunc('day', occurred_at) AS day,
  provider,
  model,
  purpose,
  SUM(tokens_in)           AS tokens_in,
  SUM(tokens_out)          AS tokens_out,
  SUM(cost_estimate_cents) AS cost_cents,
  COUNT(*)                 AS events
FROM public.ai_usage_events
GROUP BY 1, 2, 3, 4, 5;

REVOKE ALL ON public.ai_usage_platform_daily FROM authenticated, anon;
GRANT SELECT ON public.ai_usage_platform_daily TO service_role;

CREATE OR REPLACE VIEW public.agent_runs_daily AS
SELECT
  organization_id,
  date_trunc('day', started_at) AS day,
  COUNT(*)                                            AS total,
  COUNT(*) FILTER (WHERE status = 'failed')           AS failed,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms
FROM public.agent_runs
GROUP BY 1, 2;

REVOKE ALL ON public.agent_runs_daily FROM authenticated, anon;
GRANT SELECT ON public.agent_runs_daily TO service_role;

CREATE OR REPLACE VIEW public.skill_runs_daily AS
SELECT
  organization_id,
  date_trunc('day', started_at) AS day,
  COUNT(*)                                            AS total,
  COUNT(*) FILTER (WHERE status = 'failed')           AS failed,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms
FROM public.skill_runs
GROUP BY 1, 2;

REVOKE ALL ON public.skill_runs_daily FROM authenticated, anon;
GRANT SELECT ON public.skill_runs_daily TO service_role;

-- ─── QUOTA HELPER ───────────────────────────────────────────────────────
-- Current-month usage for quota checks (spec §12.3). Invoker rights: RLS
-- applies for org members; the service role uses it for enforcement in the
-- send path.

CREATE OR REPLACE FUNCTION public.get_org_ai_usage_month(p_org_id UUID)
RETURNS TABLE (tokens BIGINT, cost_cents NUMERIC)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    COALESCE(SUM(tokens_in + tokens_out), 0)::BIGINT,
    COALESCE(SUM(cost_estimate_cents), 0)::NUMERIC
  FROM public.ai_usage_events
  WHERE organization_id = p_org_id
    AND occurred_at >= date_trunc('month', NOW());
$$;
