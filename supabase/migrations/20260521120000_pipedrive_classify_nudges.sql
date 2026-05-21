-- Migration: pipedrive_classify_nudges
-- Phase 2/3 of the sales-steering integration. Adds:
--   * nudge_dismissals: lets the co-founder dismiss off-ICP entries in
--     /mein-vertrieb without losing them forever (keyed by deal_external_id).
--   * pg_cron schedules for worker-icp-classify (hourly) and
--     worker-sales-nudges (daily at 06:00 UTC ≈ 07:00 Europe/Berlin).
--
-- Both workers read deal_icp_classifications + entities_pipedrive_* from
-- migration 20260521100000_pipedrive_integration.

-- ─── NUDGE DISMISSALS ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nudge_dismissals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source            TEXT NOT NULL CHECK (source IN ('off_icp', 'stale_deal')),
  deal_external_id  TEXT NOT NULL,
  dismissed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, source, deal_external_id)
);

CREATE INDEX IF NOT EXISTS idx_nudge_dismissals_org_user
  ON public.nudge_dismissals (organization_id, user_id, dismissed_at DESC);

ALTER TABLE public.nudge_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nudge_dismissals_read" ON public.nudge_dismissals;
CREATE POLICY "nudge_dismissals_read" ON public.nudge_dismissals
  FOR SELECT USING (public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS "nudge_dismissals_write" ON public.nudge_dismissals;
CREATE POLICY "nudge_dismissals_write" ON public.nudge_dismissals
  FOR ALL USING (public.is_member_of_org(organization_id))
  WITH CHECK (public.is_member_of_org(organization_id));

-- ─── PG_CRON SCHEDULES ─────────────────────────────────────────────────

SELECT cron.schedule(
  'worker-icp-classify-hourly',
  '0 * * * *',
  $$SELECT public.invoke_edge_function('worker-icp-classify', '{}'::jsonb);$$
);

SELECT cron.schedule(
  'worker-sales-nudges-daily',
  '0 6 * * *',
  $$SELECT public.invoke_edge_function('worker-sales-nudges', '{}'::jsonb);$$
);
