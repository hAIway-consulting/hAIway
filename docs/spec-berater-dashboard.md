<!--
  Berater-Dashboard — Spezifikation (Cockpit-Verwaltung)
  Status: Entwurf (abgeleitet aus dem Cockpit-Spec-Review)
  Letzte Aktualisierung: 2026-06-11
  Bezug: docs/spec-cockpit.md, docs/strategie.md (Prinzip „Berater-First, Kunde-Second"),
         docs/spec-admin-dashboard.md
-->

# Berater-Dashboard — Spezifikation

## 1. Zweck

Das Berater-Dashboard ist die Verwaltungsseite des hAIway Cockpits: Hier richtet der Berater pro Kunden-Org ein, was der Kunde im Cockpit sieht und darf, gibt Skills frei, steuert Automatisierungen und überwacht Nutzung, Kosten und Ergebnisse. Es setzt das Strategie-Prinzip „Berater-First, Kunde-Second" um — nichts wird für den Kunden sichtbar, was der Berater nicht freigegeben hat.

**Strategy Fit:** Direkter Roadmap-Slot „Berater-Cockpit" aus `docs/strategie.md`; alle Funktionen sind Konfigurations-, Freigabe- oder Mess-Funktionen des Orchestrators und multi-tenant angelegt.

## 2. Ist-Stand & Einordnung

Bereits vorhanden und Ausgangsbasis:

- **Berater-Übersicht** (`apps/web/src/app/_workspace/berater-overview.tsx`): KPI-Kacheln, Orchestrator-Karte (`get_workflow_kpi()`), Aktivitäts-Timeline, Schnellaktionen.
- **Admin-Subseiten** für Berater (`/admin/integrationen`, `/admin/daten`, `/admin/branding`, `/admin/retrieval-qualitaet`, `/admin/ai-settings`): Sync-Runs inkl. DLQ-Replay, Datenpools, AI-Einstellungen (Default-Modell, Ton, Sprache).
- **Rollen-Gate:** `requireBeraterRole()` (`admin`/`owner` der Org) bzw. Admin-Layout-Gate.

Diese Spec ergänzt die fehlenden Verwaltungs-Sichten für die neuen Cockpit-Konzepte (Skills, gespeicherte Agenten, Automatisierungen, Routing, Kosten). Datenmodell-Grundlagen (Tabellen `skills`, `saved_agents`, `automations`, `agent_runs`, `skill_runs`, `ai_usage_events`, `ai_provider_keys`) sind in der Cockpit-Spec §13/§16 definiert und werden hier nur genutzt, nicht neu erfunden.

## 3. Skill-Freigabe & -Verwaltung

Der Freigabe-Workflow aus Cockpit-Spec §8, aus Berater-Sicht:

- **Review-Queue:** Liste aller Skills des Tenants mit Status `draft / in_review / approved / active / rejected`. Neue Vorschläge aus dem geführten Kunden-Flow landen in `in_review` und erzeugen eine Benachrichtigung.
- **Review-Ansicht:** Prompt-Template im Klartext, referenzierte Tools mit Access-Level (`read`/`write`), Tenant-Parameter. Der Berater kann das Template direkt bearbeiten, mit Rückfrage an den Kunden zurückgeben (`draft` + Kommentar) oder ablehnen.
- **Sandbox-Test:** Vor Aktivierung Pflicht-Testlauf gegen die Sandbox-Org (`claude-test`-Muster aus dem Dev-Loop); Ergebnis wird als `skill_run` mit `trigger = 'sandbox'` protokolliert und in der Review-Ansicht angezeigt.
- **Aktivierung & Sichtbarkeit:** `approved → active` schaltet den Skill im Cockpit des Kunden frei. Der Berater kann aktive Skills jederzeit deaktivieren; der Kunde kann aktivierte Skills für sich ein-/ausblenden, aber nicht ändern.
- **Versionierung:** Änderungen an aktiven Skills erzeugen eine neue `version` mit erneuter Freigabe; laufende Konversationen nutzen die Version, mit der sie gestartet wurden.

## 4. Automatisierungs-Verwaltung

- **Liste pro Tenant:** alle `automations` der Org mit Status (`active/stopped`), benötigten Providern (`requires` gegen `organization_integrations` geprüft — fehlende/fehlerhafte Integrationen werden als Blocker angezeigt) und KPI-Kurzwerte.
- **Start/Stopp & Konfiguration:** ausschließlich hier (Kunde sieht nur Ergebnisse, Cockpit-Spec §10). Konfigurationsänderungen werden mit Zeitstempel/Autor protokolliert.
- **Run-Detail & Fehler-Triage:** Drill-down in `workflow_runs` (Steps-JSON, Quelle/Ziel-Referenzen, Fehlermeldung). Wiederverwendung des bestehenden Musters aus `/admin/integrationen`: Status-Pills, Letzte-Läufe-Tabelle, Dead-Letter-Ansicht mit Replay (`job_failures` / `replay_job_failure()`), sofern die Automatisierung über pgmq läuft.
- **KPI-Parameter:** Pflege von `minutes_saved_per_run` pro Automatisierung (KPI-v1-Modell, Cockpit-Spec §10). Das Dashboard zeigt die daraus berechnete eingesparte Zeit, wie sie auch der Kunde sieht — keine zwei Wahrheiten.

## 5. Modell-Routing & Datenschutz pro Tenant

Erweiterung der bestehenden Seite `/admin/ai-settings`:

- **Default-Modell** (bestehend) plus **Provider-Allowlist** und **Constraints** (z. B. `eu_only`) gemäß Cockpit-Spec §5.3.
- **Embedding-Provider** des Tenants wählbar; bei Wechsel zeigt das UI den nötigen Re-Embedding-Lauf an und stößt ihn über die bestehende `embed`-Queue an (mit Fortschritt aus `integration_runs`-Muster).
- **Key-Zuweisung:** Auswahl, ob der Tenant über Plattform-Keys oder eigene Keys (`ai_provider_keys` mit `organization_id`) läuft; eigene Keys können hier hinterlegt/rotiert werden. Die zentrale Key-Verwaltung über alle Tenants liegt im Admin-Dashboard (Admin-Spec §5).
- **Validierung:** Eine Konfiguration, die gegen Constraints verstößt (z. B. `eu_only` + Nicht-EU-Embedding-Provider), kann nicht gespeichert werden.

## 6. Cockpit-Aufsicht & Audit

- **Konversationen:** Berater sehen alle Konversationen der Org (heutiges Scoping bleibt: `member` nur eigene). Inklusive Modus-Badge (chat/agent) und Retrieval-Telemetrie (bestehender Debug-Panel `retrieval-debug.tsx`).
- **Agent-Runs:** Liste aus `agent_runs` mit Tool-Aufrufen (inkl. bestätigt/abgebrochen bei Write-Aktionen), Dauer, Tokens, Fehler. Filter nach Nutzer, gespeicherten Agenten, Zeitraum.
- **Skill-Runs:** analog aus `skill_runs`, inkl. Sandbox-Läufe.
- **Gespeicherte Agenten:** Übersicht aller `saved_agents` des Tenants (auch private — Aufsichtsfunktion), mit Möglichkeit zu deaktivieren (`status = 'disabled'`); Inhalte editiert der Berater nicht, das bleibt beim Kunden (Rollen-Matrix Cockpit-Spec §11).

## 7. Nutzung & Kosten

- **Tenant-Dashboard auf Basis `ai_usage_events`:** Tokens und Kostenschätzung pro Tag/Monat, aufgeschlüsselt nach Zweck (chat/agent/skill/automation/embedding) und Modell. Aggregat-View nach dem Muster `integration_kpi_daily`.
- **Quoten-Status:** Verbrauch gegen `plan_tiers.limits` (z. B. `max_ai_tokens_month`) mit Warnschwelle (80 %) und Anzeige, wenn Limits Cockpit-Anfragen blockieren (Cockpit-Spec §12.3).
- **Outcome-KPIs:** eingesparte Zeit pro Automatisierung (aus `kpi_events`) neben Nutzungs-KPIs — Ergebnis- vor Feature-Sicht (Strategy-Gate-Frage 2).

## 8. Navigation & UI-Rahmen

- Neue Sektion im Berater-Bereich (Persona `berater`), z. B. `/admin/cockpit` mit Tabs: **Skills · Automatisierungen · Agenten & Runs · Modelle & Kosten**. Bestehende Seiten (`ai-settings`, `automatisierungen`) gehen darin auf bzw. verlinken dorthin.
- UI-Konventionen wie überall: deutsche UI-Texte, Tokens aus `globals.css`, mobile-first, 44px-Touch-Targets, `rounded-xl`-Cards.

## 9. Datenmodell-Ergänzungen (nur dieses Dashboard)

Keine eigenen Kerntabellen — genutzt werden die in der Cockpit-Spec §16 definierten. Zusätzlich:

- `skills.review_comment` bzw. ein leichtgewichtiges `skill_review_events`-Log (Status-Wechsel, Autor, Kommentar) für den Rückfrage-Loop in §3.
- `automations.config_history` (JSONB-Log) oder Audit-Trigger für §4-Konfigurationsänderungen.
- Tagesaggregat-View `ai_usage_daily` (organization_id, day, purpose, model, tokens, cost).

## 10. Offene Entscheidungen

- Benachrichtigungskanal für Review-Anfragen (nur In-App-Badge vs. E-Mail via Resend, vgl. `docs/setup-resend.md`).
- Vier-Augen-Prinzip bei branchen-scoped Skills (Berater + Plattform-Admin) — betrifft Schnittstelle zur Admin-Spec §4.
- Ob Berater Konversations-*Inhalte* von `member`-Nutzern standardmäßig sehen oder nur Metadaten (Datenschutz-Abwägung pro Kunde, ggf. Org-Setting).
- Granularität der Quoten (nur Tenant-Monat vs. zusätzlich pro Nutzer/Tag).
