<!--
  Admin-Dashboard — Spezifikation (interne Cross-Tenant-Sichten fürs Cockpit)
  Status: Entwurf (abgeleitet aus dem Cockpit-Spec-Review)
  Letzte Aktualisierung: 2026-06-11
  Bezug: docs/spec-cockpit.md, docs/spec-berater-dashboard.md, docs/strategie.md
-->

# Admin-Dashboard — Spezifikation

> **Hinweis (Audit vom 2026-08-06):** Skills und Automatisierungen wurden im Zuge des
> Feature-Audits ersatzlos aus Code und Datenbank entfernt und werden später neu
> spezifiziert. Die zugehörigen Abschnitte dieser Spezifikation sind entfallen; die
> Nummerierung bleibt erhalten, damit Querverweise aus Code und anderen Specs gültig bleiben.

## 1. Zweck

Das Admin-Dashboard ist die **rein interne**, kundenübergreifende Sicht der Plattform (Persona `haiway`, Gate `profiles.is_platform_admin`). Für das Cockpit liefert es zwei Dinge: das zentrale Provider-/Key-Management und die Plattform-Observability über Runs und AI-Kosten. Kein Inhalt dieser Sichten ist jemals kundenseitig sichtbar.

**Strategy Fit:** Cross-Tenant-Übersicht und Wiederverwendung (Outcome-Templates-Roadmap) sind Orchestrator-Kernfunktionen; alles bleibt multi-tenant-fähig und branchenagnostisch im Kern.

## 2. Ist-Stand & Einordnung

Vorhanden unter `/admin/*` für Plattform-Admins: Kundenliste (`/admin/kunden`) mit Feature-Toggles und Plan-Tiers, `/admin/integrationen` (Runs, KPI-Tageswerte, DLQ), `/admin/ai-settings`, Branding. Diese Spec erweitert das um die Cockpit-bezogenen Cross-Tenant-Sichten; Tabellen kommen aus der Cockpit-Spec §13/§16.

## 3. Automatisierungs-Bibliothek (cross-tenant)

*Entfallen (Audit vom 2026-08-06).* Der Automatisierungs-Komplex inkl. `automations`, `automation_templates` und `workflow_runs` wurde vollständig entfernt und wird neu spezifiziert.

## 4. Skill-Bibliothek (cross-tenant / Branche)

*Entfallen (Audit vom 2026-08-06).* Die Skills-Registry wurde vollständig entfernt und wird neu spezifiziert.

## 5. Provider- & Key-Management (zentral)

- **Plattform-Keys:** Verwaltung der `ai_provider_keys` mit `organization_id IS NULL` (Anlegen, Deaktivieren, Rotation mit `rotated_at`); Env-Keys werden mittelfristig hierher migriert.
- **Tenant-Zuweisungen:** Übersicht, welcher Tenant über welchen Key/Provider läuft (inkl. Constraints wie `eu_only`), als Gegenstück zur Berater-Sicht (Berater-Spec §5).
- **Rotations-Workflow:** neuer Key wird angelegt, Tenants umgezogen, alter Key deaktiviert — mit Prüfschritt, dass kein aktiver Tenant mehr auf dem alten Key hängt.
- **Provider-Status:** Markierung eines Providers als gestört/deprecated → betroffene Tenants und deren Fallback-Konfiguration werden gelistet.

## 6. Plattform-Observability & Kosten

- **Runs cross-tenant:** aggregierte Sicht über `agent_runs` (Volumen, Fehlerraten, p95-Dauer je Tenant/Tag) — Erweiterung des bewährten `integration_kpi_daily`-Musters um entsprechende Views.
- **AI-Kosten cross-tenant:** `ai_usage_events`-Rollup über alle Tenants nach Provider/Modell/Zweck; Gegenüberstellung Kosten ↔ Plan-Tier des Kunden als Grundlage für den Roadmap-Slot „Pricing-Refresh".
- **Quoten-Alarme:** Tenants nahe an oder über `plan_tiers.limits` auf einen Blick.
- **Audit-Zugriff:** Drill-down in einzelne Runs (Digests, keine Roh-Kundendaten als Default) für Support- und Incident-Fälle; jeder Drill-down wird selbst protokolliert.

## 7. Zugriff & Sicherheit

- Gate ausschließlich `profiles.is_platform_admin` (bestehendes Admin-Layout-Gate reicht nicht, da es auch Org-`admin`/`owner` durchlässt — die Cross-Tenant-Seiten brauchen den strikteren Check, wie er in `/admin/kunden` bereits üblich ist).
- Cross-Tenant-Queries laufen über Service-Role/SECURITY-DEFINER-Views, nie über aufgeweichte RLS-Policies; die kundenseitigen RLS-Regeln bleiben unangetastet.
- Dedicated-Instanzen (`FIXED_ORG_ID`-Modus blockiert `/admin` bereits in der Middleware) sind von diesen Sichten ausgenommen.

## 8. Datenmodell-Ergänzungen (nur dieses Dashboard)

- Cross-Tenant-Views: `agent_runs_daily`, `ai_usage_platform_daily` (SECURITY DEFINER, nur Plattform-Admin).
- `admin_audit_log` für Drill-down-Zugriffe (§6): `actor`, `target_org_id`, `resource`, `occurred_at`.

## 9. Offene Entscheidungen

- Abrechnungsrelevanz der Kostenschätzung: reicht die statische Preistabelle (Cockpit-Spec §19) oder braucht Pricing-Refresh exakte Provider-Abrechnungsdaten?
- Aufbewahrungsfristen für Run-Historien und `ai_usage_events` (Datenvolumen vs. Audit-Anforderungen; ggf. Partitionierung wie bei `raw_events`).
- Ob Quoten-Alarme aktiv benachrichtigen (E-Mail an zuständigen Berater) oder nur im Dashboard erscheinen.
