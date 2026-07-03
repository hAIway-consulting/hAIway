# supabase — Datenbank-Details

> Ergänzt Root `CLAUDE.md`. Gilt nur für Arbeit im `supabase/` Verzeichnis.

## Migrations-Konventionen

- Dateiname: `YYYYMMDDHHMMSS_beschreibung.sql`
- Immer RLS aktivieren: `ALTER TABLE x ENABLE ROW LEVEL SECURITY;`
- Zugriff via Funktion: `is_member_of_org(organization_id)`
- Service-Role-Client umgeht RLS (serverseitig OK, Browser = nie)

## Schema-Struktur

Tenant: organizations (plan_id FK) → organization_members → profiles
Plans: plan_tiers → plan_tier_features → feature_flags
Knowledge: sources → content_chunks (+ pgvector embeddings), source_links
Operative: companies, contacts, projects
Features: feature_flags → organization_features (admin overrides), plan_tier_features (plan defaults)
Integrations: integration_providers → organization_integrations (credentials + status per org)
Automations: automation_templates → automation_template_versions (immutable, content-gehasht)
  → organization_automations (Aktivierung + params per org)
  → automation_runs → automation_step_runs (Audit; Approval-Felder am Step)
  Dispatch: dispatch_automation_triggers() aus worker-normalize · Freigabe: decide_automation_step()
Pipeline: pgmq-Queues (ingest, normalize, embed, index, extract, automation), raw_events (Bronze), integration_runs, job_failures
Phone: phone_assistants → phone_numbers → call_logs
Calendar: calendar_integrations (Google OAuth per org)
Admin: profiles.is_platform_admin, is_platform_admin() function

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

## Edge Functions — geteilte Verträge

- `supabase/functions/deno.json` mappt `@haiway/contracts(/*)` auf `packages/contracts/src/` — Typen/Zod-Schemas werden mit der Next-App geteilt.
- **Queue-Message-Shapes nur in `@haiway/contracts/queue-messages` definieren**, nie inline im Worker.
- Vor Push: `deno check --config supabase/functions/deno.json supabase/functions/<fn>/index.ts`. `deno.lock` ist gitignored.
- Worker-Muster (Batch, Visibility-Timeout, deadLetter → job_failures): siehe `worker-normalize`; Automation-Executor: `worker-automation`.
