// Chat AI layer.
//
// Responsibilities:
//   * Build the org-aware system prompt (base rules + company prompt + date)
//   * Run an optional query-rewrite for follow-up questions (multi-turn)
//   * Call Claude or OpenAI with a real `messages` array (no more
//     everything-in-user-prompt stuffing)
//   * Enforce a hallucination guard: if no chunks are retrieved, the model
//     must say so explicitly — never fabricate
//
// History persistence lives in `app/chat/actions.ts`. This file stays
// stateless so it can be reused by other surfaces (phone-assistant, brand-agent).

import type { ChunkSearchResult } from "@/lib/db/queries/search";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { getOpenAIKeyForChat } from "./embeddings";

export type ModelId = "claude" | "gpt-4o" | "gpt-4o-mini";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResponse =
  | { type: "chunks"; items: ChunkSearchResult[] }
  | {
      type: "answer";
      text: string;
      sources: ChunkSearchResult[];
      model: ModelId;
      rewrittenQuery?: string;
      entityContext?: string;
      /** token usage of the answering call (spec-cockpit.md §5.2) */
      tokenUsage?: { in: number; out: number };
      /** concrete SDK model id used (for the usage/pricing rollup) */
      modelUsed?: string;
    };

/** Context for fire-and-forget usage tracking of helper LLM calls. */
export type UsageCtx = { orgId: string; userId?: string };

const BASE_RULES = `Du bist der KI-Assistent dieser Organisation. Deine Aufgabe: Fragen ausschliesslich auf Basis der bereitgestellten Quellen beantworten.

Jede Quelle traegt einen Herkunfts-Marker, der sagt, wie sie gefunden wurde:
- [entity_list]: VOLLSTAENDIGE, exakt gefilterte Liste aus der Datenbank. Enthaelt ALLE passenden Eintraege — keine Auswahl, keine Kuerzung. Wenn mindestens ein [entity_list]-Block vorhanden ist, basiere deine Listen-/Zaehl-Antwort AUSSCHLIESSLICH darauf. Wenn der Block leer ist und der Nutzer nach einer Liste fragt, antworte woertlich "Gefunden: 0 Eintraege." und erklaere die Luecke — NICHT auf konzeptionelle Dokument-Treffer ausweichen.
- [listing]: exhaustiver Dokumenten-Dump nach Typ. Kann unvollstaendig sein, wenn passende Eintraege in anderen Typen liegen.
- [operational]: Pseudo-Chunks aus der CRM-Tabelle ohne Tag-Filter. Auswahl, nicht zwingend exhaustiv.
- [hybrid] / [expansion] / [boost]: Auswahl relevanter Treffer. Nicht als "alle" interpretieren — formuliere "gefundene Treffer" oder "unter den Quellen".
- [fallback]: Letzte Rettung ohne gute Matches. Besonders vorsichtig mit Vollstaendigkeits-Aussagen.

Harte Regeln:
1. Antworte NUR mit Informationen, die in den Quellen stehen. Erfinde nichts, rate nicht, ergaenze kein Allgemeinwissen.
2. Unterscheide zwischen drei Faellen und antworte entsprechend:
   a) Die Quellen enthalten die gefragte Information konkret (benannte Entitaet, konkreter Fakt, [entity_list]-Treffer) → Antworte direkt mit Zitaten.
   b) Die Quellen erwaehnen das Thema nur konzeptionell, ohne die gefragten Entitaeten konkret zu benennen (z.B. "Pilotkunden" wird als Konzept diskutiert, aber kein Pilotkunde namentlich gelistet) → Sage das transparent: "Deine Quellen nennen keine konkreten X, aber sie diskutieren das Thema so: …" und gib den konzeptionellen Kontext mit Zitaten wieder. Schlage vor, wie der Nutzer die Luecke schliessen koennte (Tag setzen, Dokument hochladen, Eintrag verknuepfen). WICHTIG: Fall 2b darf NICHT greifen, wenn ein [entity_list]-Block vorhanden ist — dort ist die Liste autoritativ und abschliessend.
   c) Die Quellen enthalten weder die Information noch das Thema → Sage woertlich: "Dazu habe ich keine Informationen in deinen Quellen." Biete an, passende Dokumente hochzuladen oder Eintraege zu verknuepfen.
3. Zitiere jede Tatsache mit dem Marker [Q1], [Q2] etc. — die Nummer entspricht der Reihenfolge der Quellen im Kontext.
4. Wenn der Nutzer nach einer Liste oder Anzahl fragt ("alle ...", "welche ...", "wie viele ..."):
   - Wenn mindestens ein [entity_list]-Block vorhanden ist: liste jeden Eintrag aus diesem Block auf (andere Bloecke ignorieren fuer die Aufzaehlung) und gib am Ende woertlich "Gefunden: N Eintraege." aus.
   - Sonst: gehe die Quellen SYSTEMATISCH von oben nach unten durch und liste JEDEN passenden Eintrag. Kuerze nichts. Gib am Ende "Gefunden: N Eintraege." aus. Wenn die Quellen nur konzeptionell ueber die Kategorie reden, wende Fall 2b an.
5. Antworte praezise und in der Sprache der Frage (Default: Deutsch).`;

const TOOLS_RULES = `

Zusaetzlich stehen dir WERKZEUGE (Tools) zur Verfuegung, um strukturierte Echtzeit-Daten der Organisation abzufragen oder Aktionen auszufuehren:
- Fragen zu Automatisierungen, Reklamationen/Tickets oder Integrations-Statistiken ("wie viele Reklamationen", "welche Automatisierungen laufen/sind aktiv", "Auswertung aller Reklamationsfaelle") -> nutze die passenden Tools. Deren Ergebnisse sind autoritativ und zaehlen wie Quellen; du brauchst dafuer KEINE [Q]-Marker.
- Trello-Fragen oder -Aufraeumen -> nutze die Trello-Tools.
- Inhaltliche Wissensfragen ueber Dokumente -> weiterhin AUSSCHLIESSLICH aus den oben gelieferten [Q]-Quellen (die harten Regeln gelten).
- Wenn weder Tools noch Quellen die Antwort liefern: sage transparent, dass dir die Information fehlt. Erfinde nichts.

Schreibende Aktionen (z. B. Trello-Bereinigung): Das System erzeugt beim Tool-Aufruf automatisch NUR eine Vorschau — die tatsaechliche Ausfuehrung bestaetigt der Nutzer anschliessend direkt im UI (Bestaetigen/Abbrechen). Setze niemals selbst einen confirm-Parameter und fordere den Nutzer nicht auf, im Chat zuzustimmen. Beschreibe stattdessen kurz, was die Aktion laut Vorschau aendern wuerde (z. B. betroffene Karten + Ziel-Liste). Es wird nur verschoben, nie geloescht.`;

type OrgAiSettings = {
  system_prompt?: string | null;
  tone?: "formal" | "casual" | "neutral" | null;
  language?: "de" | "en" | null;
};

export async function loadOrgAiSettings(): Promise<OrgAiSettings> {
  try {
    const orgId = await requireOrgId();
    const db = await createUserClient();
    const { data } = await db
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .single();
    const settings = (data?.settings ?? {}) as { ai?: OrgAiSettings };
    return settings.ai ?? {};
  } catch {
    return {};
  }
}

export async function buildSystemPrompt(
  entityContext?: string,
  withTools = false,
): Promise<string> {
  const ai = await loadOrgAiSettings();
  const today = new Date().toISOString().slice(0, 10);

  const parts = [BASE_RULES];
  if (withTools) parts.push(TOOLS_RULES);

  if (ai.system_prompt && ai.system_prompt.trim()) {
    parts.push(`\nUnternehmens-Anweisung:\n${ai.system_prompt.trim()}`);
  }

  if (ai.tone) {
    const toneMap = {
      formal: "Halte den Ton sachlich-formell.",
      casual: "Halte den Ton locker und nahbar.",
      neutral: "Halte den Ton neutral.",
    } as const;
    parts.push(toneMap[ai.tone]);
  }

  if (entityContext) {
    parts.push(
      `\nDie Frage bezieht sich auf folgende Entitaeten: ${entityContext}. Bevorzuge Informationen, die mit ihnen verknuepft sind.`,
    );
  }

  parts.push(`\nHeutiges Datum: ${today}.`);

  return parts.join("\n");
}

export function buildContextBlock(chunks: ChunkSearchResult[]): string {
  return chunks
    .map((c, i) => {
      // Expose the retrieval arm to the LLM so it can distinguish a
      // COMPLETE entity_list from a ranked hybrid selection. See BASE_RULES
      // — the marker is what makes "alle Pilot-Kontakte" answerable.
      const via = c.retrieved_via ?? "hybrid";
      return `[Q${i + 1}] [${via}] Quelle: ${c.source_title}\n${c.chunk_text}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Rewrite a follow-up question into a stand-alone query suitable for
 * embedding-based retrieval. Uses Claude Haiku for speed/cost.
 * Returns the original question if no key is set or rewrite fails.
 */
export async function rewriteFollowUpQuery(
  question: string,
  history: ChatTurn[],
  usageCtx?: UsageCtx,
): Promise<string> {
  if (history.length === 0) return question;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return question;

  try {
    const { Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const transcript = history
      .slice(-4)
      .map((t) => `${t.role === "user" ? "Nutzer" : "Assistent"}: ${t.content}`)
      .join("\n");

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Gegeben dieser Gespraechsverlauf:\n\n${transcript}\n\nNeue Frage des Nutzers: "${question}"\n\nFormuliere die neue Frage so um, dass sie eigenstaendig verstaendlich ist (alle Pronomen und Bezuege aufgeloest). Antworte NUR mit der umformulierten Frage, ohne Einleitung.`,
        },
      ],
    });

    recordHelperUsage(message.usage, "claude-haiku-4-5-20251001", usageCtx);

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();

    return text || question;
  } catch {
    return question;
  }
}

/**
 * Track helper LLM calls (title, rewrite, expansion) under purpose "chat" —
 * skipping them would systematically understate cost. Fire-and-forget.
 */
function recordHelperUsage(
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  model: string,
  ctx?: UsageCtx,
): void {
  if (!ctx) return;
  void import("@/lib/ai/usage").then(({ recordAiUsage, providerFromModel }) =>
    recordAiUsage({
      orgId:     ctx.orgId,
      userId:    ctx.userId,
      provider:  providerFromModel(model),
      model,
      purpose:   "chat",
      tokensIn:  usage?.input_tokens ?? 0,
      tokensOut: usage?.output_tokens ?? 0,
    }),
  );
}

/**
 * Expand a user question into 2-4 semantically equivalent paraphrases so the
 * retrieval arms are not at the mercy of the exact wording.
 *
 * Motivation: German compound words ("Pilotkontakte") never match two-word
 * queries ("Pilot Kunden") on the FTS arm, and vector similarity varies
 * enough between phrasings that the top-K can diverge. Generating variants
 * up-front and fusing the retrieval results per RRF closes that gap without
 * DB changes.
 *
 * Returns the original question as the first element of the array. On any
 * failure (no key, parse error, timeout) returns `[question]` — retrieval
 * still works, just without expansion.
 */
const EXPANSION_CACHE = new Map<string, { at: number; variants: string[] }>();
const EXPANSION_TTL_MS = 5 * 60 * 1000;

export async function expandQuery(question: string, usageCtx?: UsageCtx): Promise<string[]> {
  const trimmed = question.trim();
  if (!trimmed) return [];

  const cacheKey = trimmed.toLowerCase();
  const cached = EXPANSION_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < EXPANSION_TTL_MS) {
    return cached.variants;
  }

  const fallback = [trimmed];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;

  try {
    const { Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Formuliere die folgende Frage in 3 semantisch gleichwertigen Varianten um. Ziel: ein RAG-System soll die Frage unabhaengig von der Wortwahl des Nutzers finden. Beruecksichtige:
- Synonyme und Umgangssprache (z. B. "Kunde" <-> "Kontakt", "Auftrag" <-> "Projekt")
- Deutsche Compound-Woerter vs. Mehrwortvarianten (z. B. "Pilotkontakte" <-> "Pilot Kunden" <-> "Pilot-Ansprechpartner")
- Formale vs. informale Sprache
- Singular/Plural

Antworte NUR als JSON-Array mit exakt 3 Strings, ohne Markdown, ohne Kommentare, ohne Einleitung.

Frage: "${trimmed}"`,
        },
      ],
    });

    recordHelperUsage(message.usage, "claude-haiku-4-5-20251001", usageCtx);

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();

    // Accept either a clean JSON array or one wrapped in ```json fences.
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return fallback;

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return fallback;

    const variants = parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.length < 500);

    // Always include the original first; dedupe case-insensitively.
    const seen = new Set<string>([trimmed.toLowerCase()]);
    const out = [trimmed];
    for (const v of variants) {
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= 4) break;
    }

    EXPANSION_CACHE.set(cacheKey, { at: Date.now(), variants: out });
    return out;
  } catch {
    return fallback;
  }
}

export async function generateChatTitle(
  firstQuestion: string,
  usageCtx?: UsageCtx,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return firstQuestion.slice(0, 60);

  try {
    const { Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 40,
      messages: [
        {
          role: "user",
          content: `Fasse diese Frage in maximal 6 Woertern als Titel zusammen, ohne Anfuehrungszeichen, ohne Punkt:\n\n${firstQuestion}`,
        },
      ],
    });
    recordHelperUsage(message.usage, "claude-haiku-4-5-20251001", usageCtx);
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();
    return text || firstQuestion.slice(0, 60);
  } catch {
    return firstQuestion.slice(0, 60);
  }
}

// ── Saved-agent summarizer (spec-cockpit.md §9) ─────────────────────────

export type SavedAgentDraft = {
  name: string;
  description: string;
  prompt: string;
};

const DRAFT_NAME_MAX = 40;
const DRAFT_DESCRIPTION_MAX = 100;
const DRAFT_PROMPT_MAX = 4000;
// Keep the summarizer input bounded — long conversations get clipped per
// turn and to the most recent turns; the recurring task survives clipping.
const DRAFT_TURNS_MAX = 20;
const DRAFT_TURN_CHARS_MAX = 2000;

/** Deterministic draft from the user turns — used whenever the LLM path fails. */
function fallbackAgentDraft(history: ChatTurn[]): SavedAgentDraft {
  const userTurns = history
    .filter((t) => t.role === "user")
    .map((t) => t.content.trim())
    .filter((t) => t.length > 0);
  return {
    name: (userTurns[0] ?? "").slice(0, DRAFT_NAME_MAX),
    description: "",
    prompt: userTurns.join("\n\n").slice(0, DRAFT_PROMPT_MAX),
  };
}

/**
 * Summarize a conversation's recurring task into a reusable saved-agent
 * draft (spec-cockpit.md §9). Uses Claude Haiku like the other helper calls.
 * The result is ALWAYS shown to the user for review before saving — this
 * only produces the editable proposal. Degrades to a deterministic draft
 * built from the user turns when no key is set or parsing fails.
 */
export async function summarizeConversationAsAgentPrompt(
  history: ChatTurn[],
  usageCtx?: UsageCtx,
): Promise<SavedAgentDraft> {
  const fallback = fallbackAgentDraft(history);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;

  try {
    const { Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const transcript = history
      .slice(-DRAFT_TURNS_MAX)
      .map(
        (t) =>
          `${t.role === "user" ? "Nutzer" : "Assistent"}: ${t.content.slice(0, DRAFT_TURN_CHARS_MAX)}`,
      )
      .join("\n\n");

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: `Analysiere den folgenden Gespraechsverlauf zwischen einem Nutzer und einem KI-Agenten. Fasse die wiederkehrende Taetigkeit, die der Nutzer erledigt haben moechte, als wiederverwendbaren Agenten-Prompt zusammen. Der Prompt muss so formuliert sein, dass ein Agent die Aufgabe kuenftig OHNE den urspruenglichen Verlauf ausfuehren kann: Arbeitsauftrag, Vorgehen, benoetigte Rueckfragen an den Nutzer, gewuenschtes Ergebnisformat.

Antworte NUR mit einem JSON-Objekt, ohne Markdown, ohne Einleitung, exakt in dieser Form:
{"name": "...", "description": "...", "prompt": "..."}

Regeln:
- "name": praegnanter deutscher Titel, maximal ${DRAFT_NAME_MAX} Zeichen
- "description": ein deutscher Satz, maximal ${DRAFT_DESCRIPTION_MAX} Zeichen
- "prompt": deutscher Agenten-Prompt, maximal ${DRAFT_PROMPT_MAX} Zeichen

Gespraechsverlauf:

${transcript}`,
        },
      ],
    });

    recordHelperUsage(message.usage, "claude-haiku-4-5-20251001", usageCtx);

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();

    // Accept clean JSON or output wrapped in ``` fences / prose.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const draft = parsed as Record<string, unknown>;
    const name = typeof draft.name === "string" ? draft.name.trim() : "";
    const description =
      typeof draft.description === "string" ? draft.description.trim() : "";
    const prompt = typeof draft.prompt === "string" ? draft.prompt.trim() : "";
    if (!name || !prompt) return fallback;

    return {
      name: name.slice(0, DRAFT_NAME_MAX),
      description: description.slice(0, DRAFT_DESCRIPTION_MAX),
      prompt: prompt.slice(0, DRAFT_PROMPT_MAX),
    };
  } catch {
    return fallback;
  }
}

interface LlmCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  modelUsed: string;
}

async function callClaude(
  systemPrompt: string,
  messages: ChatTurn[],
): Promise<LlmCallResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const { Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = "claude-sonnet-4-6";
  const message = await client.messages.create({
    model,
    max_tokens: 1500,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  return {
    text,
    tokensIn: message.usage?.input_tokens ?? 0,
    tokensOut: message.usage?.output_tokens ?? 0,
    modelUsed: model,
  };
}

async function callOpenAI(
  systemPrompt: string,
  messages: ChatTurn[],
  model: "gpt-4o" | "gpt-4o-mini",
): Promise<LlmCallResult | null> {
  const apiKey = getOpenAIKeyForChat();
  if (!apiKey) return null;
  const { OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    max_tokens: 1500,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });
  const text = response.choices[0]?.message?.content;
  if (text == null) return null;
  return {
    text,
    tokensIn: response.usage?.prompt_tokens ?? 0,
    tokensOut: response.usage?.completion_tokens ?? 0,
    modelUsed: model,
  };
}

/**
 * Generate an answer with hallucination guard.
 *
 * - history: previous turns from the conversation (excluding the current user question)
 * - question: the current user question
 * - chunks: retrieved context chunks (may be empty)
 */
export async function generateAnswer(params: {
  history: ChatTurn[];
  question: string;
  chunks: ChunkSearchResult[];
  entityContext?: string;
  rewrittenQuery?: string;
  model?: ModelId;
  orgId?: string;
  userId?: string;
}): Promise<ChatResponse> {
  const { history, question, chunks, entityContext, rewrittenQuery } = params;
  const model: ModelId = params.model ?? "claude";

  // Hallucination guard: with no chunks, return a deterministic refusal
  // wrapped as an answer (not "chunks") so the UI shows it inline.
  if (chunks.length === 0) {
    return {
      type: "answer",
      text:
        "Dazu habe ich keine Informationen in deinen Quellen. Lade passende Dokumente hoch oder verknuepfe relevante Eintraege, dann beantworte ich die Frage gerne.",
      sources: [],
      model,
      rewrittenQuery,
      entityContext,
    };
  }

  const systemPrompt = await buildSystemPrompt(entityContext);
  const contextBlock = buildContextBlock(chunks);

  const userContent = `Quellen:\n\n${contextBlock}\n\n---\n\nFrage: ${question}`;

  const turns: ChatTurn[] = [
    ...history,
    { role: "user", content: userContent },
  ];

  try {
    const result =
      model === "claude"
        ? await callClaude(systemPrompt, turns)
        : await callOpenAI(systemPrompt, turns, model);

    if (!result || !result.text) return { type: "chunks", items: chunks };

    return {
      type: "answer",
      text: result.text,
      sources: chunks,
      model,
      rewrittenQuery,
      entityContext,
      tokenUsage: { in: result.tokensIn, out: result.tokensOut },
      modelUsed: result.modelUsed,
    };
  } catch {
    return { type: "chunks", items: chunks };
  }
}

export function availableModels(): { id: ModelId; label: string; available: boolean }[] {
  return [
    { id: "claude", label: "Claude Sonnet", available: !!process.env.ANTHROPIC_API_KEY },
    { id: "gpt-4o", label: "GPT-4o", available: !!getOpenAIKeyForChat() },
    { id: "gpt-4o-mini", label: "GPT-4o mini", available: !!getOpenAIKeyForChat() },
  ];
}
