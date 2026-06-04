"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import {
  hybridSearch,
  boostedHybridSearch,
  chunksBySourceIds,
  searchOperationalEntities,
  listAllChunksByType,
  enrichChunksWithFormulaWarnings,
  type ChunkSearchResult,
} from "@/lib/db/queries/search";
import {
  resolveEntities,
  getBoostSourceIds,
} from "@/lib/ai/entity-resolver";
import {
  generateAnswer,
  rewriteFollowUpQuery,
  expandQuery,
  generateChatTitle,
  availableModels,
  type ChatResponse,
  type ChatTurn,
  type ModelId,
} from "@/lib/ai/chat";
import { runAgent } from "@/lib/ai/agent-loop";
import { resolveOrgModel } from "@/lib/ai/models";

export type ConversationListItem = {
  id: string;
  title: string;
  last_message_at: string;
  model: string | null;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources: unknown[];
  model: string | null;
  created_at: string;
};

const RETRIEVAL_LIMIT = 14; // bumped from 6 — listing-questions need headroom
const LISTING_LIMIT   = 80; // exhaustive fetch for "alle ..."-style questions
const HISTORY_WINDOW  = 10; // last N turns sent to the model

// Detects listing/counting questions where we must bypass relevance ranking
// and fetch every matching row, otherwise long transcripts crowd out short
// entity-sources and we silently drop contacts/companies.
//
// NOTE: "kunde/kunden" also counts as a contact-trigger — in colloquial German
// people call CRM contacts "Kunden". Previously this only mapped to companies,
// which caused "alle Pilot Kunden" to return zero contacts even though the
// user meant contact rows.
function detectListingIntent(q: string): {
  isListing: boolean;
  types: string[];
} {
  const s = q.toLowerCase();
  const listing =
    /\b(alle|welche|wie\s*viele|liste|zeige|show|list|how\s*many)\b/.test(s);
  if (!listing) return { isListing: false, types: [] };

  const types: string[] = [];
  // "text" covers the CRM-entity types (contact/company/project) in the
  // listing/entity pipeline. Any noun that clearly points at one of these
  // must add "text" here — otherwise the entity-first path stays dormant.
  if (/kontakt|vertrieb|ansprech|lead|warm|kalt|lauwarm|kunde|kunden|firma|firmen|unternehmen|projekt|projekte/.test(s)) types.push("text");
  if (/gespr(ä|ae)ch|transcript|meeting|call/.test(s)) types.push("transcript");
  if (/dokument|datei|pdf|doc/.test(s)) types.push("document");
  // Default: if the user asks "alle/welche" without a type → include short
  // entity-style sources (text) plus documents.
  if (types.length === 0) types.push("text", "document");
  return { isListing: true, types };
}

// Fuse multiple ranked chunk lists via Reciprocal Rank Fusion.
// Each chunk gets score = sum over all lists of 1 / (k + rank_in_list).
// Stable under missing entries (a chunk absent from a list contributes 0).
// k = 60 follows the standard RRF recommendation.
function fuseRRF(
  lists: ChunkSearchResult[][],
  k = 60,
): ChunkSearchResult[] {
  const scoreById = new Map<string, number>();
  const chunkById = new Map<string, ChunkSearchResult>();
  for (const list of lists) {
    list.forEach((chunk, idx) => {
      const key = chunk.id;
      const score = 1 / (k + idx + 1);
      scoreById.set(key, (scoreById.get(key) ?? 0) + score);
      if (!chunkById.has(key)) chunkById.set(key, chunk);
    });
  }
  return [...chunkById.entries()]
    .map(([id, chunk]) => ({ ...chunk, rank: scoreById.get(id) ?? 0 }))
    .sort((a, b) => b.rank - a.rank);
}

function dedupeChunks(chunks: ChunkSearchResult[]): ChunkSearchResult[] {
  const seen = new Set<string>();
  const out: ChunkSearchResult[] = [];
  for (const c of chunks) {
    const key = `${c.source_id}:${c.chunk_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Attach a diagnostic `retrieved_via` tag to each chunk so the admin debug
// panel can show which retrieval arm surfaced it. Kept separate from the
// SQL layer because several retrievers are called from JS, not from within
// a single RPC.
function tagChunks(
  chunks: ChunkSearchResult[],
  via: NonNullable<ChunkSearchResult["retrieved_via"]>,
): ChunkSearchResult[] {
  return chunks.map((c) => ({ ...c, retrieved_via: c.retrieved_via ?? via }));
}

// ── Conversations ────────────────────────────────────────────────────────

export async function createConversation(): Promise<string> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data: { user } } = await db.auth.getUser();

  const { data, error } = await db
    .from("chat_conversations")
    .insert({
      organization_id: orgId,
      created_by: user?.id ?? null,
      title: "Neuer Chat",
    })
    .select("id")
    .single();

  if (error) throw error;
  revalidatePath("/chat", "layout");
  return data!.id as string;
}

export async function listConversations(limit = 50): Promise<ConversationListItem[]> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("chat_conversations")
    .select("id, title, last_message_at, model")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ConversationListItem[];
}

/**
 * Conversations des eingeloggten Users (created_by = auth.uid()).
 * HAIway ist ein Generierungs-Tool, kein Kollaborations-Tool — Chats sind
 * persönlich. Berater/Owner haben über die org-weite listConversations()
 * weiterhin Audit-Sicht für KPI-Zwecke.
 */
export async function listMyConversations(limit = 50): Promise<ConversationListItem[]> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return [];
  const { data, error } = await db
    .from("chat_conversations")
    .select("id, title, last_message_at, model")
    .eq("organization_id", orgId)
    .eq("created_by", user.id)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ConversationListItem[];
}

export async function getConversation(id: string): Promise<{
  conversation: ConversationListItem;
  messages: StoredMessage[];
} | null> {
  const orgId = await requireOrgId();
  const db = await createUserClient();

  const { data: conv, error: convErr } = await db
    .from("chat_conversations")
    .select("id, title, last_message_at, model")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();
  if (convErr || !conv) return null;

  const { data: msgs, error: msgErr } = await db
    .from("chat_messages")
    .select("id, role, content, sources, model, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (msgErr) throw msgErr;

  return {
    conversation: conv as ConversationListItem,
    messages: (msgs ?? []) as StoredMessage[],
  };
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { error } = await db
    .from("chat_conversations")
    .update({ title: title.slice(0, 200) })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) throw error;
  revalidatePath("/chat", "layout");
}

export async function deleteConversation(id: string): Promise<void> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { error } = await db
    .from("chat_conversations")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) throw error;
  revalidatePath("/chat", "layout");
  redirect("/chat");
}

// ── Messaging ────────────────────────────────────────────────────────────

export async function sendMessage(
  conversationId: string,
  question: string,
  model: ModelId = "claude",
): Promise<ChatResponse> {
  const startedAt = Date.now();
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const trimmed = question.trim();
  if (!trimmed) return { type: "chunks", items: [] };

  // Resolve current user for permission-filtered search
  const { data: { user } } = await db.auth.getUser();
  const userId = user?.id;

  // 1. Load history
  const { data: historyRows } = await db
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const allHistory = (historyRows ?? []).filter(
    (m): m is { role: "user" | "assistant"; content: string; created_at: string } =>
      m.role === "user" || m.role === "assistant",
  );

  // 2. Persist user message immediately so the UI can show it on retry/refresh
  await db.from("chat_messages").insert({
    conversation_id: conversationId,
    organization_id: orgId,
    role: "user",
    content: trimmed,
  });

  // 3. Query rewrite for multi-turn retrieval
  const history: ChatTurn[] = allHistory
    .slice(-HISTORY_WINDOW)
    .map((m) => ({ role: m.role, content: m.content }));

  const searchQuery = await rewriteFollowUpQuery(trimmed, history);

  // 4. Query expansion — generate 2-3 paraphrases so the hybrid retrieval
  //    isn't at the mercy of exact wording (compound words, synonyms, register).
  //    Always includes the original searchQuery as variants[0]; degrades to
  //    a single-variant run if expansion is unavailable.
  const variants = await expandQuery(searchQuery);

  // 5. Entity-aware retrieval — boost sources linked to named entities in
  //    the query (companies / contacts / projects mentioned by name).
  const entities = await resolveEntities(searchQuery);
  const boostIds = await getBoostSourceIds(entities);

  const listing = detectListingIntent(trimmed);

  // For listing/counting questions we MUST bypass relevance ranking,
  // otherwise a long transcript can crowd out short entity sources
  // (e.g. 1 transcript source produces more chunks than 8 contact sources,
  //  so hybrid ranking leaves some contacts out of the context window).
  //
  // Run hybrid_search once per variant in parallel and RRF-fuse the results —
  // cheap because hybrid_search is a single RPC call per variant and we cap
  // variants at 4 in expandQuery.
  const runHybrid = (q: string) =>
    boostIds.length > 0
      ? boostedHybridSearch(q, boostIds, RETRIEVAL_LIMIT, userId)
      : hybridSearch(q, RETRIEVAL_LIMIT, userId);

  const [variantResults, opEntities, exhaustive] = await Promise.all([
    Promise.all(variants.map(runHybrid)),
    searchOperationalEntities(searchQuery, 100, listing.isListing ? "exhaustive" : "search"),
    listing.isListing
      // Empty types array = all source_types. Every Drive/SharePoint ingest
      // lands as source_type="connector", so filtering by a technical type
      // silently drops the real content for listing questions.
      ? listAllChunksByType([], LISTING_LIMIT, userId)
      : Promise.resolve([] as ChunkSearchResult[]),
  ]);

  const knowledgeChunks = fuseRRF(variantResults).slice(0, RETRIEVAL_LIMIT);
  const knowledgeVia: NonNullable<ChunkSearchResult["retrieved_via"]> =
    variants.length > 1
      ? "expansion"
      : boostIds.length > 0
      ? "boost"
      : "hybrid";

  // Order matters: exhaustive type-dump first, then operational pseudo-chunks,
  // then semantic extras. Tag each source so the debug panel can show which
  // retrieval arm surfaced each chunk.
  let chunks = dedupeChunks([
    ...tagChunks(exhaustive, "listing"),
    ...tagChunks(opEntities, "operational"),
    ...tagChunks(knowledgeChunks, knowledgeVia),
  ]);

  if (chunks.length === 0 && boostIds.length > 0) {
    chunks = tagChunks(
      await chunksBySourceIds(boostIds, RETRIEVAL_LIMIT, userId),
      "fallback",
    );
  }

  // Attach per-source formula-warnings for the admin debug panel. Cheap
  // (single IN query) and only runs when chunks exist.
  chunks = await enrichChunksWithFormulaWarnings(chunks);

  const entityContext =
    entities.length > 0
      ? entities.map((e) => `${e.name} (${e.type})`).join(", ")
      : undefined;

  // 5. Generate answer (multi-turn, with system prompt)
  const response = await generateAnswer({
    history,
    question: trimmed,
    chunks,
    entityContext,
    rewrittenQuery: searchQuery !== trimmed ? searchQuery : undefined,
    model,
  });

  // 6. Telemetry — persist retrieval signals alongside the assistant message
  //    so Admins can reconstruct the retrieval path later. Histogram of
  //    retrieved_via arms is directly derivable from the tags tagChunks()
  //    attached above.
  //
  // chunk_ids is a uuid[] column, but the entity-first / operational arms
  // synthesise string ids like "contact:<uuid>" for pseudo-chunks that
  // don't exist in content_chunks. Pushing those into the column triggers
  // Postgres 22P02 (invalid uuid syntax) — the insert fails silently, the
  // client's router.refresh() then re-fetches messages without the
  // assistant reply and the answer disappears from the chat. Filter to
  // real uuids only; chunks_retrieved + retrieval_arms still cover the
  // pseudo-chunks for the KPI dashboards.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const retrievalArms: Record<string, number> = {};
  for (const c of chunks) {
    const arm = c.retrieved_via ?? "unknown";
    retrievalArms[arm] = (retrievalArms[arm] ?? 0) + 1;
  }
  const chunkIds = chunks.map((c) => c.id).filter((id) => UUID_RE.test(id));
  const latencyMs = Date.now() - startedAt;
  const telemetry = {
    chunk_ids: chunkIds,
    retrieval_arms: retrievalArms,
    boost_source_ids: boostIds,
    latency_ms: latencyMs,
    chunks_retrieved: chunks.length,
  };

  // 7. Persist assistant message
  // .throwOnError() so future schema drift is loud, not silent — the
  // earlier bug shipped undetected because the insert error was ignored.
  if (response.type === "answer") {
    await db
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        organization_id: orgId,
        role: "assistant",
        content: response.text,
        sources: response.sources as unknown as object[],
        model: response.model,
        entity_context: entityContext ?? null,
        rewritten_query: response.rewrittenQuery ?? null,
        ...telemetry,
      })
      .throwOnError();
  } else {
    // chunks-only fallback (LLM unavailable) — store as a system note
    await db
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        organization_id: orgId,
        role: "assistant",
        content:
          "(LLM nicht verfuegbar — relevante Abschnitte werden angezeigt.)",
        sources: response.items as unknown as object[],
        model,
        entity_context: entityContext ?? null,
        rewritten_query: searchQuery !== trimmed ? searchQuery : null,
        ...telemetry,
      })
      .throwOnError();
  }

  // 8. Auto-title on first turn
  if (allHistory.length === 0) {
    const title = await generateChatTitle(trimmed);
    await db
      .from("chat_conversations")
      .update({ title, model })
      .eq("id", conversationId)
      .eq("organization_id", orgId);
  }

  revalidatePath("/chat", "layout");
  return response;
}

export async function getAvailableModels() {
  return availableModels();
}

// ── Agent-Modus (Tool-Calling-Loop) ───────────────────────────────────────
// Additiver Pfad neben sendMessage(). Der produktive RAG-Chat bleibt
// unangetastet; dieser Zweig fährt den provider-agnostischen Agent-Loop.

export type AgentStepSummary = {
  tool: string;
  ok: boolean;
  latencyMs: number;
};

export type AgentChatResponse = {
  type: "agent";
  text: string;
  sources: ChunkSearchResult[];
  steps: AgentStepSummary[];
  model: string;
  stopReason: string;
};

/** Default-Agent-Modell der aktiven Org (für den Modell-Picker). */
export async function getDefaultAgentModel(): Promise<string> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data } = await db
    .from("organizations")
    .select("metadata")
    .eq("id", orgId)
    .single();
  return resolveOrgModel((data?.metadata ?? null) as Record<string, unknown> | null);
}

// JSONB-Output cappen, damit ein grosses Tool-Ergebnis die Audit-Zeile nicht sprengt.
function clampJson(value: unknown): unknown {
  if (value === undefined) return null;
  const str = JSON.stringify(value);
  if (str.length > 4000) return { preview: str.slice(0, 4000), truncated: true };
  return value;
}

export async function sendAgentMessage(
  conversationId: string,
  question: string,
  model?: string,
): Promise<AgentChatResponse> {
  const startedAt = Date.now();
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const trimmed = question.trim();
  if (!trimmed) {
    return { type: "agent", text: "", sources: [], steps: [], model: model ?? "", stopReason: "empty" };
  }

  const { data: { user } } = await db.auth.getUser();
  const userId = user?.id;

  // 1. History laden
  const { data: historyRows } = await db
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const allHistory = (historyRows ?? []).filter(
    (m): m is { role: "user" | "assistant"; content: string; created_at: string } =>
      m.role === "user" || m.role === "assistant",
  );
  const history: ChatTurn[] = allHistory
    .slice(-HISTORY_WINDOW)
    .map((m) => ({ role: m.role, content: m.content }));

  // 2. User-Message sofort persistieren
  await db.from("chat_messages").insert({
    conversation_id: conversationId,
    organization_id: orgId,
    role: "user",
    content: trimmed,
  });

  // 3. Modell auflösen (explizit → Org-Default) + Agent-Loop fahren
  const chosenModel = model || (await getDefaultAgentModel());
  const result = await runAgent({
    orgId,
    userId,
    question: trimmed,
    history,
    model: chosenModel,
  });

  // 4. Quellen aus den search_knowledge-Steps extrahieren (für UI + Persistenz)
  const sources: ChunkSearchResult[] = [];
  const seen = new Set<string>();
  for (const s of result.steps) {
    if (s.tool !== "search_knowledge" || !s.ok || !s.result || typeof s.result !== "object") continue;
    const r = s.result as { sources?: Array<{ id: string; title: string; type: string; text: string }> };
    for (const src of r.sources ?? []) {
      const key = `${src.id}:${src.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        id: src.id,
        source_id: src.id,
        chunk_index: 0,
        chunk_text: src.text,
        source_title: src.title,
        source_type: src.type,
        rank: 1,
        retrieved_via: "hybrid",
      });
    }
  }

  const latencyMs = Date.now() - startedAt;

  // 5. Assistant-Message persistieren (token_usage = bisher ungenutzte Spalte)
  const { data: inserted } = await db
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      organization_id: orgId,
      role: "assistant",
      content: result.finalText,
      sources: sources as unknown as object[],
      model: result.model,
      token_usage: result.usage as unknown as object,
      latency_ms: latencyMs,
      chunks_retrieved: sources.length,
    })
    .select("id")
    .single()
    .throwOnError();

  const messageId = (inserted as { id: string } | null)?.id ?? null;

  // 6. Audit-Spur: jeden Tool-Call protokollieren (Strategie-Pflicht)
  if (result.steps.length > 0) {
    await db.from("agent_tool_calls").insert(
      result.steps.map((s, i) => ({
        organization_id: orgId,
        conversation_id: conversationId,
        message_id: messageId,
        user_id: userId ?? null,
        step_index: i,
        tool_key: s.tool,
        category: s.category,
        input: s.input as unknown as object,
        output_summary: clampJson(s.result) as unknown as object,
        status: s.status,
        error_message: s.error ?? null,
        latency_ms: s.latencyMs,
        model: result.model,
      })),
    );
  }

  // 7. Auto-Titel beim ersten Turn
  if (allHistory.length === 0) {
    const title = await generateChatTitle(trimmed);
    await db
      .from("chat_conversations")
      .update({ title, model: result.model })
      .eq("id", conversationId)
      .eq("organization_id", orgId);
  }

  revalidatePath("/chat", "layout");

  return {
    type: "agent",
    text: result.finalText,
    sources,
    steps: result.steps.map((s) => ({ tool: s.tool, ok: s.ok, latencyMs: s.latencyMs })),
    model: result.model,
    stopReason: result.stopReason,
  };
}
