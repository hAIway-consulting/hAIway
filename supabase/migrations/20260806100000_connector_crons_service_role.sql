-- Migration: connector crons + service role hardening (audit 2026-08-06)
--
-- DEPLOY NOTE: this migration is committed but NOT pushed automatically. It
-- re-schedules pg_cron jobs and changes provider state; apply it as a
-- deliberate, separate `supabase db push` step and watch the connector runs
-- afterwards.
--
-- This file collects the connector-side cleanup of the 2026-08-06 feature
-- audit. It is written in two parts:
--   PART A (below) — retire the two connector providers that have no runtime
--                    left: 'imap_inbox' and 'generic_webhook'.
--   PART B         — service-role hardening of the connector cron jobs
--                    (appended separately).

-- ─── PART A: retire providers without a runtime ─────────────────────────────
--
-- 'imap_inbox' was registered in 20260524100000_register_orchestrator_providers
-- but its only worker (supabase/functions/worker-imap-poll) always answered
-- HTTP 501 ("IMAP transport not yet wired"). The function is removed in this
-- change, so the provider would render as a dead card in
-- /admin/integrationen. Its UI metadata is removed from provider-meta.ts in
-- the same commit.
--
-- 'generic_webhook' was already hidden by 20260524130000_deactivate_generic_
-- webhook.sql. The UPDATE is repeated here so this migration is self-contained
-- and idempotent regardless of which environment it runs against.
--
-- DELIBERATELY NO DELETE: neither the integration_providers rows nor any
-- organization_integrations rows are removed. 20260524130000 made that call
-- explicitly (customer credentials must survive a provider being retired), and
-- raw_events / integration_runs reference these rows with ON DELETE RESTRICT.
-- Setting is_active = FALSE is enough — /admin/integrationen only lists active
-- providers, and onboard_organization_v2 only seeds pending rows for active
-- ones.

UPDATE public.integration_providers
SET is_active = FALSE
WHERE id IN ('imap_inbox', 'generic_webhook');

-- ─── PART A2: drop the unused 'webhook_connector' feature flag ──────────────
--
-- Seeded by 20260405100000_connector_kpi_phone_extensions.sql:376 for the
-- generic webhook connector. It has zero consumers in the codebase (no hit in
-- apps/web, supabase/functions, scripts or e2e) and the provider it gated is
-- now retired.
--
-- FK check before deleting from feature_flags:
--   * plan_tier_features.feature_key    -> feature_flags(key) ON DELETE CASCADE
--   * organization_features.feature_key -> feature_flags(key) ON DELETE CASCADE
--   * integration_providers.feature_key -> feature_flags(key) with NO explicit
--     action, i.e. NO ACTION/RESTRICT. Verified safe: the 'generic_webhook'
--     seed sets feature_key = NULL, and no other provider row references
--     'webhook_connector'.
-- The two cascading deletes are spelled out anyway so the migration documents
-- what it removes.

DELETE FROM public.organization_features WHERE feature_key = 'webhook_connector';
DELETE FROM public.plan_tier_features    WHERE feature_key = 'webhook_connector';
DELETE FROM public.feature_flags         WHERE key         = 'webhook_connector';

-- ─── PART B: connector crons must authenticate as service_role ──────────────
--
-- 20260506140000_throttle_pipeline_crons.sql:57-81 schedules
-- 'connector-sharepoint-delta' and 'connector-gdrive-delta' with
--   'Authorization', 'Bearer ' || current_setting('app.settings.anon_key')
-- i.e. the cron announces itself as an anonymous caller. The connector Edge
-- Functions are gaining a service-role guard in the same audit, which would
-- turn every scheduled delta sync into a 401. This part must therefore be
-- deployed BEFORE (or at the latest together with) that guard.
--
-- Why not simply swap in a service-role setting: the service role key is NOT
-- exposed as a GUC. `app.settings.anon_key` / `app.settings.supabase_url` exist,
-- `app.settings.service_role_key` does not. The only place the key is readable
-- from inside Postgres is `vault.decrypted_secrets` — the same source
-- public.invoke_edge_function (20260406110000:101-102) already uses.
--
-- Requirements this has to satisfy:
--   * read the key from the vault  -> helper below
--   * stay asynchronous           -> net.http_post (pg_net) is fire-and-forget;
--                                    the cron transaction only enqueues the
--                                    request and returns in milliseconds
--   * skip cleanly if the secret is missing -> RAISE NOTICE + RETURN NULL, so
--                                    the cron run succeeds and simply does
--                                    nothing instead of erroring every 15 min

CREATE OR REPLACE FUNCTION public.invoke_edge_function_async(
  p_name TEXT,
  p_body JSONB DEFAULT '{}'::JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_id  BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;

  -- Fall back to the GUC that the older cron bodies used, so a project that
  -- only ever set app.settings.supabase_url keeps working.
  IF v_url IS NULL THEN
    v_url := NULLIF(current_setting('app.settings.supabase_url', TRUE), '');
  END IF;

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE
      'invoke_edge_function_async(%): project_url / service_role_key not available — skipping',
      p_name;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := p_body
  ) INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_edge_function_async(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_edge_function_async(TEXT, JSONB)
  TO postgres, service_role;

-- Re-schedule both connector crons through the helper. Same cadence (15 min)
-- and same request body as 20260506140000 — only the credential changes.

DO $$ BEGIN PERFORM cron.unschedule('connector-sharepoint-delta'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('connector-gdrive-delta');     EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'connector-sharepoint-delta',
  '*/15 * * * *',
  $cron$ SELECT public.invoke_edge_function_async(
    'connector-sharepoint',
    jsonb_build_object('action', 'delta-sync', 'trigger', 'cron')
  ); $cron$
);

SELECT cron.schedule(
  'connector-gdrive-delta',
  '*/15 * * * *',
  $cron$ SELECT public.invoke_edge_function_async(
    'connector-gdrive',
    jsonb_build_object('action', 'delta-sync', 'trigger', 'cron')
  ); $cron$
);
