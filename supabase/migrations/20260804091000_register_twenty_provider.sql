-- Migration: register_twenty_provider
--
-- Registers the self-hosted Twenty CRM workspace as an integration provider.
-- Credentials layout in organization_integrations:
--   credentials: { api_key, service_email?, service_password? }  -- secrets only
--   config:      { base_url, role_map, default_level, last_drift } -- non-secret
--
-- role_map shape (level -> Twenty role), editable in /admin/crm without code:
--   { "member": {"twenty_role_id": "…", "label": "Mitglied"},
--     "admin":  {"twenty_role_id": "…", "label": "Admin"} }
--
-- NOTE (known platform-wide follow-up, deliberately NOT changed here):
-- organization_integrations rows are row-readable by all org members via RLS
-- (member-facing /quellen and workflow surfaces rely on that). The Twenty
-- api_key therefore shares the same exposure class as existing Trello/Shopware
-- credentials. All Twenty credential reads happen server-side (service client /
-- edge function); hardening credential storage for every provider is a
-- separate migration once member-facing readers stop selecting these rows.

INSERT INTO public.integration_providers (id, name, category, auth_type, config_schema, feature_key) VALUES
  ('twenty',
   'Twenty CRM',
   'crm',
   'api_key',
   '{
      "required": ["base_url", "api_key"],
      "fields": {
        "base_url":         {"label": "Twenty-URL", "placeholder": "https://crm.example.com"},
        "api_key":          {"label": "API Key", "secret": true},
        "service_email":    {"label": "Service-Login E-Mail (fuer Einladungen)", "optional": true},
        "service_password": {"label": "Service-Login Passwort", "secret": true, "optional": true}
      }
    }'::JSONB,
   'crm_workspace')
ON CONFLICT (id) DO NOTHING;
