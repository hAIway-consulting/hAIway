<!--
  hAIway Cockpit — Spezifikation
  Status: Überarbeitet nach Backend-Review (launch-ready Entwurf)
  Letzte Aktualisierung: 2026-06-11
  Bezug: docs/strategie.md (Strategy Gate, Architektur-Prinzipien),
         docs/spec-berater-dashboard.md, docs/spec-admin-dashboard.md
-->

# hAIway Cockpit — Spezifikation

## 1. Zweck & Umbenennung

Der bisherige „Chat" wird zum **hAIway Cockpit** — dem zentralen Einstiegspunkt für KI-gestützte Anfragen und Automatisierungen in der Übersicht.

Das Cockpit ist nicht nur ein Chatfenster, sondern die Bedienoberfläche für zwei Betriebsarten (Chat und Agent) auf Basis der mandantengetrennten Kundendaten. Es bleibt direkt in der Übersicht erreichbar und für Fragen verfügbar.

## 2. Geltungsbereich

Diese Spezifikation umfasst:

- **Konversationsverlauf** — Auflistung aller bisherigen Chats, um in bestehenden Anfragen weiterzuarbeiten und Kontext festzuhalten (statt nur aus dem letzten Kontext zu arbeiten).
- **Modus-Toggle** — Umschalten zwischen *normaler Chatanfrage* und *agentischer Anfrage* (§12).
- **Ablösung der bisherigen Suche** — das Cockpit übernimmt deren Platz (§4).
- **Mandantentrennung & Datenschutz** — harte Anforderung (§5).
- **Skill-System** — anbieterunabhängige, erweiterbare Fähigkeiten (§7–§8).
- **Gespeicherte Agenten** — vom Kunden selbst angelegte, per Klick auslösbare Agenten (§9).
- **Automatisierungen** — vom Berater/Entwickler gebaute Hintergrund-Workflows (§10).
- **Rollen, Audit, Limits, Flags** — Querschnittsthemen für den Produktstart (§11–§15).

Die Verwaltungs-Sichten auf dieselben Konzepte sind in eigenen Specs beschrieben: **Berater-Dashboard** (`docs/spec-berater-dashboard.md`) und **Admin-Dashboard** (`docs/spec-admin-dashboard.md`).

## 3. Ist-Stand & Wiederverwendung

Wesentliche Teile des Cockpits existieren bereits — die Spec beschreibt das Delta, nicht den Neubau:

| Baustein | Existiert bereits | Delta für das Cockpit |
|---|---|---|
| Konversationsverlauf | `chat_conversations` + `chat_messages` mit RLS, Sidebar, „Letzte Chats" auf der Übersicht, Telemetrie (`chunk_ids`, `retrieval_arms`, `latency_ms`, `token_usage`) | Umbenennung/Platzierung als Cockpit, Modus-Persistenz (§12.4) |
| Hybrid-Suche | `hybrid_search_chunks` / `hybrid_search_boosted` (FTS + pgvector, RRF), Entity-Boosting, Listing-Erkennung, Folder-Permission-Filter (`p_user_id`) | wird zum Chat-Modus-Backbone, `/search` entfällt (§4) |
| Agent-Loop | `apps/web/src/lib/ai/agent/` — Tool-Use-Loop mit Anthropic- und OpenAI-kompatiblem Adapter, Tool-Registry (`registry.ts`, 4 Tools) | sichtbarer Modus-Toggle, Tool-Permissions, Limits, Run-Historie (§12–§13) |
| Modell-Routing | `lib/ai/gateway.ts` (`resolveOrgModel`, `anthropic/* openai/* google/* deepseek/* mistral/*`), Org-Default in `organizations.metadata.ai_settings`, Admin-UI `/admin/ai-settings` | Per-Tenant-Keys, Datenschutz-Constraints, Embedding-Routing, Usage-Tracking (§5) |
| Gespeicherte Agenten | Hardcoded Stubs in `app/_workspace/agents.ts` + Agent-Tiles auf der Workspace-Home | DB-backed Registry `saved_agents`, „Diesen Agenten speichern"-Flow (§9) |
| Automatisierungen | Code-Registry in `lib/db/queries/workflows.ts`, `workflow_runs` + `get_workflow_kpi()`, Reklamations-Orchestrator | DB-Registry, KPI-Modell „eingesparte Zeit" (§10) |
| Worker-Runtime | pgmq-Queues (ingest/normalize/embed/extract), 14 Edge Functions, pg_cron, DLQ `job_failures` + Replay | generischer Skill-/Doc-Worker (§7, §14) |
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

- **Durchgesetzt an der Datengrenze, nicht an der Modell- oder Skill-Grenze.** Jeder Datenzugriff läuft über den tenant-scoped User-Token; die RLS-Policies des Aufrufers greifen automatisch. Ein Skill, Agent oder Modell sieht immer nur das, was über diesen Token geladen und im Prompt/Tool-Result übergeben wurde.
- **Zusätzlich zur Tenant-Grenze gilt die Nutzer-Grenze:** Das bestehende Folder-/Permission-Group-Modell (`source_folders`, `permission_groups`, `user_can_access_source()`) wird in **allen** Cockpit-Pfaden respektiert — Chat-Retrieval tut das heute über `p_user_id`; Agent-Tools und Skill-Code müssen denselben Filter anwenden (§12.2).

### 5.2 Multi-Provider & Per-Tenant-Keys

- **Multi-Provider by design.** API-Keys/Tokens werden je Modellanbieter bezogen, pro Kunde zugewiesen und für die Nutzungsverfolgung getrackt.
- **Key-Speicherung:** Tabelle `ai_provider_keys` (Skizze §16), verschlüsselt nach dem Muster von `organization_integrations.credentials`. Env-Keys (`ANTHROPIC_API_KEY`, `OPENAI_*`) bleiben als Plattform-Fallback für Tenants ohne eigene Zuweisung. Auflösungsreihenfolge: Tenant-Key → Plattform-Key.
- **Usage-Tracking:** Jede Modell-Interaktion (Chat, Agent, Skill, Automatisierung, Embedding) schreibt ein Event in `ai_usage_events` (Tenant, Provider, Modell, Tokens in/out, Kostenschätzung, Kontext-Referenz). `chat_messages.token_usage` bleibt als Detail erhalten; das Rollup für Dashboards und Quoten läuft über `ai_usage_events`.

### 5.3 Modell-Routing = Datenschutz-Hebel

- „Kunde X darf nur EU-Modell Y" ist eine Routing-Regel pro Tenant, keine Architekturänderung. Datenabruf und Verarbeitung bleiben unabhängig vom gewählten Modell in der eigenen Infrastruktur.
- Routing-Konfiguration pro Tenant: Default-Modell, erlaubte Provider (Allowlist), Constraints (z. B. `eu_only`). Gepflegt vom Berater (`/admin/ai-settings`, siehe Berater-Spec §5).
- **Embeddings sind Teil des Routings.** Heute laufen Embeddings hart über OpenAI `text-embedding-3-small` (`lib/ai/embeddings.ts`) — damit gehen Suchanfragen und Chunk-Inhalte aller Tenants an OpenAI, unabhängig vom Chat-Modell. Das ist eine Datenschutz-Lücke und wird geschlossen: Der Embedding-Provider wird pro Tenant konfigurierbar (gleiche Routing-Tabelle); ein Provider-Wechsel erfordert Re-Embedding der `content_chunks` des Tenants (dimensionskompatibel oder mit Re-Index-Lauf über die bestehende `embed`-Queue). Bis dahin gilt: Tenants mit `eu_only`-Constraint können nicht onboarded werden — das ist eine bewusste Launch-Schranke, kein stiller Default.

### 5.4 Scope

- **Alles tenant-scoped.** Skills, gespeicherte Agenten und Automatisierungen werden immer unter dem jeweiligen Tenant angelegt — nie global. Eine globale Übersicht existiert ausschließlich intern im Admin-Dashboard.

## 6. Erweiterungskonzepte im Überblick

Das Cockpit kennt drei klar getrennte Erweiterungsarten. Wichtig ist, sie nicht zu vermischen:

| Konzept | Wer legt an | Auslösung | Management | Scope |
|---|---|---|---|---|
| **Skill** | Kunde/Berater über geführten Flow + Berater-Freigabe | im Cockpit bei Bedarf (Chat/Agent) | aktivierbar/deaktivierbar durch Kunde/Berater | tenant- / branchen-scoped |
| **Gespeicherter Agent** | Kunde selbst (aus dem Agenten-Modus speichern) | per Mausklick aus der Übersicht | durch den Kunden | tenant-scoped |
| **Automatisierung** | Entwickler/Berater | läuft selbstständig im Hintergrund | **nur** Entwickler/Berater (Kunde kann nicht starten/stoppen) | tenant-scoped (Admin-Bibliothek intern) |

## 7. Skill-System

### 7.1 Grundprinzip: anbieterunabhängig

Ein „Skill" ist ein **eigenes Konstrukt im Orchestrator** — **nicht** ein anbieterspezifischer Skill (z. B. Anthropics native Agent-Skills).

Begründung: Native Skills existieren nur beim jeweiligen Anbieter. Sobald ein Tenant aus Datenschutz- oder anderen Gründen auf einem anderen Modell läuft, wäre eine anbietergebundene Skill-API nicht verfügbar. Das eigene Skill-Konstrukt vermeidet Provider-Lock-in und passt zum Prinzip „Orchestrator + Glue, nie Tool-Klon".

### 7.2 Aufbau eines Skills

Jeder Skill besteht aus bis zu drei Teilen:

1. **Anweisung / Prompt-Template** — beschreibt, was der Skill tun soll (das `SKILL.md`-Äquivalent in eigener Verwaltung).
2. **Tools / Funktionen** — die Funktionen, die der Skill aufrufen darf. Function-/Tool-Calling ist der gemeinsame Nenner über praktisch alle ernsthaften Anbieter und damit die portable Schnittstelle. Tools werden aus der bestehenden Tool-Registry referenziert, nie frei definiert.
3. **Optionaler deterministischer Code** — läuft im **eigenen** Sandbox/Worker (pgmq-Worker), nicht im Modell. Zuständig für: Datenabruf über den tenant-scoped Token, Aggregation, Dokument-Rendering usw.

### 7.3 Stufenmodell für Skill-Code (Launch-Entscheidung)

Um die Sandbox-Frage nicht zum Launch-Blocker zu machen, gilt ein Stufenmodell:

- **v1 (Produktstart): kein generierter/hochgeladener Code.** Ein Skill ist Prompt-Template + Referenzen auf **whitelisted Tools** aus der Registry. Der geführte Flow (§8) erzeugt ausschließlich diese beiden Teile. Deterministischer Code existiert nur als von Entwicklern geschriebener, regulär deployter Worker (Edge Function / pgmq-Worker), auf den ein Skill per `code_ref` zeigt.
- **v2 (nach Start): generierter Code in isolierter Sandbox.** Eigene Runtime mit hartem Tenant-Scoping, Ressourcen-Limits und Netz-Allowlist. Design separat; bis dahin bleibt `code_ref` entwickler-kuratiert.

Damit ist die Sicherheitsfrage „was darf generierter Code" für v1 beantwortet: nichts — es gibt keinen.

### 7.4 Modell-Routing

Pro Tenant wird auf den zugewiesenen Key/Anbieter geroutet. System-Prompt und Tool-Definitionen bleiben identisch — nur das ausführende Modell wechselt. Der Skill ist damit modellunabhängig wiederverwendbar.

### 7.5 Datengrenze (zentral)

Datenzugriff und Code-Ausführung bleiben **immer** in der eigenen Infrastruktur. Das Modell sieht ausschließlich, was ihm im Prompt bzw. als Tool-Result übergeben wird. Die RLS-Grenze garantiert, dass ein Skill nie Fremdkundendaten zieht — unabhängig vom Modell. Zusätzlich gilt die Nutzer-Grenze aus §5.1.

## 8. Skill-Lebenszyklus & Self-Service

Kunden bzw. Berater können Skills selbst anlegen — über einen **geführten Flow im Cockpit**, nicht durch rohen Upload von code-ausführenden Paketen:

1. **Beschreiben** — Kunde/Berater beschreibt im Cockpit, was der Skill leisten soll.
2. **Generieren & Validieren** — die Plattform erzeugt und prüft die Skill-Definition (Prompt-Template + Tool-Referenzen; in v1 kein Code, §7.3).
3. **Berater-Freigabe** — der Berater gibt frei und entscheidet, was der Kunde sieht („Berater bleibt im Lead", Strategy-Gate-Frage 5). Workflow im Berater-Dashboard (Berater-Spec §3): Status `draft → in_review → approved → active` (bzw. `rejected`), mit Sandbox-Test gegen die Test-Org vor Aktivierung.
4. **Registrieren** — der Skill wird in der **eigenen DB** registriert (`skills`-Tabelle, §16), tenant-/branchen-scoped (nicht in einem Anbieter-Workspace).

Anforderungen an Skills:

- **Branchenagnostisch + tenant-parametrisiert**, damit sie für mehrere Kunden/Branchen funktionieren (kein One-Off, Strategy-Gate-Frage 3).
- **Auditierbar by default** — jede Ausführung hinterlässt eine Spur in `skill_runs` (§13) inkl. KPI-Tracking.

## 9. Gespeicherte Agenten (wiederkehrende Tätigkeiten)

Der Kunde soll Agenten anlegen können, die ihm wiederkehrende Aufgaben abnehmen.

- **Anlegen im Agenten-Modus:** Der Kunde beginnt im Agenten-Modus des Cockpits, einen Agenten zu steuern. Über den Button **„Diesen Agenten speichern"** wird der bisherige Kontext in einen Prompt zusammengefasst und als wiederverwendbarer Agent gespeichert. Die Zusammenfassung wird dem Kunden **vor dem Speichern zur Bearbeitung angezeigt** (Review statt Blackbox — entscheidet zugleich die frühere offene Frage).
- **Bereitstellung & Auslösung:** Der gespeicherte Agent erscheint auf der Übersichtsseite und kann per einfachem Mausklick getriggert werden. v1: feste Ausführung ohne Eingabefelder; Parametrisierung (`trigger_config`) ist im Schema vorgesehen, UI folgt später.
- **Verwaltung & Sichtbarkeit:** Liegt beim Kunden selbst. Default **privat** (`created_by`); der Ersteller kann den Agenten org-weit teilen. Der Berater sieht alle gespeicherten Agenten des Tenants und kann sie deaktivieren (Rollen-Matrix §11).
- **Ablösung der Stubs:** Die vier hardcodierten Agenten aus `app/_workspace/agents.ts` werden als geseedete `saved_agents`-Zeilen (org-weit, vom Berater gepflegt) migriert; die Code-Liste entfällt.
- **Scope:** tenant-scoped; nutzt dieselbe Datengrenze (RLS/Token) und dasselbe Modell-Routing wie der übrige Cockpit-Betrieb. Jeder Lauf erzeugt einen Eintrag in `agent_runs` (§13).

Abgrenzung zum Skill: Ein gespeicherter Agent ist ein vom Kunden selbst erzeugter, prompt-basierter Schnellzugriff aus einer konkreten Konversation. Ein Skill ist eine kuratierte, branchenagnostische Fähigkeit mit definierten Tools/Code und Berater-Freigabe.

## 10. Automatisierungen

Automatisierungen sind Workflows, die über den Orchestrator bereitgestellt und **immer individuell** an die Anforderungen des Kunden entwickelt werden.

- **Betrieb:** Laufen im Hintergrund. Sie sind **vom Kunden nicht managebar** — Optimierung, Start und Stopp erfolgen ausschließlich durch Entwickler/Berater (Berater-Spec §4).
- **Registry:** Die heutige Code-Registry (`AUTOMATION_REGISTRY` in `lib/db/queries/workflows.ts`) wird durch die DB-Tabelle `automations` (§16) abgelöst; `workflow_runs` bleibt die Run-Historie und wird über `automation_id` referenziert.
- **Sichtbarkeit für den Kunden:** Das Kundendashboard zeigt die durchgelaufenen Vorgänge (Run-Historie, vgl. Integration Runs).
- **KPI-Dashboard:** Für den Kunden ersichtlich, wie viel Arbeit und Zeit ihm die Automatisierung einspart. **KPI-v1-Modell:** Der Berater hinterlegt pro Automatisierung `minutes_saved_per_run`; eingesparte Zeit = Wert × erfolgreiche Runs (aus `workflow_runs`/`get_workflow_kpi()`). Ergebnis wird als `kpi_event` (`event_type = 'time_saved'`, bestehende Tabelle `kpi_events`) fortgeschrieben. Genauere Messmodelle später, ohne Schemabruch.
- **Scope:** Immer unter dem Tenant angelegt, nie global verfügbar.
- **Admin-Bibliothek:** Im Admin-Dashboard existiert eine interne Bibliothek aller Automatisierungen, damit wir kundenübergreifend die Übersicht behalten (Admin-Spec §3).

## 11. Rollen- & Sichtbarkeits-Matrix

Bezieht sich auf das bestehende Rollenmodell: `member` (Endnutzer), `admin`/`owner` (Berater bzw. Org-Inhaber), `profiles.is_platform_admin` (intern).

| Aktion | member | admin/owner (Berater) | platform admin |
|---|---|---|---|
| Chat-Modus nutzen | ✓ (sieht nur eigene Konversationen, wie heute) | ✓ (sieht alle Konversationen der Org) | ✓ |
| Agent-Modus nutzen | ✓ (nur Read-only-Tools) | ✓ (alle Tools, Write mit Bestätigung) | ✓ |
| Gespeicherten Agenten anlegen/ändern/löschen | ✓ (eigene) | ✓ (alle der Org, inkl. deaktivieren) | ✓ |
| Gespeicherten Agenten org-weit teilen | ✓ (eigene) | ✓ | ✓ |
| Skill vorschlagen (geführter Flow) | ✓ | ✓ | ✓ |
| Skill freigeben/aktivieren | — | ✓ | ✓ |
| Automatisierung sehen (Runs, KPI) | ✓ | ✓ | ✓ |
| Automatisierung starten/stoppen/konfigurieren | — | ✓ | ✓ |
| Cross-Tenant-Sichten (Bibliotheken, Kosten) | — | — | ✓ |

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

„Auditierbar by default" wird konkret über zwei neue Tabellen nach dem Muster von `workflow_runs`:

- **`agent_runs`** — ein Eintrag pro agentischer Anfrage bzw. Klick auf einen gespeicherten Agenten: `organization_id`, `conversation_id`, `saved_agent_id` (nullable), `triggered_by`, `model`, `status`, `started_at/finished_at/duration_ms`, `tool_calls` (JSONB: Tool, Input-Digest, Result-Digest, bestätigt ja/nein), `token_usage`, `error_message`.
- **`skill_runs`** — ein Eintrag pro Skill-Ausführung: `organization_id`, `skill_id`, `skill_version`, `triggered_by`, `model`, `status`, Zeiten, `input_digest`, `output_ref`, `token_usage`, `error_message`.

Beide sind RLS-gesichert (`is_member_of_org`), für den Berater im Dashboard einsehbar (Berater-Spec §6) und speisen das Usage-/Kosten-Rollup. Automatisierungen behalten `workflow_runs`.

## 14. Dokument-Erzeugung

Dokumente (PPTX, XLSX, DOCX, PDF) werden im eigenen Worker erzeugt, unabhängig vom Modellanbieter. Anbieterseitige Doc-Skills können optional als zusätzliches Ausführungs-Backend genutzt werden, wenn ein Tenant ohnehin auf dem entsprechenden Anbieter mit Code-Execution läuft — sind aber nie Voraussetzung.

**Runtime-Entscheidung:** Supabase Edge Functions laufen auf Deno — `python-pptx` & Co. stehen dort nicht zur Verfügung. Für v1 wird der Doc-Worker mit **Node-/Deno-kompatiblen Bibliotheken** umgesetzt (`pptxgenjs` für PPTX, `exceljs` für XLSX, `docx` für DOCX, PDF via HTML-Rendering), angesteuert über eine eigene pgmq-Queue (`render`), Ablage im Storage-Bucket `source-files` (eigener Pfadpräfix), Auslieferung per signierter URL. Ein separater Python-Worker bleibt eine v2-Option, falls Layout-Anforderungen die JS-Bibliotheken übersteigen.

## 15. Feature-Flags & Plan-Tiers

Neue Flags in `feature_flags` (geseedet), per `org_has_feature()` geprüft und über Plan-Tiers zugeordnet:

| Key | Bedeutung | Tier-Vorschlag |
|---|---|---|
| `cockpit` | Cockpit sichtbar (ersetzt `chat` + `search` in der Navigation) | core |
| `agent_mode` | Agenten-Modus + gespeicherte Agenten | standard+ |
| `skills` | Skill-Nutzung + geführter Anlage-Flow | standard+ |
| `doc_generation` | Dokument-Erzeugung im Worker | premium+ |

Quoten (Tokens/Monat, Agent-Runs/Tag) leben in `plan_tiers.limits` (JSONB, bestehendes Muster) und werden in §12.3 durchgesetzt.

## 16. Komponenten & Datenmodell (Skizze)

- **Skill-Registry** `skills`: `id`, `organization_id` (nullable bei Branchen-Scope), `industry_scope`, `name`, `description`, `prompt_template`, `tool_refs` (Referenzen auf Registry-Tools), `code_ref` (v1: nur entwickler-deployte Worker, §7.3), `status` (`draft/in_review/approved/active/rejected`), `version`, `created_by`, `approved_by`.
- **Agenten-Registry** `saved_agents`: `id`, `organization_id`, `name`, `prompt` (zusammengefasster, vom Kunden bestätigter Kontext), `created_by`, `visibility` (`private/org`), `trigger_config` (JSONB, v1 leer), `status` (`active/disabled`), `source_conversation_id`.
- **Automatisierungs-Registry** `automations`: `id`, `organization_id`, `key` (löst `AUTOMATION_REGISTRY` ab), `name`, `description`, `workflow_ref`, `requires` (Provider-Liste), `owner`, `status` (`active/stopped`), `minutes_saved_per_run`, `managed_by_consultant = true`.
- **Run-Historie:** `workflow_runs` (bestehend, Automatisierungen) + neu `agent_runs`, `skill_runs` (§13).
- **Usage & Kosten** `ai_usage_events`: `id`, `organization_id`, `provider`, `model`, `purpose` (`chat/agent/skill/automation/embedding`), `tokens_in/out`, `cost_estimate_cents`, `ref_type/ref_id`, `occurred_at`. Tagesaggregat als View nach dem Muster `integration_kpi_daily`.
- **Provider-Keys** `ai_provider_keys`: `id`, `organization_id` (NULL = Plattform-Key), `provider`, `encrypted_key`, `constraints` (JSONB, z. B. `{"eu_only": true}`), `status`, `rotated_at`.
- **Modell-Routing-Konfiguration:** weiterhin `organizations.metadata.ai_settings` (Default-Modell, Embedding-Provider, Provider-Allowlist), referenziert `ai_provider_keys`.
- **KPI-Aggregation:** `kpi_events` (bestehend) mit `event_type = 'time_saved'` (§10).
- **Ausführungs-Runtime:** bestehende pgmq-Worker + neue Queue `render` für Dokumente (§14).
- **Admin-Bibliothek:** kundenübergreifende, rein interne Sichten — Admin-Spec.

Wiederverwendung bestehender Bausteine: `integration_providers`, `sources`, `content_chunks`, `chat_*`, `pgmq`-Worker, `feature_flags`, `plan_tiers`, `kpi_events`, `workflow_runs`, Folder-Permission-Modell.

## 17. Beispiel-Skills

| Skill | Deterministischer Teil (eigener Worker) | Modell-Teil | Anbieterabhängig? |
|---|---|---|---|
| Reklamationsauswertung | Reklamationsdaten über Search/REST + RLS-Token holen, aggregieren | Auswertung formulieren/interpretieren | Nein |
| Kanban → Präsentation | Kanban-Gold-Daten holen, PPTX im Worker bauen | Inhalt/Reihenfolge strukturieren | Nein (PPTX-Backend optional anbieterspezifisch) |

## 18. Nicht-Ziele / Abgrenzung

- Kein Anbieter-Lock-in über native Skill-APIs.
- Keine Skills, Agenten oder Automatisierungen, die technisch Fremdkundendaten sehen könnten.
- Keine global verfügbaren Funktionen — alles tenant-scoped (globale Sicht nur intern im Admin-Dashboard).
- Automatisierungen sind nicht kundenseitig managebar (kein Start/Stopp durch den Kunden).
- Kein direkter Upload code-ausführender Pakete durch Endkunden ohne Berater-Freigabe — in v1 grundsätzlich kein Kunden-Code (§7.3).
- Keine Tool-Ausführung an RLS/Folder-Permissions vorbei (§12.2).

## 19. Offene Entscheidungen

Durch dieses Review entschieden (vormals offen): Agent-Speichern mit Kunden-Review (§9) · Klick-Trigger v1 ohne Parameter (§9) · KPI-v1-Modell (§10) · Code-Runtime-Stufenmodell (§7.3) · Doc-Worker-Runtime (§14).

Weiterhin offen:

- Format und Versionierung der Skill-Definition (eigenes Schema vs. an `SKILL.md` angelehnt) — blockiert den Start nicht, `skills.version` ist vorgesehen.
- Detail-Workflow der Berater-Freigabe (Rückfrage-Schleifen, Vier-Augen bei branchen-scoped Skills) — siehe Berater-Spec §3.
- Verschlüsselungsverfahren für `ai_provider_keys` (Supabase Vault vs. App-seitige Verschlüsselung wie bei `organization_integrations.credentials`).
- Kostensätze pro Modell für `cost_estimate_cents` (statische Preistabelle vs. Provider-API).
- v2-Sandbox-Design für generierten Skill-Code (Isolation pro Tenant, Ressourcen-Limits, Netz-Allowlist).
