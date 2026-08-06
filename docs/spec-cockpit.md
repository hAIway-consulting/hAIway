<!--
  hAIway Cockpit — Spezifikation
  Status: Überarbeitet nach Backend-Review (launch-ready Entwurf)
  Letzte Aktualisierung: 2026-06-11
  Bezug: docs/strategie.md (Strategy Gate, Architektur-Prinzipien),
         docs/spec-berater-dashboard.md, docs/spec-admin-dashboard.md
-->

# hAIway Cockpit — Spezifikation

> **Hinweis (Audit vom 2026-08-06):** Skills und Automatisierungen wurden im Zuge des
> Feature-Audits ersatzlos aus Code und Datenbank entfernt und werden später neu
> spezifiziert. Die zugehörigen Abschnitte (§7, §8, §10, §17) sind entfallen; die
> Nummerierung bleibt erhalten, damit Querverweise aus Code und anderen Specs gültig bleiben.

## 1. Zweck & Umbenennung

Der bisherige „Chat" wird zum **hAIway Cockpit** — dem zentralen Einstiegspunkt für KI-gestützte Anfragen in der Übersicht.

Das Cockpit ist nicht nur ein Chatfenster, sondern die Bedienoberfläche für zwei Betriebsarten (Chat und Agent) auf Basis der mandantengetrennten Kundendaten. Es bleibt direkt in der Übersicht erreichbar und für Fragen verfügbar.

## 2. Geltungsbereich

Diese Spezifikation umfasst:

- **Konversationsverlauf** — Auflistung aller bisherigen Chats, um in bestehenden Anfragen weiterzuarbeiten und Kontext festzuhalten (statt nur aus dem letzten Kontext zu arbeiten).
- **Modus-Toggle** — Umschalten zwischen *normaler Chatanfrage* und *agentischer Anfrage* (§12).
- **Ablösung der bisherigen Suche** — das Cockpit übernimmt deren Platz (§4).
- **Mandantentrennung & Datenschutz** — harte Anforderung (§5).
- **Gespeicherte Agenten** — vom Kunden selbst angelegte, per Klick auslösbare Agenten (§9).
- **Rollen, Audit, Limits, Flags** — Querschnittsthemen für den Produktstart (§11–§15).

Die Verwaltungs-Sichten auf dieselben Konzepte sind in eigenen Specs beschrieben: **Berater-Dashboard** (`docs/spec-berater-dashboard.md`) und **Admin-Dashboard** (`docs/spec-admin-dashboard.md`).

## 3. Ist-Stand & Wiederverwendung

Wesentliche Teile des Cockpits existieren bereits — die Spec beschreibt das Delta, nicht den Neubau:

| Baustein | Existiert bereits | Delta für das Cockpit |
|---|---|---|
| Konversationsverlauf | `chat_conversations` + `chat_messages` mit RLS, Sidebar, „Letzte Chats" auf der Übersicht, Telemetrie (`chunk_ids`, `retrieval_arms`, `latency_ms`, `token_usage`) | Umbenennung/Platzierung als Cockpit, Modus-Persistenz (§12.4) |
| Hybrid-Suche | `hybrid_search_chunks` / `hybrid_search_boosted` (FTS + pgvector, RRF), Entity-Boosting, Listing-Erkennung, Folder-Permission-Filter (`p_user_id`) | wird zum Chat-Modus-Backbone, `/search` entfällt (§4) |
| Agent-Loop | `apps/web/src/lib/ai/agent/` — Tool-Use-Loop mit Anthropic- und OpenAI-kompatiblem Adapter, Tool-Registry (`registry.ts`, 4 Tools) | sichtbarer Modus-Toggle, Tool-Permissions, Limits, Run-Historie (§12–§13) |
| Modell-Routing | Org-Default in `organizations.settings.ai.agent`, Admin-UI `/admin/ai-settings`, Auflösung in `lib/ai/agent/config.ts` (der ungenutzte Wrapper `lib/ai/gateway.ts` wurde entfernt) | Per-Tenant-Keys, Datenschutz-Constraints, Embedding-Routing, Usage-Tracking (§5) |
| Gespeicherte Agenten | DB-backed `saved_agents` + Agent-Tiles auf der Workspace-Home | „Diesen Agenten speichern"-Flow (§9) |
| Worker-Runtime | pgmq-Queues (ingest/normalize/embed/extract), 14 Edge Functions, pg_cron, DLQ `job_failures` + Replay | generischer Doc-Worker (§14) |
| Feature-Flags | `feature_flags`, `organization_features`, `plan_tiers`, `org_has_feature()` | neue Keys + Tier-Zuordnung (§15) |

## 4. Ablösung der bisherigen Suche

Das bestehende Such-Feld kann **vollständig entfernt** werden. Das hAIway Cockpit nimmt diesen Platz in der Übersicht ein und deckt die bisherige Suchfunktion über die mandantengetrennte Hybrid-Suche im Chat-Modus mit ab.

Konkrete Ablösung:

- Route `/search` und der Eintrag in der Workspace-Navigation entfallen.
- Feature-Flag `search` (Core-Flag, geseedet) wird deprecated und durch `cockpit` ersetzt (§15); bestehende Org-Overrides werden migriert.
- Die Such-RPCs (`search_chunks`, `hybrid_search_chunks`, `hybrid_search_boosted`) bleiben unverändert bestehen — sie sind das Retrieval-Backend des Chat-Modus.

## 5. Mandantentrennung & Datenschutz (nicht verhandelbar)

> Chat und Agent dürfen **ausschließlich** auf die Daten des eingeloggten Tenants Auskunft geben. Es dürfen **niemals** Daten eines anderen Kunden in der Suche auftauchen oder berücksichtigt werden.

### 5.1 Datengrenze

- **Durchgesetzt an der Datengrenze, nicht an der Modell-Grenze.** Jeder Datenzugriff läuft über den tenant-scoped User-Token; die RLS-Policies des Aufrufers greifen automatisch. Ein Agent oder Modell sieht immer nur das, was über diesen Token geladen und im Prompt/Tool-Result übergeben wurde.
- **Zusätzlich zur Tenant-Grenze gilt die Nutzer-Grenze:** Das bestehende Folder-/Permission-Group-Modell (`source_folders`, `permission_groups`, `user_can_access_source()`) wird in **allen** Cockpit-Pfaden respektiert — Chat-Retrieval tut das heute über `p_user_id`; Agent-Tools müssen denselben Filter anwenden (§12.2).

### 5.2 Multi-Provider & Per-Tenant-Keys

- **Multi-Provider by design.** API-Keys/Tokens werden je Modellanbieter bezogen, pro Kunde zugewiesen und für die Nutzungsverfolgung getrackt.
- **Key-Speicherung:** Tabelle `ai_provider_keys` (Skizze §16), verschlüsselt nach dem Muster von `organization_integrations.credentials`. Env-Keys (`ANTHROPIC_API_KEY`, `OPENAI_*`) bleiben als Plattform-Fallback für Tenants ohne eigene Zuweisung. Auflösungsreihenfolge: Tenant-Key → Plattform-Key.
- **Usage-Tracking:** Jede Modell-Interaktion (Chat, Agent, Embedding) schreibt ein Event in `ai_usage_events` (Tenant, Provider, Modell, Tokens in/out, Kostenschätzung, Kontext-Referenz). `chat_messages.token_usage` bleibt als Detail erhalten; das Rollup für Dashboards und Quoten läuft über `ai_usage_events`.

### 5.3 Modell-Routing = Datenschutz-Hebel

- „Kunde X darf nur EU-Modell Y" ist eine Routing-Regel pro Tenant, keine Architekturänderung. Datenabruf und Verarbeitung bleiben unabhängig vom gewählten Modell in der eigenen Infrastruktur.
- Routing-Konfiguration pro Tenant: Default-Modell, erlaubte Provider (Allowlist), Constraints (z. B. `eu_only`). Gepflegt vom Berater (`/admin/ai-settings`, siehe Berater-Spec §5).
- **Embeddings sind Teil des Routings.** Heute laufen Embeddings hart über OpenAI `text-embedding-3-small` (`lib/ai/embeddings.ts`) — damit gehen Suchanfragen und Chunk-Inhalte aller Tenants an OpenAI, unabhängig vom Chat-Modell. Das ist eine Datenschutz-Lücke und wird geschlossen: Der Embedding-Provider wird pro Tenant konfigurierbar (gleiche Routing-Tabelle); ein Provider-Wechsel erfordert Re-Embedding der `content_chunks` des Tenants (dimensionskompatibel oder mit Re-Index-Lauf über die bestehende `embed`-Queue). Bis dahin gilt: Tenants mit `eu_only`-Constraint können nicht onboarded werden — das ist eine bewusste Launch-Schranke, kein stiller Default.

### 5.4 Scope

- **Alles tenant-scoped.** Gespeicherte Agenten werden immer unter dem jeweiligen Tenant angelegt — nie global. Eine globale Übersicht existiert ausschließlich intern im Admin-Dashboard.

## 6. Erweiterungskonzepte im Überblick

Nach dem Audit vom 2026-08-06 bleibt genau eine Erweiterungsart:

| Konzept | Wer legt an | Auslösung | Management | Scope |
|---|---|---|---|---|
| **Gespeicherter Agent** | Kunde selbst (aus dem Agenten-Modus speichern) | per Mausklick aus der Übersicht | durch den Kunden | tenant-scoped |

## 7. Skill-System

*Entfallen (Audit vom 2026-08-06).* Die Skills-Registry wurde vollständig aus Code und Datenbank entfernt und wird neu spezifiziert.

## 8. Skill-Lebenszyklus & Self-Service

*Entfallen (Audit vom 2026-08-06).* Siehe §7.

## 9. Gespeicherte Agenten (wiederkehrende Tätigkeiten)

Der Kunde soll Agenten anlegen können, die ihm wiederkehrende Aufgaben abnehmen.

- **Anlegen im Agenten-Modus:** Der Kunde beginnt im Agenten-Modus des Cockpits, einen Agenten zu steuern. Über den Button **„Diesen Agenten speichern"** wird der bisherige Kontext in einen Prompt zusammengefasst und als wiederverwendbarer Agent gespeichert. Die Zusammenfassung wird dem Kunden **vor dem Speichern zur Bearbeitung angezeigt** (Review statt Blackbox — entscheidet zugleich die frühere offene Frage).
- **Bereitstellung & Auslösung:** Der gespeicherte Agent erscheint auf der Übersichtsseite und kann per einfachem Mausklick getriggert werden. v1: feste Ausführung ohne Eingabefelder; Parametrisierung (`trigger_config`) ist im Schema vorgesehen, UI folgt später.
- **Verwaltung & Sichtbarkeit:** Liegt beim Kunden selbst. Default **privat** (`created_by`); der Ersteller kann den Agenten org-weit teilen. Der Berater sieht alle gespeicherten Agenten des Tenants und kann sie deaktivieren (Rollen-Matrix §11).
- **Ablösung der Stubs (erledigt):** Die vier hardcodierten Agenten aus `app/_workspace/agents.ts` sind als geseedete `saved_agents`-Zeilen (org-weit, vom Berater gepflegt) migriert (`supabase/migrations/20260611122000_cockpit_flags_and_seeds.sql`); die Code-Liste ist entfallen. Ohne Seed zeigt die Workspace-Home einen Leerzustand.
- **Scope:** tenant-scoped; nutzt dieselbe Datengrenze (RLS/Token) und dasselbe Modell-Routing wie der übrige Cockpit-Betrieb. Jeder Lauf erzeugt einen Eintrag in `agent_runs` (§13).

## 10. Automatisierungen

*Entfallen (Audit vom 2026-08-06).* Der Automatisierungs-Komplex (Tabellen `automations`,
`automation_templates`, `workflow_runs`, die KPI-Kette „eingesparte Zeit" sowie alle
zugehörigen Routen) wurde vollständig aus Code und Datenbank entfernt und wird neu
spezifiziert.

## 11. Rollen- & Sichtbarkeits-Matrix

Bezieht sich auf das bestehende Rollenmodell: `member` (Endnutzer), `admin`/`owner` (Berater bzw. Org-Inhaber), `profiles.is_platform_admin` (intern).

| Aktion | member | admin/owner (Berater) | platform admin |
|---|---|---|---|
| Chat-Modus nutzen | ✓ (sieht nur eigene Konversationen, wie heute) | ✓ (sieht alle Konversationen der Org) | ✓ |
| Agent-Modus nutzen | ✓ (nur Read-only-Tools) | ✓ (alle Tools, Write mit Bestätigung) | ✓ |
| Gespeicherten Agenten anlegen/ändern/löschen | ✓ (eigene) | ✓ (alle der Org, inkl. deaktivieren) | ✓ |
| Gespeicherten Agenten org-weit teilen | ✓ (eigene) | ✓ | ✓ |
| Cross-Tenant-Sichten (Keys, Kosten) | — | — | ✓ |

Datenzugriffe innerhalb aller Aktionen unterliegen zusätzlich der Folder-Permission-Grenze (§5.1).

## 12. Agent-Modus: Verhalten, Sicherheit & Limits

### 12.1 Modus-Toggle

Im Composer wählbar: **Chat** (Retrieval + Antwort, heutiger `sendMessage`-Pfad) oder **Agent** (Tool-Use-Loop über `lib/ai/agent/`). Der heutige implizite Fallback („Agent versuchen, sonst RAG") wird durch die explizite Wahl ersetzt; im Chat-Modus laufen keine Tools.

### 12.2 Tool-Permissions

- Jedes Tool in der Registry deklariert `access: 'read' | 'write'` und optional eine Mindestrolle. Beispiel: `cleanup_stale_trello_cards` ist `write` und damit für `member` nicht verfügbar (§11).
- **Write-Aktionen erfordern eine explizite Bestätigung im UI** (Vorschau der Aktion → Bestätigen/Abbrechen), bevor das Tool-Result an das Modell zurückgeht.
- Tools, die Quellen/Chunks lesen, übergeben den aufrufenden Nutzer (`p_user_id`) an die Such-/Query-Schicht, damit Folder-Permissions auch im Agent-Modus greifen. Tools dürfen nicht pauschal mit Service-Role an RLS vorbei lesen.

### 12.3 Limits

- Max. Tool-Iterationen pro Anfrage (Default 8) und Gesamt-Timeout (Default 60 s); danach sauberer Abbruch mit Teil-Ergebnis.
- Token-/Kosten-Budget pro Anfrage und pro Tenant/Monat aus `plan_tiers.limits` (z. B. `max_ai_tokens_month`); Überschreitung → verständliche Fehlermeldung, Berater wird im Dashboard gewarnt. Durchgesetzt über das `ai_usage_events`-Rollup (§5.2).

### 12.4 Modus-Persistenz

`chat_conversations.mode ('chat' | 'agent')` hält den Modus pro Konversation fest; der Verlauf zeigt das Badge entsprechend an. Gemischte Konversationen sind nicht vorgesehen (neue Konversation beim Moduswechsel).

## 13. Run-Historie & Audit

„Auditierbar by default" wird konkret über eine Run-Tabelle:

- **`agent_runs`** — ein Eintrag pro agentischer Anfrage bzw. Klick auf einen gespeicherten Agenten: `organization_id`, `conversation_id`, `saved_agent_id` (nullable), `triggered_by`, `model`, `status`, `started_at/finished_at/duration_ms`, `tool_calls` (JSONB: Tool, Input-Digest, Result-Digest, bestätigt ja/nein), `token_usage`, `error_message`.

Sie ist RLS-gesichert (`is_member_of_org`), für den Berater im Dashboard einsehbar (Berater-Spec §6) und speist das Usage-/Kosten-Rollup.

## 14. Dokument-Erzeugung

Dokumente (PPTX, XLSX, DOCX, PDF) werden im eigenen Worker erzeugt, unabhängig vom Modellanbieter. Anbieterseitige Doc-Skills können optional als zusätzliches Ausführungs-Backend genutzt werden, wenn ein Tenant ohnehin auf dem entsprechenden Anbieter mit Code-Execution läuft — sind aber nie Voraussetzung.

**Runtime-Entscheidung:** Supabase Edge Functions laufen auf Deno — `python-pptx` & Co. stehen dort nicht zur Verfügung. Für v1 wird der Doc-Worker mit **Node-/Deno-kompatiblen Bibliotheken** umgesetzt (`pptxgenjs` für PPTX, `exceljs` für XLSX, `docx` für DOCX, PDF via HTML-Rendering), angesteuert über eine eigene pgmq-Queue (`render`), Ablage im Storage-Bucket `source-files` (eigener Pfadpräfix), Auslieferung per signierter URL. Ein separater Python-Worker bleibt eine v2-Option, falls Layout-Anforderungen die JS-Bibliotheken übersteigen.

## 15. Feature-Flags & Plan-Tiers

Neue Flags in `feature_flags` (geseedet), per `org_has_feature()` geprüft und über Plan-Tiers zugeordnet:

| Key | Bedeutung | Tier-Vorschlag |
|---|---|---|
| `cockpit` | Cockpit sichtbar (ersetzt `chat` + `search` in der Navigation) | core |
| `agent_mode` | Agenten-Modus + gespeicherte Agenten | standard+ |
| `doc_generation` | Dokument-Erzeugung im Worker | premium+ |

Das Flag `skills` ist mit dem Audit vom 2026-08-06 entfallen.

Quoten (Tokens/Monat, Agent-Runs/Tag) leben in `plan_tiers.limits` (JSONB, bestehendes Muster) und werden in §12.3 durchgesetzt.

## 16. Komponenten & Datenmodell (Skizze)

- **Agenten-Registry** `saved_agents`: `id`, `organization_id`, `name`, `prompt` (zusammengefasster, vom Kunden bestätigter Kontext), `created_by`, `visibility` (`private/org`), `trigger_config` (JSONB, v1 leer), `status` (`active/disabled`), `source_conversation_id`.
- **Run-Historie:** `agent_runs` (§13).
- **Usage & Kosten** `ai_usage_events`: `id`, `organization_id`, `provider`, `model`, `purpose` (`chat/agent/embedding`), `tokens_in/out`, `cost_estimate_cents`, `ref_type/ref_id`, `occurred_at`. Tagesaggregat als View nach dem Muster `integration_kpi_daily`. Hinweis: der CHECK auf `purpose` erlaubt aus historischen Gründen weiterhin `skill` und `automation` — neue Zeilen entstehen damit nicht mehr.
- **Provider-Keys** `ai_provider_keys`: `id`, `organization_id` (NULL = Plattform-Key), `provider`, `encrypted_key`, `constraints` (JSONB, z. B. `{"eu_only": true}`), `status`, `rotated_at`.
- **Modell-Routing-Konfiguration:** weiterhin `organizations.metadata.ai_settings` (Default-Modell, Embedding-Provider, Provider-Allowlist), referenziert `ai_provider_keys`.
- **KPI-Aggregation:** `kpi_events` (bestehend) — verbleibender Produzent und Konsument ist der Telefon-Assistent.
- **Ausführungs-Runtime:** bestehende pgmq-Worker + neue Queue `render` für Dokumente (§14).

Wiederverwendung bestehender Bausteine: `integration_providers`, `sources`, `content_chunks`, `chat_*`, `pgmq`-Worker, `feature_flags`, `plan_tiers`, `kpi_events`, Folder-Permission-Modell.

## 17. Beispiel-Skills

*Entfallen (Audit vom 2026-08-06).* Siehe §7.

## 18. Nicht-Ziele / Abgrenzung

- Kein Anbieter-Lock-in über native Skill-APIs.
- Keine Agenten, die technisch Fremdkundendaten sehen könnten.
- Keine global verfügbaren Funktionen — alles tenant-scoped (globale Sicht nur intern im Admin-Dashboard).
- Keine Tool-Ausführung an RLS/Folder-Permissions vorbei (§12.2).

## 19. Offene Entscheidungen

Durch dieses Review entschieden (vormals offen): Agent-Speichern mit Kunden-Review (§9) · Klick-Trigger v1 ohne Parameter (§9) · Doc-Worker-Runtime (§14).

Weiterhin offen:

- Verschlüsselungsverfahren für `ai_provider_keys` (Supabase Vault vs. App-seitige Verschlüsselung wie bei `organization_integrations.credentials`).
- Kostensätze pro Modell für `cost_estimate_cents` (statische Preistabelle vs. Provider-API).
