# BPMN-Prozesslandkarte — hAIway AI Foundation Platform

Vollständige Prozessabbildung der Software im **BPMN 2.0**-Format (öffnet direkt in
[bpmn.io](https://demo.bpmn.io), Camunda Modeler o. ä.). Eine Swimlane je
Funktionskategorie; alle Funktionen sind über Trigger-/Datenfluss-Kanten
miteinander verbunden, sodass sichtbar wird, **welche Funktion welchen Prozess
auslöst und welche Funktionen aufeinander wirken**.

## Dateien

| Datei | Zweck |
|-------|-------|
| `haiway-prozesse.bpmn` | **Das Diagramm** — in bpmn.io / Camunda Modeler öffnen & weiterbearbeiten |
| `haiway-prozesse.svg` | Statische Vorschau (Vektor, im Browser öffenbar) |
| `haiway-prozesse.png` | Statische Vorschau (Bild) |
| `model.mjs` | Quelle der Wahrheit: Lanes, Knoten, Flüsse (deklarativ) |
| `generate-bpmn.mjs` | Generator: baut `.bpmn` + `.svg` aus `model.mjs` (Auto-Layout) |

## Öffnen

1. https://demo.bpmn.io aufrufen → `haiway-prozesse.bpmn` per Drag & Drop laden, **oder**
2. Camunda Modeler / VS-Code-Extension „BPMN Editor" → Datei öffnen.

Knoten lassen sich dort frei verschieben; das mitgelieferte Layout ist nur der
Startpunkt.

## Die 7 Swimlanes (Kategorien)

1. **Benutzer & Berater** — menschliche Auslöser (Login, Upload, Connector verbinden, Chat-Frage, Admin, Review).
2. **Web-App (Next.js)** — Server Actions & API-Routen, die die Auslöser entgegennehmen und orchestrieren.
3. **Connectoren & Ingestion** — Edge Functions, die externe Systeme anbinden und Rohdaten holen (Bronze).
4. **RAG-Pipeline · Worker** — `worker-normalize` → `worker-embed` → `worker-extract-entities` (Bronze → Silver → Gold).
5. **Datenbank & Orchestrierung** — Supabase: `pg_cron`-Jobs, `pgmq`-Queues, Trigger, RPC, Tabellen-Domänen.
6. **Telefon-Assistent (Vapi)** — Provisionierung, Echtzeit-Retrieval im Anruf, Nachbearbeitung.
7. **Externe Dienste** — OpenAI, Anthropic, Google, Microsoft, Trello, Shopware, Vapi, Resend.

## Farb-/Form-Legende (SVG/PNG-Vorschau)

| Form / Farbe | Bedeutung |
|--------------|-----------|
| 🟢 Kreis (grün) | Start-Event (z. B. „Frage im Chat stellen", „Anrufer wählt Nummer") |
| 🟡 Kreis (gelb, doppelt) | Zeit-Event = `pg_cron`-Job |
| 🔵 Box (blau) | Benutzer-Aktion (`userTask`) |
| 🟢 Box (grün) | ausführender Code (Server Action, Edge Function, Worker, externer Dienst) |
| 🟡 Box (gelb) | DB-Automatik: Trigger, RPC, `pgmq`-Queue (`scriptTask`) |
| 🟣 Box (violett) | persistierte Datendomäne (Tabellengruppe) |
| Pfeil | Trigger-/Datenfluss („löst aus" / „schreibt in" / „liest aus") |

## Die wichtigsten durchgehenden Ketten

- **Ingestion-Pipeline:** Connector/`sync-google-calendar` → `raw_events` (Bronze) → `pgmq normalize` → `worker-normalize` → `sources` (Silver) → `pgmq embed` → `worker-embed` → `content_chunks` + pgvector (Gold) → `pgmq extract` → `worker-extract-entities` → `contacts/companies/projects`. Getaktet über `pg_cron` (alle 2 Min., Connector-Delta alle 15 Min.).
- **Chat-RAG:** `sendMessage` → User-Message speichern → `rewriteFollowUpQuery`/`expandQuery` (Claude Haiku) → `boostedHybridSearch` (RPC `hybrid_search_boosted`, RLS-gefiltert) → `generateAnswer` (Claude Sonnet / GPT-4o) → Assistant-Message → Trigger `touch_chat_conversation`. Admin-Loop: `submitReview` → `chat_message_reviews` → KPI-RPCs.
- **Telefon-Assistent:** `createOrUpdateAssistant` → `provisionVapiAssistant` → Vapi. Anruf: Vapi-Webhook → `phone-assistant-rag` (`hybrid_search_boosted`, Kalender-Slots) → Antwort. Anrufende: `phone-assistant-call-complete` → Transkript als Source + Chunks + `call_logs` + Action-Items (Anthropic) + E-Mail (Resend).

## Neu generieren

Bei Codeänderungen `model.mjs` anpassen und neu erzeugen:

```bash
node docs/bpmn/generate-bpmn.mjs
```

Der Generator prüft Grid-Kollisionen und doppelte IDs und schreibt `.bpmn` + `.svg`.
PNG-Vorschau (optional, falls `cairosvg` vorhanden):

```bash
python3 -c "import cairosvg; cairosvg.svg2png(url='docs/bpmn/haiway-prozesse.svg', write_to='docs/bpmn/haiway-prozesse.png', output_width=1900)"
```

## Strategy Fit

Reine **Dokumentation** des bestehenden Systems — kein neues Feature, kein
Tool-Klon. Macht die strategischen Prinzipien (Orchestrator + Glue,
Bronze → Silver → Gold, Berater-First, Auditierbarkeit) auf einen Blick sichtbar
und unterstützt damit die geplanten Roadmap-Slots (Connector-Katalog,
Berater-Cockpit). Multi-Tenant-neutral, baut ausschließlich auf bestehende
Bausteine auf.
