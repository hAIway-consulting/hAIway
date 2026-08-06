# supabase — Datenbank-Details

> Ergänzt Root `CLAUDE.md`. Gilt nur für Arbeit im `supabase/` Verzeichnis.

## Migrations-Konventionen

- Dateiname: `YYYYMMDDHHMMSS_beschreibung.sql`
- Immer RLS aktivieren: `ALTER TABLE x ENABLE ROW LEVEL SECURITY;`
- Zugriff via Funktion: `is_member_of_org(organization_id)`
- Service-Role-Client umgeht RLS (serverseitig OK, Browser = nie)

## Schema-Struktur

Tenant: organizations (plan_id FK, settings JSONB) → organization_members → profiles
Plans: plan_tiers → plan_tier_features → feature_flags
Knowledge: sources → content_chunks (+ pgvector embeddings), source_links,
           source_folders → source_folder_access ← permission_groups
Operative: companies, contacts, projects, activities, process_templates/-instances
Chat/AI: chat_conversations → chat_messages → chat_message_reviews;
         saved_agents, agent_runs, ai_usage_events, ai_provider_keys
Pipeline: raw_events (Bronze) → integration_runs, job_failures, pgmq queues
Features: feature_flags → organization_features (admin overrides), plan_tier_features (plan defaults)
Integrations: integration_providers → organization_integrations (credentials + status per org)
App-Zugriff: member_app_permissions (pro Mitglied, z. B. CRM)
Phone: phone_assistants → phone_numbers → call_logs
Calendar: calendar_integrations (Google OAuth per org)
Admin: profiles.is_platform_admin, is_platform_admin() function

Entfernt im Audit 2026-08-06 (nicht wieder einführen ohne neue Spezifikation):
skills, skill_runs, skill_review_events, automations, automation_templates,
workflow_runs — sowie die längst gedroppten tags / entity_tags.

## RLS-Pattern (Standard)

```sql
-- Enable
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Read
CREATE POLICY "org members read" ON table_name
  FOR SELECT USING (is_member_of_org(organization_id));

-- Write
CREATE POLICY "org members write" ON table_name
  FOR ALL USING (is_member_of_org(organization_id));
```

## Edge Functions — Aufrufer prüfen

`verify_jwt = true` (der Default) beweist nur, dass *irgendein* gültiges Token
geschickt wurde — der öffentliche Anon-Key genügt. Jede Function, die eine
`organization_id` aus dem Request-Body übernimmt und über `getServiceClient()`
an der RLS vorbei arbeitet, muss zusätzlich `requireServiceRole(req)` aus
`functions/_shared/supabase.ts` als erste Anweisung aufrufen (so gelöst in
connector-twenty, connector-gdrive, connector-sharepoint).

Ausnahme: die `phone-assistant-*`-Functions stehen mit `verify_jwt = false` in
`config.toml`, weil Vapi sie als Webhook ohne Supabase-Token aufruft. Dort wäre
ein Service-Role-Guard falsch — sie authentifizieren den Aufrufer über das
Vapi-Shared-Secret: `verifyVapiSignature()` aus `functions/_shared/vapi-verify.ts`
prüft den Header `x-vapi-secret` bzw. `x-vapi-signature` gegen `VAPI_SECRET`.
Achtung: ist `VAPI_SECRET` nicht gesetzt, akzeptiert die Prüfung alles
(Dev-Fallback) — in Produktion muss das Secret gesetzt sein.
