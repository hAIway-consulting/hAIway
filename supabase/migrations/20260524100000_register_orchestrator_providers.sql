-- Migration: register_orchestrator_providers
--
-- Seeds integration_providers needed for cross-system orchestration:
--   shopware              — Shopware 6 Admin API (orders/customers/returns)
--   trello                — Trello REST API (cards on a configured board)
--   imap_inbox            — Generic IMAP polling for self-hosted/forwarded mail
--   inbound_mail_webhook  — Signed HTTP inbox for mail-forwarding providers
--
-- Each provider is registered with auth_type + a JSON config_schema that the
-- berater-facing wizard can render. No cron is scheduled here — connectors
-- run on demand for now; cron gets enabled per-tenant once a Pilot is live.

INSERT INTO public.integration_providers (id, name, category, auth_type, config_schema, feature_key) VALUES
  ('shopware',
   'Shopware 6',
   'crm',
   'api_key',
   '{
      "required": ["base_url", "client_id", "client_secret"],
      "fields": {
        "base_url":      {"label": "Shop-URL", "placeholder": "https://shop.example.com"},
        "client_id":     {"label": "Integration Client ID"},
        "client_secret": {"label": "Integration Client Secret", "secret": true}
      }
    }'::JSONB,
   NULL),

  ('trello',
   'Trello',
   'crm',
   'api_key',
   '{
      "required": ["api_key", "token", "board_id"],
      "fields": {
        "api_key":  {"label": "API Key"},
        "token":    {"label": "API Token", "secret": true},
        "board_id": {"label": "Board ID"},
        "default_list_id": {"label": "Default List ID", "optional": true}
      }
    }'::JSONB,
   NULL),

  ('imap_inbox',
   'IMAP Inbox',
   'messaging',
   'api_key',
   '{
      "required": ["host", "port", "username", "password"],
      "fields": {
        "host":     {"label": "IMAP Host", "placeholder": "imap.example.com"},
        "port":     {"label": "Port", "default": 993},
        "username": {"label": "Benutzername"},
        "password": {"label": "Passwort", "secret": true},
        "tls":      {"label": "TLS", "default": true},
        "mailbox":  {"label": "Mailbox", "default": "INBOX"}
      }
    }'::JSONB,
   NULL),

  ('inbound_mail_webhook',
   'Inbound Mail Webhook',
   'messaging',
   'webhook',
   '{
      "required": ["shared_secret"],
      "fields": {
        "shared_secret": {"label": "Shared Secret (HMAC)", "secret": true},
        "from_allowlist": {"label": "From-Allowlist (optional)", "optional": true}
      }
    }'::JSONB,
   NULL)
ON CONFLICT (id) DO NOTHING;
