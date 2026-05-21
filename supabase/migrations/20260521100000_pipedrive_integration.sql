-- Migration: pipedrive_integration
-- Phase 1 of the sales-steering integration: register Pipedrive as a CRM
-- provider, add Silver tables for its key entities, an ICP-classification
-- table (filled by a later phase), and a sales_kpi_daily view that powers
-- the Vertriebssteuerungs-Cockpit.

-- ─── PROVIDER REGISTRATION ──────────────────────────────────────────────

INSERT INTO public.integration_providers (id, name, category, auth_type, feature_key, is_active)
VALUES ('pipedrive', 'Pipedrive', 'crm', 'api_key', NULL, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ─── SILVER: PIPEDRIVE ORGANIZATIONS ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.entities_pipedrive_organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  payload_hash    TEXT,
  name            TEXT,
  owner_external_id TEXT,
  address         TEXT,
  domain          TEXT,
  raw             JSONB NOT NULL,
  deleted_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_entities_pd_orgs_org
  ON public.entities_pipedrive_organizations (organization_id);

ALTER TABLE public.entities_pipedrive_organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entities_pd_orgs_read" ON public.entities_pipedrive_organizations;
CREATE POLICY "entities_pd_orgs_read" ON public.entities_pipedrive_organizations
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── SILVER: PIPEDRIVE PERSONS ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.entities_pipedrive_persons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  payload_hash    TEXT,
  name            TEXT,
  email           TEXT,
  phone           TEXT,
  org_external_id TEXT,
  owner_external_id TEXT,
  raw             JSONB NOT NULL,
  deleted_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_entities_pd_persons_org
  ON public.entities_pipedrive_persons (organization_id);

ALTER TABLE public.entities_pipedrive_persons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entities_pd_persons_read" ON public.entities_pipedrive_persons;
CREATE POLICY "entities_pd_persons_read" ON public.entities_pipedrive_persons
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── SILVER: PIPEDRIVE PIPELINES + STAGES ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.entities_pipedrive_pipelines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  payload_hash    TEXT,
  name            TEXT,
  is_active       BOOLEAN,
  raw             JSONB NOT NULL,
  deleted_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, external_id)
);

ALTER TABLE public.entities_pipedrive_pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entities_pd_pipelines_read" ON public.entities_pipedrive_pipelines;
CREATE POLICY "entities_pd_pipelines_read" ON public.entities_pipedrive_pipelines
  FOR SELECT USING (public.is_member_of_org(organization_id));

CREATE TABLE IF NOT EXISTS public.entities_pipedrive_stages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  payload_hash    TEXT,
  name            TEXT,
  pipeline_external_id TEXT,
  deal_probability INTEGER,
  order_nr        INTEGER,
  is_active       BOOLEAN,
  raw             JSONB NOT NULL,
  deleted_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_entities_pd_stages_pipeline
  ON public.entities_pipedrive_stages (organization_id, pipeline_external_id);

ALTER TABLE public.entities_pipedrive_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entities_pd_stages_read" ON public.entities_pipedrive_stages;
CREATE POLICY "entities_pd_stages_read" ON public.entities_pipedrive_stages
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── SILVER: PIPEDRIVE DEALS ────────────────────────────────────────────
-- weighted_value is computed in the view (joins to stages.deal_probability)
-- rather than stored, to keep stage-prob updates from forcing a deal rewrite.

CREATE TABLE IF NOT EXISTS public.entities_pipedrive_deals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  payload_hash    TEXT,
  title           TEXT,
  value           NUMERIC,
  currency        TEXT,
  status          TEXT,
  stage_external_id     TEXT,
  pipeline_external_id  TEXT,
  org_external_id       TEXT,
  person_external_id    TEXT,
  owner_external_id     TEXT,
  expected_close_date   DATE,
  add_time              TIMESTAMPTZ,
  update_time           TIMESTAMPTZ,
  last_activity_at      TIMESTAMPTZ,
  raw             JSONB NOT NULL,
  deleted_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_entities_pd_deals_org_status
  ON public.entities_pipedrive_deals (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_entities_pd_deals_owner
  ON public.entities_pipedrive_deals (organization_id, owner_external_id);
CREATE INDEX IF NOT EXISTS idx_entities_pd_deals_last_activity
  ON public.entities_pipedrive_deals (organization_id, last_activity_at);

ALTER TABLE public.entities_pipedrive_deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entities_pd_deals_read" ON public.entities_pipedrive_deals;
CREATE POLICY "entities_pd_deals_read" ON public.entities_pipedrive_deals
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── SILVER: PIPEDRIVE ACTIVITIES ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.entities_pipedrive_activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  payload_hash    TEXT,
  type            TEXT,
  subject         TEXT,
  due_date        DATE,
  due_time        TEXT,
  done            BOOLEAN,
  done_time       TIMESTAMPTZ,
  add_time        TIMESTAMPTZ,
  deal_external_id   TEXT,
  person_external_id TEXT,
  org_external_id    TEXT,
  owner_external_id  TEXT,
  raw             JSONB NOT NULL,
  deleted_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_entities_pd_acts_org_done
  ON public.entities_pipedrive_activities (organization_id, done, due_date);
CREATE INDEX IF NOT EXISTS idx_entities_pd_acts_owner
  ON public.entities_pipedrive_activities (organization_id, owner_external_id);
CREATE INDEX IF NOT EXISTS idx_entities_pd_acts_deal
  ON public.entities_pipedrive_activities (organization_id, deal_external_id);

ALTER TABLE public.entities_pipedrive_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entities_pd_acts_read" ON public.entities_pipedrive_activities;
CREATE POLICY "entities_pd_acts_read" ON public.entities_pipedrive_activities
  FOR SELECT USING (public.is_member_of_org(organization_id));

-- ─── ICP CLASSIFICATIONS (filled in Phase 2, schema lives here) ─────────

CREATE TABLE IF NOT EXISTS public.deal_icp_classifications (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipedrive_org_external_id   TEXT NOT NULL,
  industry                    TEXT NOT NULL CHECK (industry IN ('commerce','hls','bauwesen','other')),
  confidence                  NUMERIC,
  reasoning                   TEXT,
  llm_model                   TEXT,
  manual_override             BOOLEAN NOT NULL DEFAULT FALSE,
  classified_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, pipedrive_org_external_id)
);

ALTER TABLE public.deal_icp_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deal_icp_read" ON public.deal_icp_classifications;
CREATE POLICY "deal_icp_read" ON public.deal_icp_classifications
  FOR SELECT USING (public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS "deal_icp_write" ON public.deal_icp_classifications;
CREATE POLICY "deal_icp_write" ON public.deal_icp_classifications
  FOR ALL USING (public.is_member_of_org(organization_id))
  WITH CHECK (public.is_member_of_org(organization_id));

-- ─── SALES KPI VIEW ─────────────────────────────────────────────────────
-- Daily aggregate per (organization_id, industry, day). Industry falls back
-- to 'unclassified' when no row exists in deal_icp_classifications yet, so
-- the cockpit shows numbers from day one (before Phase 2 lands).

CREATE OR REPLACE VIEW public.sales_kpi_daily AS
WITH classified_orgs AS (
  SELECT
    o.organization_id,
    o.external_id              AS pipedrive_org_external_id,
    COALESCE(c.industry, 'unclassified') AS industry
  FROM public.entities_pipedrive_organizations o
  LEFT JOIN public.deal_icp_classifications c
    ON c.organization_id = o.organization_id
   AND c.pipedrive_org_external_id = o.external_id
),
deal_industry AS (
  SELECT
    d.organization_id,
    d.external_id              AS deal_external_id,
    d.value,
    d.status,
    d.update_time,
    d.last_activity_at,
    d.owner_external_id,
    d.stage_external_id,
    s.deal_probability,
    COALESCE(co.industry, 'unclassified') AS industry
  FROM public.entities_pipedrive_deals d
  LEFT JOIN classified_orgs co
    ON co.organization_id = d.organization_id
   AND co.pipedrive_org_external_id = d.org_external_id
  LEFT JOIN public.entities_pipedrive_stages s
    ON s.organization_id = d.organization_id
   AND s.external_id = d.stage_external_id
  WHERE d.deleted_at IS NULL
),
activity_industry AS (
  SELECT
    a.organization_id,
    a.type,
    a.add_time,
    a.due_date,
    a.owner_external_id,
    COALESCE(co.industry, 'unclassified') AS industry
  FROM public.entities_pipedrive_activities a
  LEFT JOIN classified_orgs co
    ON co.organization_id = a.organization_id
   AND co.pipedrive_org_external_id = a.org_external_id
  WHERE a.deleted_at IS NULL
),
activity_days AS (
  SELECT
    organization_id,
    industry,
    date_trunc('day', COALESCE(add_time, due_date::TIMESTAMPTZ))::DATE AS day,
    COUNT(*)                                            AS activity_count,
    COUNT(*) FILTER (WHERE type = 'call')               AS calls_count,
    COUNT(*) FILTER (WHERE type = 'meeting')            AS meetings_count,
    COUNT(*) FILTER (WHERE type = 'email')              AS emails_count
  FROM activity_industry
  WHERE COALESCE(add_time, due_date::TIMESTAMPTZ) IS NOT NULL
  GROUP BY organization_id, industry, date_trunc('day', COALESCE(add_time, due_date::TIMESTAMPTZ))::DATE
),
deal_days AS (
  SELECT
    organization_id,
    industry,
    CURRENT_DATE AS day,
    COUNT(*) FILTER (WHERE status = 'open')                                      AS open_deals_count,
    COALESCE(SUM(value) FILTER (WHERE status = 'open'), 0)                       AS open_pipeline_value,
    COALESCE(SUM(value * COALESCE(deal_probability, 100) / 100.0)
               FILTER (WHERE status = 'open'), 0)                                AS weighted_pipeline_value,
    COUNT(*) FILTER (WHERE status = 'open'
                      AND (last_activity_at IS NULL OR last_activity_at < NOW() - INTERVAL '14 days')
    )                                                                            AS stale_deal_count
  FROM deal_industry
  GROUP BY organization_id, industry
)
SELECT
  COALESCE(a.organization_id, d.organization_id)                       AS organization_id,
  COALESCE(a.industry, d.industry)                                     AS industry,
  COALESCE(a.day, d.day)                                               AS day,
  COALESCE(a.activity_count, 0)                                        AS activity_count,
  COALESCE(a.calls_count, 0)                                           AS calls_count,
  COALESCE(a.meetings_count, 0)                                        AS meetings_count,
  COALESCE(a.emails_count, 0)                                          AS emails_count,
  COALESCE(d.open_deals_count, 0)                                      AS open_deals_count,
  COALESCE(d.open_pipeline_value, 0)                                   AS open_pipeline_value,
  COALESCE(d.weighted_pipeline_value, 0)                               AS weighted_pipeline_value,
  COALESCE(d.stale_deal_count, 0)                                      AS stale_deal_count
FROM activity_days a
FULL OUTER JOIN deal_days d
  ON d.organization_id = a.organization_id
 AND d.industry        = a.industry
 AND d.day             = a.day;

GRANT SELECT ON public.sales_kpi_daily TO authenticated, service_role;

-- ─── HELPER: stale-deal list for the cockpit ────────────────────────────

CREATE OR REPLACE FUNCTION public.list_stale_pipedrive_deals(p_org_id UUID, p_days INT DEFAULT 14)
RETURNS TABLE (
  deal_external_id     TEXT,
  title                TEXT,
  value                NUMERIC,
  currency             TEXT,
  industry             TEXT,
  owner_external_id    TEXT,
  org_external_id      TEXT,
  last_activity_at     TIMESTAMPTZ,
  days_stale           INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    d.external_id,
    d.title,
    d.value,
    d.currency,
    COALESCE(c.industry, 'unclassified'),
    d.owner_external_id,
    d.org_external_id,
    d.last_activity_at,
    GREATEST(0, EXTRACT(DAY FROM (NOW() - COALESCE(d.last_activity_at, d.add_time)))::INT)
  FROM public.entities_pipedrive_deals d
  LEFT JOIN public.deal_icp_classifications c
    ON c.organization_id = d.organization_id
   AND c.pipedrive_org_external_id = d.org_external_id
  WHERE d.organization_id = p_org_id
    AND d.deleted_at IS NULL
    AND d.status = 'open'
    AND (d.last_activity_at IS NULL OR d.last_activity_at < NOW() - (p_days || ' days')::INTERVAL)
    AND public.is_member_of_org(p_org_id)
  ORDER BY d.last_activity_at NULLS FIRST
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.list_stale_pipedrive_deals(UUID, INT) TO authenticated, service_role;

-- ─── updated_at TRIGGERS ────────────────────────────────────────────────

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'entities_pipedrive_organizations',
    'entities_pipedrive_persons',
    'entities_pipedrive_pipelines',
    'entities_pipedrive_stages',
    'entities_pipedrive_deals',
    'entities_pipedrive_activities',
    'deal_icp_classifications'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at_%I ON public.%I;', t, t
    );
    EXECUTE format(
      'CREATE TRIGGER set_updated_at_%I BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();', t, t
    );
  END LOOP;
END $$;
