-- Migration: trello_token_grant_and_cleanup
--
-- Two changes:
-- 1. Drop the inbound_mail_webhook provider entirely. Strategic decision:
--    we are not building a generic webhook receiver — incoming mail will
--    be handled via IMAP or a per-tenant pre-qualifier, not a Zapier-style
--    inbox. The Edge Function code is removed in the same PR.
-- 2. Adjust the trello provider config_schema: api_key is platform-wide
--    (one developer key for the whole hAIway install, lives in env), only
--    token + board_id + default_list_id are per-tenant. This matches the
--    1-Click Token Authorization flow that Trello supports in place of
--    OAuth 2.0.
--
-- Both changes are safe: no organization_integrations rows reference
-- inbound_mail_webhook yet, and the trello config_schema is only consumed
-- by the frontend wizard which hasn't shipped yet.

-- 1. Remove inbound_mail_webhook provider.
DELETE FROM public.integration_providers
WHERE id = 'inbound_mail_webhook';

-- Also pull any pending organization_integrations rows that referenced
-- it (defensive — none should exist, but onboard_organization_v2 creates
-- pending rows for every active provider). Cascade FK would handle this
-- anyway, but explicit is clearer in the migration log.
DELETE FROM public.organization_integrations
WHERE provider_id = 'inbound_mail_webhook';

-- 2. Trello: api_key moves to platform env, token replaces it as the
--    required tenant credential. board_id + default_list_id still
--    per-tenant (picked in the post-auth wizard).
UPDATE public.integration_providers
SET config_schema = '{
  "required": ["token", "board_id"],
  "fields": {
    "token":           {"label": "API Token", "secret": true, "filled_by": "oauth-token-grant"},
    "board_id":        {"label": "Board ID", "filled_by": "wizard"},
    "default_list_id": {"label": "Default List ID", "filled_by": "wizard"}
  }
}'::JSONB
WHERE id = 'trello';
