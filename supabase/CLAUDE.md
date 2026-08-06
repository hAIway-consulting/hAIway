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
Operative: companies, contacts, projects, activities → activity_links
Chat/AI: chat_conversations → chat_messages → chat_message_reviews;
         saved_agents, agent_runs, ai_usage_events, ai_provider_keys
Pipeline: raw_events (Bronze) → integration_runs, job_failures,
          pgmq queues (nur normalize, embed, extract)
Features: feature_flags → organization_features (admin overrides), plan_tier_features (plan defaults)
Integrations: integration_providers → organization_integrations (credentials + status per org)
App-Zugriff: member_app_permissions (pro Mitglied, z. B. CRM)
Phone: phone_assistants → phone_numbers → call_logs
Calendar: calendar_integrations (Google OAuth per org)
Admin: profiles.is_platform_admin, is_platform_admin() function

Entfernt im Audit 2026-08-06 (nicht wieder einführen ohne neue Spezifikation):
skills, skill_runs, skill_review_events, automations, automation_templates,
workflow_runs, entities_calendar_events sowie das Prozess-/Mapping-Modell
(process_templates, process_template_steps, process_instances,
process_instance_steps, entity_mappings, kpi_baselines) — dazu die längst
gedroppten tags / entity_tags.

Ebenfalls entfallen: die Feature-Flags skills, webhook_connector, cockpit,
doc_generation, process_management (niemand hat sie je abgefragt), die
pgmq-Queues ingest und index (nie ein Producer oder Consumer) und die RPCs
get_process_analysis, get_template_performance, get_process_dashboard,
get_activities_for_entity, get_activity_links_resolved, get_kpi_summary,
get_external_entity.

activities / activity_links BLEIBEN: phone-assistant-call-complete schreibt
dorthin, get_caller_context liest sie für das Anrufer-Briefing.

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
geschickt wurde — der öffentliche Anon-Key genügt. Jede Function, die über
`getServiceClient()` an der RLS vorbei arbeitet, muss zusätzlich
`requireServiceRole(req)` aus `functions/_shared/supabase.ts` als erste
Anweisung aufrufen — sowohl die Connectoren (organization_id aus dem Body) als
auch die Worker (Queue-Drain mit Embedding-/LLM-Kosten). So gelöst in
connector-twenty, connector-gdrive, connector-sharepoint, worker-normalize,
worker-embed, worker-extract-entities.

Die zugehörigen pg_cron-Jobs müssen sich dann als `service_role` ausweisen:
über `public.invoke_edge_function_async()` bzw. `public.invoke_edge_function()`,
die den Key aus `vault.decrypted_secrets` lesen (Secrets `project_url` und
`service_role_key` — Anlage siehe Kopf von
`20260806100000_connector_crons_service_role.sql`). Beide Helfer akzeptieren
nur Function-Namen aus einer festen Positivliste; neue Functions dort
eintragen. Reihenfolge beim Ausrollen: erst Migration, dann
`supabase functions deploy` — sonst antworten die Crons 401.

## SECURITY DEFINER — Grants sind nicht optional

Postgres vergibt für jede neue Funktion automatisch `EXECUTE TO PUBLIC`. Eine
`SECURITY DEFINER`-Funktion ohne explizites `REVOKE` ist damit über PostgREST
für `anon` und `authenticated` aufrufbar — auch wenn die Migration sie
„nur an service_role" gegrantet hat. Jede neue SECURITY-DEFINER-Funktion
braucht deshalb beides:

```sql
REVOKE ALL ON FUNCTION public.foo(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.foo(UUID) TO service_role;
```

Funktionen, die ein Nutzer-Client aufrufen darf und die eine `organization_id`
als Parameter nehmen, prüfen zusätzlich im Body
`public.is_service_request() OR public.is_member_of_org(p_org_id)` und werfen
sonst `ERRCODE 42501`. `is_member_of_org()` allein reicht nicht: bei einem
Service-Role-Request ist `auth.uid()` NULL, die Prüfung schlägt dann fehl.

Spalten mit Geheimnissen (`organization_integrations.credentials`,
`calendar_integrations.refresh_token/access_token`) lassen sich per RLS nicht
ausblenden — dafür wird der Tabellen-Grant entzogen und ein Spalten-Grant
gesetzt. Konsequenz: `select("*")` mit dem Nutzer-Client scheitert auf diesen
Tabellen, Spalten immer explizit auflisten.

Ausnahme: die `phone-assistant-*`-Functions stehen mit `verify_jwt = false` in
`config.toml`, weil Vapi sie als Webhook ohne Supabase-Token aufruft. Dort wäre
ein Service-Role-Guard falsch — sie authentifizieren den Aufrufer über das
Vapi-Shared-Secret: `verifyVapiSignature()` aus `functions/_shared/vapi-verify.ts`
prüft den Header `x-vapi-secret` bzw. `x-vapi-signature` gegen `VAPI_SECRET`.

`VAPI_SECRET` ist damit PFLICHT, nicht optional: es ist das einzige, was diese
beiden Endpunkte vom offenen Internet trennt. Die Prüfung war bis zum Audit
2026-08-06 fail-open (fehlendes Secret ⇒ alles akzeptiert) — und im
Produktionsprojekt war das Secret nicht gesetzt. Sie ist jetzt fail-closed:
ohne Secret wird abgelehnt. Vor dem nächsten `functions deploy` muss also

```
supabase secrets set VAPI_SECRET=<wert> --project-ref <ref>
```

gesetzt sein UND derselbe Wert als `serverUrlSecret` am Vapi-Assistenten
hinterlegt werden (passiert automatisch beim nächsten `syncVapiConfig`, sofern
`VAPI_SECRET` auch in den Vercel-Envs steht). Lokal ohne Secret arbeiten geht
nur über das ausdrückliche `VAPI_ALLOW_UNVERIFIED=true`.
