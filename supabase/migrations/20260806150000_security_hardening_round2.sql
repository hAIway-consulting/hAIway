-- Migration: security_hardening_round2 (audit 2026-08-06, adversarial review)
--
-- DEPLOY NOTE: like 20260806100000 and 20260806130000 this file is committed
-- but NOT pushed automatically. It revokes EXECUTE on RPCs that the phone
-- assistant and the connectors call, so apply it as its own conscious
-- `supabase db push` and verify afterwards:
--   * phone assistant: inbound call -> caller briefing -> slot search -> booking
--   * /quellen: upload, delete (Papierkorb), restore, purge
--   * /berechtigungen: assign a source to a folder as Berater
--   * /admin/ai-settings: save as owner AND as manager/berater
--   * connector + worker crons still produce integration_runs
--
-- DEPLOY ORDER: this migration must land BEFORE the Edge Functions are
-- deployed, because it re-schedules the three worker crons onto the
-- service-role key that worker-normalize / worker-embed /
-- worker-extract-entities start requiring in the same change.
--
-- PREREQUISITE (verify before pushing):
--   SELECT name FROM vault.decrypted_secrets
--    WHERE name IN ('project_url', 'service_role_key');
-- Both rows must exist — see the header of
-- 20260806100000_connector_crons_service_role.sql for how to create them.
--
-- Round 1 (20260806130000) closed get_org_integration, get_caller_context,
-- record_kpi_event, replay_job_failure and start_integration_run. This file
-- closes what the adversarial review found still open:
--
--   1. public.invoke_edge_function() kept the Postgres default EXECUTE TO
--      PUBLIC while reading the service-role key from the vault — an
--      anonymous PostgREST call could borrow that key for any URL.
--   2. get_calendar_integration_for_org / update_calendar_token handed out
--      and overwrote Google refresh tokens for any organisation, and every
--      org member could read calendar_integrations.refresh_token directly.
--   3. sources.folder_id was writable by every org member, which defeats the
--      folder permission model that round 1 hardened.
--   4. The source lifecycle RPCs (soft delete / trash) rejected the service
--      role and did not check anything for invalidate_source_chunks.
--   5. The remaining SECURITY DEFINER RPCs that take an organisation as a
--      parameter were still executable by anon / authenticated.
--   6. The three worker Edge Functions had no caller check at all.
--
-- Two round-1 findings were fixed in 20260806130000 itself rather than here,
-- so the file keeps a single definition of each object: is_service_request()
-- is now fail-closed, and section 6a no longer drops unknown policies on
-- public.organizations.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. public.invoke_edge_function — THE SERVICE-ROLE KEY MUST NOT BE FOR HIRE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260406110000:91-119 created it SECURITY DEFINER without a REVOKE, so it
-- kept the Postgres default EXECUTE TO PUBLIC and was callable through
-- PostgREST as `anon`:
--
--   POST /rest/v1/rpc/invoke_edge_function
--   {"p_name":"connector-twenty","p_body":{"organization_id":"<any org>"}}
--
-- The function appends the real service-role key from the vault, which walks
-- straight through the requireServiceRole() guard the connectors gained in
-- this audit. Worse, p_name was concatenated into the URL unchecked, so
-- '../../rest/v1/organizations' turned it into a service-role proxy for the
-- whole REST API.
--
-- Two independent fixes, because either one alone is a single point of
-- failure:
--   a) EXECUTE is revoked from PUBLIC/anon/authenticated. pg_cron jobs run as
--      `postgres`, which keeps EXECUTE via the explicit grant below.
--   b) p_name is matched against a fixed allowlist, so even a caller that
--      does have EXECUTE cannot aim the key at an arbitrary path.
--
-- The allowlist is spelled out here and in invoke_edge_function_async
-- (20260806100000) rather than in a shared helper: 20260806100000 sorts
-- BEFORE this file, so it cannot depend on anything defined here.
-- Callers today: 'reconcile-connectors-daily' (20260409150000:127) and the
-- three worker crons re-scheduled in section 6.
CREATE OR REPLACE FUNCTION public.invoke_edge_function(
  p_name TEXT,
  p_body JSONB DEFAULT '{}'::JSONB
)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_id  BIGINT;
BEGIN
  IF p_name IS NULL OR p_name NOT IN (
    'connector-gdrive',
    'connector-sharepoint',
    'connector-twenty',
    'worker-normalize',
    'worker-embed',
    'worker-extract-entities'
  ) THEN
    RAISE EXCEPTION 'invoke_edge_function: function % is not allowed', p_name
      USING ERRCODE = '42501';
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;

  IF v_url IS NULL THEN
    v_url := NULLIF(current_setting('app.settings.supabase_url', TRUE), '');
  END IF;

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  -- WARNING, not NOTICE: a missing secret silently disables every cron that
  -- goes through this helper. See the header of 20260806100000 for how to
  -- create the two vault secrets.
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING
      'invoke_edge_function(%): project_url / service_role_key not available — skipping',
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

REVOKE ALL ON FUNCTION public.invoke_edge_function(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_edge_function(TEXT, JSONB)
  TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. GOOGLE CALENDAR TOKENS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260403110000 defined both functions SECURITY DEFINER, without
-- search_path, without an authorisation check and without a REVOKE:
--   get_calendar_integration_for_org(p_org_id) returned refresh_token +
--     access_token of ANY organisation to any caller holding the anon key.
--   update_calendar_token(p_org_id, ...) let anybody overwrite the stored
--     access token of a foreign org.
--
-- PHONE ASSISTANT — VERIFIED: the only caller is
-- supabase/functions/phone-assistant-rag/index.ts:853 (getCalendarConfig) and
-- :889 (getCalendarAccessToken), both on getServiceClient(), i.e. a
-- service_role PostgREST request. is_service_request() is TRUE there, and
-- service_role keeps EXECUTE. Slot search and booking are unaffected.
-- apps/web never calls these RPCs; it reads/writes the table directly with
-- the service client (app/telefon-assistent/actions.ts).

ALTER FUNCTION public.get_calendar_integration_for_org(UUID) SET search_path = public;
ALTER FUNCTION public.update_calendar_token(UUID, TEXT, TIMESTAMPTZ) SET search_path = public;

REVOKE ALL ON FUNCTION public.get_calendar_integration_for_org(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_calendar_integration_for_org(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.update_calendar_token(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_calendar_token(UUID, TEXT, TIMESTAMPTZ) TO service_role;

-- The RLS policy "org members read calendar_integrations" (20260403110000:44)
-- exposes the whole row — refresh_token included — to every org member. Same
-- defect and same fix as organization_integrations.credentials in round 1:
-- RLS cannot filter columns, so the token columns are removed from the
-- column-level GRANT. The row filter stays with the RLS policy.
--
-- Verified against every user-client read of this table: the only one is
-- lib/db/queries/phone-assistant.ts (getCalendarIntegration), which is
-- rewritten in the same commit to select explicit non-secret columns.
-- Every write path uses createServiceClient() and bypasses this:
-- app/telefon-assistent/actions.ts (saveCalendarSettings, disconnectCalendar,
-- exchangeGoogleCode) and hasActiveCalendarIntegration.
--
-- CAUTION for future work: from here on, select("*") on this table with a
-- user client fails. New user-client queries must list columns explicitly.

REVOKE ALL ON TABLE public.calendar_integrations FROM anon;
REVOKE ALL ON TABLE public.calendar_integrations FROM authenticated;

GRANT SELECT (
  id,
  organization_id,
  provider,
  calendar_id,
  token_expires_at,
  settings,
  status,
  created_at,
  updated_at
) ON public.calendar_integrations TO authenticated;

-- Defence in depth behind the revoked DML privileges: the FOR ALL policy let
-- every member overwrite the org's calendar connection.
DROP POLICY IF EXISTS "org members write calendar_integrations" ON public.calendar_integrations;

DROP POLICY IF EXISTS "org admins insert calendar_integrations" ON public.calendar_integrations;
CREATE POLICY "org admins insert calendar_integrations" ON public.calendar_integrations
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS "org admins update calendar_integrations" ON public.calendar_integrations;
CREATE POLICY "org admins update calendar_integrations" ON public.calendar_integrations
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS "org admins delete calendar_integrations" ON public.calendar_integrations;
CREATE POLICY "org admins delete calendar_integrations" ON public.calendar_integrations
  FOR DELETE USING (public.is_org_admin(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. sources.folder_id IS A PERMISSION FIELD, NOT CONTENT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Policy "sources_org_update" (20260413100000:170) allows FOR UPDATE to every
-- org member with no folder check. A regular member could therefore call
--   PATCH /rest/v1/sources?id=eq.<restricted source>  {"folder_id": null}
-- with nothing but the anon key and their own JWT, and read the source
-- afterwards through the `folder_id IS NULL` branch of
-- "sources_org_read_with_folders". For an UPDATE without RETURNING only the
-- UPDATE USING clause applies, so the folder-aware SELECT policy does not
-- help. That defeats the goal round 1 wrote into its own section 4.
--
-- RLS cannot compare OLD and NEW, and a column-level GRANT cannot distinguish
-- roles, so the check lives in a BEFORE UPDATE trigger: ordinary edits
-- (title, status, raw_text, sync_status, deleted_at, ...) stay open to every
-- member exactly as before, only a CHANGE of folder_id needs Berater rights.
--
-- Matches the app: assignSourceToFolder / assignSourcesToFolder /
-- deleteSourceFolder in app/berechtigungen/actions.ts are the only writers of
-- folder_id and all three already call requireBeraterRole() and use the user
-- client. Service-role writers (workers, connectors) pass through
-- is_service_request(). The FK's ON DELETE SET NULL runs as part of a folder
-- delete, which is itself Berater-only.
CREATE OR REPLACE FUNCTION public.enforce_source_folder_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.folder_id IS DISTINCT FROM OLD.folder_id THEN
    IF NOT (
      public.is_service_request()
      OR public.is_org_berater(OLD.organization_id)
    ) THEN
      RAISE EXCEPTION
        'sources.folder_id: not authorised for organisation %', OLD.organization_id
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_source_folder_change ON public.sources;
CREATE TRIGGER enforce_source_folder_change
  BEFORE UPDATE OF folder_id ON public.sources
  FOR EACH ROW EXECUTE FUNCTION public.enforce_source_folder_change();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SOURCE LIFECYCLE RPCs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- soft_delete_source already gained an is_member_of_org() guard in
-- 20260413130000 — the review's claim that it has no check is wrong for the
-- current head. What it does have is the mirror-image bug: is_member_of_org()
-- resolves auth.uid(), which is NULL for a service-role request, so every
-- service-role caller is rejected. And those are the only callers left:
--   apps/web/src/app/quellen/actions.ts:261 deleteSource     (service client)
--   apps/web/src/app/quellen/actions.ts:272 restoreSource    (service client)
--   apps/web/src/app/quellen/actions.ts:283 purgeSource      (service client)
--   supabase/functions/worker-normalize/index.ts:88          (service client)
-- So the trash was broken, not permissive. All four RPCs now accept
-- "service request OR org member"; nothing gets more permissive for users.
CREATE OR REPLACE FUNCTION public.soft_delete_source(p_source_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.sources WHERE id = p_source_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'source % not found', p_source_id;
  END IF;
  IF NOT (public.is_service_request() OR public.is_member_of_org(v_org)) THEN
    RAISE EXCEPTION 'not a member of org %', v_org USING ERRCODE = '42501';
  END IF;

  UPDATE public.sources
     SET deleted_at = NOW(), sync_status = 'idle'
   WHERE id = p_source_id AND deleted_at IS NULL;

  UPDATE public.content_chunks
     SET deleted_at = NOW()
   WHERE source_id = p_source_id AND deleted_at IS NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.restore_source(p_source_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM public.sources WHERE id = p_source_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'source % not found', p_source_id; END IF;
  IF NOT (public.is_service_request() OR public.is_member_of_org(v_org)) THEN
    RAISE EXCEPTION 'not a member of org %', v_org USING ERRCODE = '42501';
  END IF;
  UPDATE public.sources
     SET deleted_at = NULL, sync_status = 'queued'
   WHERE id = p_source_id;
END; $$;

CREATE OR REPLACE FUNCTION public.purge_source(p_source_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID; v_deleted TIMESTAMPTZ;
BEGIN
  SELECT organization_id, deleted_at INTO v_org, v_deleted
    FROM public.sources WHERE id = p_source_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'source % not found', p_source_id; END IF;
  IF NOT (public.is_service_request() OR public.is_member_of_org(v_org)) THEN
    RAISE EXCEPTION 'not a member of org %', v_org USING ERRCODE = '42501';
  END IF;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'source % must be in trash before purge', p_source_id;
  END IF;
  DELETE FROM public.content_chunks WHERE source_id = p_source_id;
  DELETE FROM public.sources WHERE id = p_source_id;
END; $$;

CREATE OR REPLACE FUNCTION public.list_deleted_sources(p_org_id UUID)
RETURNS TABLE (
  id              UUID,
  title           TEXT,
  source_type     TEXT,
  connector_type  TEXT,
  source_url      TEXT,
  deleted_at      TIMESTAMPTZ,
  word_count      INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_service_request() OR public.is_member_of_org(p_org_id)) THEN
    RAISE EXCEPTION 'not a member of org %', p_org_id USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.title, s.source_type, s.connector_type,
           s.source_url, s.deleted_at, s.word_count
      FROM public.sources s
     WHERE s.organization_id = p_org_id
       AND s.deleted_at IS NOT NULL
     ORDER BY s.deleted_at DESC;
END; $$;

-- invalidate_source_chunks is the odd one out: SECURITY DEFINER, GRANT to
-- `authenticated`, zero authorisation logic — and zero callers anywhere in
-- apps/web, supabase/functions, scripts or e2e (only the migration that
-- created it and docs/gdrive-sync.html mention it). Any logged-in user could
-- wipe the embeddings of any source of any org. It is kept (writeback will
-- need it) but restricted to the service role. (It already carries
-- SET search_path = public from 20260408120000.)
REVOKE ALL ON FUNCTION public.invalidate_source_chunks(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invalidate_source_chunks(UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. THE REST OF THE SECURITY DEFINER FAMILY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Postgres grants EXECUTE to PUBLIC for every new function, so a SECURITY
-- DEFINER RPC without an explicit REVOKE is callable through PostgREST by
-- anon and authenticated — even when the migration "granted" it to
-- service_role only. Everything below is server-side only by design; the
-- grants merely say so out loud.
--
-- 5a. Phone assistant lookups. Sole callers are phone-assistant-rag and
-- phone-assistant-call-complete on getServiceClient():
--   get_org_for_phone_number       -> system prompt + org id for any number
--   get_org_for_provider_assistant -> same via the Vapi assistant id
--   search_contact_by_name         -> name, phone, e-mail, company of any org
--   match_caller_to_contact        -> existence oracle against foreign contacts
--   get_boosted_source_ids_for_contact
-- Bodies are untouched, so the assistant keeps working verbatim.

ALTER FUNCTION public.get_org_for_phone_number(TEXT) SET search_path = public;
REVOKE ALL ON FUNCTION public.get_org_for_phone_number(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_for_phone_number(TEXT) TO service_role;

ALTER FUNCTION public.get_org_for_provider_assistant(TEXT) SET search_path = public;
REVOKE ALL ON FUNCTION public.get_org_for_provider_assistant(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_for_provider_assistant(TEXT) TO service_role;

ALTER FUNCTION public.search_contact_by_name(UUID, TEXT) SET search_path = public;
REVOKE ALL ON FUNCTION public.search_contact_by_name(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_contact_by_name(UUID, TEXT) TO service_role;

ALTER FUNCTION public.match_caller_to_contact(UUID, TEXT) SET search_path = public;
REVOKE ALL ON FUNCTION public.match_caller_to_contact(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_caller_to_contact(UUID, TEXT) TO service_role;

ALTER FUNCTION public.get_boosted_source_ids_for_contact(UUID, UUID) SET search_path = public;
REVOKE ALL ON FUNCTION public.get_boosted_source_ids_for_contact(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_boosted_source_ids_for_contact(UUID, UUID) TO service_role;

-- 5b. get_call_stats is the one phone RPC a user client really calls
-- (lib/db/queries/phone-assistant.ts:189, p_org_id = requireOrgId()). It keeps
-- its grant to `authenticated` and gains a membership check instead.
CREATE OR REPLACE FUNCTION public.get_call_stats(p_org_id UUID, p_days INT DEFAULT 30)
RETURNS TABLE (
  total_calls BIGINT,
  completed_calls BIGINT,
  missed_calls BIGINT,
  avg_duration_seconds NUMERIC,
  total_duration_seconds BIGINT,
  calls_de BIGINT,
  calls_en BIGINT,
  calls_other BIGINT,
  total_cost_cents BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_service_request() OR public.is_member_of_org(p_org_id)) THEN
    RAISE EXCEPTION 'get_call_stats: not authorised for organisation %', p_org_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE cl.status = 'completed')::BIGINT,
    COUNT(*) FILTER (WHERE cl.status IN ('missed','failed'))::BIGINT,
    ROUND(AVG(cl.duration_seconds) FILTER (WHERE cl.duration_seconds > 0), 1),
    COALESCE(SUM(cl.duration_seconds) FILTER (WHERE cl.duration_seconds > 0), 0)::BIGINT,
    COUNT(*) FILTER (WHERE cl.detected_language = 'de')::BIGINT,
    COUNT(*) FILTER (WHERE cl.detected_language = 'en')::BIGINT,
    COUNT(*) FILTER (WHERE cl.detected_language IS NULL
                        OR cl.detected_language NOT IN ('de','en'))::BIGINT,
    COALESCE(SUM(cl.cost_cents), 0)::BIGINT
  FROM public.call_logs cl
  WHERE cl.organization_id = p_org_id
    AND cl.started_at >= now() - (p_days || ' days')::INTERVAL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_call_stats(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_call_stats(UUID, INT) TO authenticated, service_role;

-- 5c. enqueue_extract_for_org(p_org_id) had an explicit GRANT to
-- `authenticated` and no check: any user could start the LLM entity
-- extraction over the complete source inventory of a foreign org (cost and
-- load amplification). It has no callers at all today. Its search_path
-- (public, pgmq) stays as created — do not narrow it here.
REVOKE ALL ON FUNCTION public.enqueue_extract_for_org(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_extract_for_org(UUID) TO service_role;

-- 5d. Pipeline internals. All of them were granted to service_role but never
-- revoked from PUBLIC, so the default grant stayed in place. Callers:
--   upsert_connector_source  -> worker-normalize/index.ts:101
--   reconcile_drive_sources  -> connector-gdrive/index.ts:179
--   finish_integration_run   -> _shared/worker.ts:173
--   ensure_raw_events_partitions -> cron 'ingest-partition-rollover'
REVOKE ALL ON FUNCTION public.upsert_connector_source(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_connector_source(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_drive_sources(UUID, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_drive_sources(UUID, TEXT, TEXT[]) TO service_role;

REVOKE ALL ON FUNCTION public.finish_integration_run(UUID, TEXT, INT, INT, INT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_integration_run(UUID, TEXT, INT, INT, INT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.ensure_raw_events_partitions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_raw_events_partitions() TO postgres, service_role;

-- 5e. Entity extraction writers. Round 1 re-stated their service_role grants
-- but the PUBLIC default was never revoked — meaning any logged-in user could
-- write companies/contacts/projects into a foreign org, or delete that org's
-- auto-extracted rows. Sole caller: worker-extract-entities on the service
-- client.
REVOKE ALL ON FUNCTION public.upsert_company_from_extraction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_contact_from_extraction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_project_from_extraction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_auto_extracted_by_source(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_company_from_extraction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_contact_from_extraction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_project_from_extraction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_auto_extracted_by_source(UUID, UUID) TO service_role;

-- 5f. Onboarding creates an organisation plus an owner membership for an
-- arbitrary p_user_id. Callers are scripts/ops/create-{customer,sandbox}-org
-- with the service-role key; v1 has no callers at all.
REVOKE ALL ON FUNCTION public.onboard_organization(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_organization(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.onboard_organization_v2(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_organization_v2(UUID, TEXT, TEXT, TEXT) TO service_role;

-- 5g. user_can_access_source(p_source_id, p_user_id) takes the user id as a
-- parameter, so it answers "may user X see source Y?" for arbitrary X. It has
-- no callers (no RLS policy and no application code uses it — the policies
-- inline the same EXISTS clause), so restricting it breaks nothing.
REVOKE ALL ON FUNCTION public.user_can_access_source(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_source(UUID, UUID) TO service_role;

-- CHECKED AND DELIBERATELY LEFT ALONE:
--   admin_retrieval_quality_totals / admin_retrieval_passive_signals
--     (20260417100000) — already REVOKEd from PUBLIC and they carry
--     `WHERE public.is_platform_admin()` inside the body.
--   org_has_feature / get_org_features / get_org_limit (20260402120000,
--     20260404100000) — NOT security definer, so RLS applies to the caller.
--   is_member_of_org / is_org_admin / is_org_berater / is_platform_admin —
--     helpers that resolve auth.uid() and must stay callable from RLS.
--   pgmq_* / try_acquire_sync_lock / release_sync_lock / pgmq_queue_length —
--     revoked when they were created.
--   set_updated_at / handle_new_profile / moddatetime — trigger functions,
--     not reachable through PostgREST.
--   list_deleted_sources / restore_source / purge_source / soft_delete_source
--     — keep the `authenticated` grant, guarded in section 4.

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. WORKER CRONS MUST AUTHENTICATE AS service_role
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260507100000:22-58 schedules the three worker crons with
--   'Authorization', 'Bearer ' || current_setting('app.settings.anon_key')
-- i.e. they announce themselves as anonymous. worker-normalize, worker-embed
-- and worker-extract-entities therefore cannot check their caller — and
-- anyone holding the public anon key can drive them: queue drain, embedding
-- and LLM cost, and exactly the IO load that exhausted the burst credits on
-- 2026-05-06 (see 20260506140000).
--
-- Same treatment the two connector crons got in 20260806100000: route them
-- through the vault-backed helper. The functions gain requireServiceRole() in
-- the same commit — hence the deploy order in the file header.
--
-- Cadence and body are unchanged (every 2 minutes, empty payload).

DO $$ BEGIN PERFORM cron.unschedule('worker-normalize-2min');        EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('worker-embed-2min');            EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('worker-extract-entities-2min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'worker-normalize-2min',
  '*/2 * * * *',
  $cron$ SELECT public.invoke_edge_function_async('worker-normalize', '{}'::jsonb); $cron$
);

SELECT cron.schedule(
  'worker-embed-2min',
  '*/2 * * * *',
  $cron$ SELECT public.invoke_edge_function_async('worker-embed', '{}'::jsonb); $cron$
);

SELECT cron.schedule(
  'worker-extract-entities-2min',
  '*/2 * * * *',
  $cron$ SELECT public.invoke_edge_function_async('worker-extract-entities', '{}'::jsonb); $cron$
);
