<!--
  Berater-Dashboard — Spezifikation (Cockpit-Verwaltung)
  Status: Entwurf (abgeleitet aus dem Cockpit-Spec-Review)
  Letzte Aktualisierung: 2026-06-11
  Bezug: docs/spec-cockpit.md, docs/strategie.md (Prinzip „Berater-First, Kunde-Second"),
         docs/spec-admin-dashboard.md
-->

# Berater-Dashboard — Spezifikation

> **Hinweis (Audit vom 2026-08-06):** Skills und Automatisierungen wurden im Zuge des
> Feature-Audits ersatzlos aus Code und Datenbank entfernt und werden später neu
> spezifiziert. Die zugehörigen Abschnitte dieser Spezifikation sind entfallen; die
> Nummerierung bleibt erhalten, damit Querverweise aus Code und anderen Specs gültig bleiben.

## 1. Zweck

Das Berater-Dashboard ist die Verwaltungsseite des hAIway Cockpits: Hier richtet der Berater pro Kunden-Org ein, was der Kunde im Cockpit sieht und darf, und überwacht Nutzung, Kosten und Ergebnisse. Es setzt das Strategie-Prinzip „Berater-First, Kunde-Second" um — nichts wird für den Kunden sichtbar, was der Berater nicht freigegeben hat.

**Strategy Fit:** Direkter Roadmap-Slot „Berater-Cockpit" aus `docs/strategie.md`; alle Funktionen sind Konfigurations-, Freigabe- oder Mess-Funktionen des Orchestrators und multi-tenant angelegt.

## 2. Ist-Stand & Einordnung

Bereits vorhanden und Ausgangsbasis:

- **Berater-Übersicht** (`apps/web/src/app/_workspace/berater-overview.tsx`): KPI-Kacheln, Aktivitäts-Timeline, Schnellaktionen.
- **Admin-Subseiten** für Berater (`/admin/integrationen`, `/admin/daten`, `/admin/retrieval-qualitaet`, `/admin/ai-settings`): Sync-Runs inkl. DLQ-Replay, Datenpools, AI-Einstellungen (Default-Modell, Ton).
- **Rollen-Gate:** `requireBeraterRole()` (`admin`/`owner` der Org) bzw. Admin-Layout-Gate.

Diese Spec ergänzt die fehlenden Verwaltungs-Sichten für die verbleibenden Cockpit-Konzepte (gespeicherte Agenten, Routing, Kosten). Datenmodell-Grundlagen (Tabellen `saved_agents`, `agent_runs`, `ai_usage_events`, `ai_provider_keys`) sind in der Cockpit-Spec §13/§16 definiert und werden hier nur genutzt, nicht neu erfunden.

## 3. Skill-Freigabe & -Verwaltung

*Entfallen (Audit vom 2026-08-06).* Die Skills-Registry wurde vollständig entfernt und wird neu spezifiziert.

## 4. Automatisierungs-Verwaltung

*Entfallen (Audit vom 2026-08-06).* Der Automatisierungs-Komplex wurde vollständig entfernt und wird neu spezifiziert.

## 5. Modell-Routing & Datenschutz pro Tenant

Erweiterung der bestehenden Seite `/admin/ai-settings`:

- **Default-Modell** (bestehend) plus **Provider-Allowlist** und **Constraints** (z. B. `eu_only`) gemäß Cockpit-Spec §5.3.
- **Embedding-Provider** des Tenants wählbar; bei Wechsel zeigt das UI den nötigen Re-Embedding-Lauf an und stößt ihn über die bestehende `embed`-Queue an (mit Fortschritt aus `integration_runs`-Muster).
- **Key-Zuweisung:** Auswahl, ob der Tenant über Plattform-Keys oder eigene Keys (`ai_provider_keys` mit `organization_id`) läuft; eigene Keys können hier hinterlegt/rotiert werden. Die zentrale Key-Verwaltung über alle Tenants liegt im Admin-Dashboard (Admin-Spec §5).
- **Validierung:** Eine Konfiguration, die gegen Constraints verstößt (z. B. `eu_only` + Nicht-EU-Embedding-Provider), kann nicht gespeichert werden.

## 6. Cockpit-Aufsicht & Audit

- **Konversationen:** Berater sehen alle Konversationen der Org (heutiges Scoping bleibt: `member` nur eigene). Inklusive Modus-Badge (chat/agent) und Retrieval-Telemetrie (bestehender Debug-Panel `retrieval-debug.tsx`).
- **Agent-Runs:** Liste aus `agent_runs` mit Tool-Aufrufen (inkl. bestätigt/abgebrochen bei Write-Aktionen), Dauer, Tokens, Fehler. Filter nach Nutzer, gespeicherten Agenten, Zeitraum.
- **Gespeicherte Agenten:** Übersicht aller `saved_agents` des Tenants (auch private — Aufsichtsfunktion), mit Möglichkeit zu deaktivieren (`status = 'disabled'`); Inhalte editiert der Berater nicht, das bleibt beim Kunden (Rollen-Matrix Cockpit-Spec §11).

## 7. Nutzung & Kosten

- **Tenant-Dashboard auf Basis `ai_usage_events`:** Tokens und Kostenschätzung pro Tag/Monat, aufgeschlüsselt nach Zweck (chat/agent/embedding) und Modell. Aggregat-View nach dem Muster `integration_kpi_daily`.
- **Quoten-Status:** Verbrauch gegen `plan_tiers.limits` (z. B. `max_ai_tokens_month`) mit Warnschwelle (80 %) und Anzeige, wenn Limits Cockpit-Anfragen blockieren (Cockpit-Spec §12.3).

## 8. Navigation & UI-Rahmen

- Neue Sektion im Berater-Bereich (Persona `berater`), z. B. `/admin/cockpit` mit Tabs: **Agenten & Runs · Modelle & Kosten**. Die bestehende Seite `ai-settings` verlinkt dorthin.
- UI-Konventionen wie überall: deutsche UI-Texte, Tokens aus `globals.css`, mobile-first, 44px-Touch-Targets, `rounded-xl`-Cards.

## 9. Datenmodell-Ergänzungen (nur dieses Dashboard)

Keine eigenen Kerntabellen — genutzt werden die in der Cockpit-Spec §16 definierten. Zusätzlich:

- Tagesaggregat-View `ai_usage_daily` (organization_id, day, purpose, model, tokens, cost).

## 10. Offene Entscheidungen

- Ob Berater Konversations-*Inhalte* von `member`-Nutzern standardmäßig sehen oder nur Metadaten (Datenschutz-Abwägung pro Kunde, ggf. Org-Setting).
- Granularität der Quoten (nur Tenant-Monat vs. zusätzlich pro Nutzer/Tag).
