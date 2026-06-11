"use server";

// Agent-mode server actions (spec-cockpit.md §12): the explicit tool-use
// path of the Cockpit. Chat mode (sendMessage) is pure RAG; this path runs
// the provider-agnostic agent loop with limits + audit (agent_runs).

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId, getMemberRole } from "@/lib/db/org-context";
import { hybridSearch } from "@/lib/db/queries/search";
import {
  buildSystemPrompt,
  buildContextBlock,
  generateChatTitle,
  type ChatResponse,
} from "@/lib/ai/chat";
import { runAgent } from "@/lib/ai/agent/runAgent";
import { resolveAgentConfig } from "@/lib/ai/agent/config";
import { AGENT_TOOLS } from "@/lib/ai/agent/registry";
import type { AgentMessage, AgentStep, MemberRole } from "@/lib/ai/agent/types";
import { checkAiQuota } from "@/lib/ai/quota";

const AGENT_MAX_ROUNDS = 8;     // spec §12.3
const AGENT_TIMEOUT_MS = 60_000; // spec §12.3
const RETRIEVAL_LIMIT = 8;       // light doc context — tools cover structured data
const HISTORY_WINDOW = 10;

export interface AgentChatResponse {
  response: ChatResponse;
  steps: AgentStep[];
}

export async function sendAgentMessage(
  conversationId: string,
  question: string,
): Promise<AgentChatResponse> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const trimmed = question.trim();
  if (!trimmed) {
    return { response: { type: "chunks", items: [] }, steps: [] };
  }

  const { data: { user } } = await db.auth.getUser();
  const userId = user?.id;
  const role = ((await getMemberRole().catch(() => null)) ?? "member") as MemberRole;

  // Quota gate — same budget pool as chat (spec §12.3).
  const quota = await checkAiQuota(orgId);
  if (quota.exceeded) {
    return {
      response: { type: "answer", text: quota.message, sources: [], model: "claude" },
      steps: [],
    };
  }

  // Mode assert (spec §12.4): no mixed conversations. Tolerates a missing
  // mode column (pre-push previews) — then nothing enforces agent mode yet.
  const { data: conv } = await db
    .from("chat_conversations")
    .select("mode")
    .eq("id", conversationId)
    .maybeSingle();
  const mode = (conv as { mode?: string } | null)?.mode;
  if (mode === "chat") {
    throw new Error("Diese Konversation läuft im Chat-Modus — Moduswechsel startet eine neue Konversation.");
  }

  // Availability is explicit — no silent RAG fallback (spec §12.1).
  const cfg = await resolveAgentConfig(orgId);
  if (!cfg.available) {
    return {
      response: {
        type: "answer",
        text:
          "Der Agenten-Modus ist für eure Organisation noch nicht eingerichtet " +
          "(kein Agent-Modell konfiguriert). Euer Berater kann das in den KI-Einstellungen aktivieren.",
        sources: [],
        model: "claude",
      },
      steps: [],
    };
  }

  // History + persist the user message (same pattern as sendMessage).
  const { data: historyRows } = await db
    .from("chat_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const history = (historyRows ?? [])
    .filter((m): m is { role: "user" | "assistant"; content: string } =>
      m.role === "user" || m.role === "assistant")
    .slice(-HISTORY_WINDOW);

  await db.from("chat_messages").insert({
    conversation_id: conversationId,
    organization_id: orgId,
    role: "user",
    content: trimmed,
  });

  // Light document context: one hybrid search pass (folder permissions via
  // userId). The heavy multi-arm retrieval stays chat-mode territory.
  const chunks = await hybridSearch(trimmed, RETRIEVAL_LIMIT, userId).catch(() => []);
  const contextBlock = chunks.length ? buildContextBlock(chunks) : "(keine Dokument-Treffer)";

  const systemPrompt = await buildSystemPrompt(undefined, true);
  const messages: AgentMessage[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: `Dokument-Quellen:\n\n${contextBlock}\n\n---\n\nFrage: ${trimmed}` },
  ];

  let text: string;
  let steps: AgentStep[] = [];
  try {
    const result = await runAgent({
      orgId,
      userId,
      role,
      system: systemPrompt,
      messages,
      tools: AGENT_TOOLS,
      maxRounds: AGENT_MAX_ROUNDS,
      timeoutMs: AGENT_TIMEOUT_MS,
      conversationId,
    });
    if (!result) throw new Error("agent unavailable");
    text = result.text.trim() ||
      "Der Agent hat keine Antwort erzeugt. Bitte formuliere die Anfrage konkreter.";
    steps = result.steps;
  } catch {
    text =
      "Der Agent konnte die Anfrage nicht abschließen. Bitte versuche es erneut — " +
      "bei wiederholten Fehlern hilft euer Berater weiter.";
  }

  const response: ChatResponse = {
    type: "answer",
    text,
    sources: chunks,
    model: cfg.kind === "anthropic" ? "claude" : "gpt-4o",
  };

  await db
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      organization_id: orgId,
      role: "assistant",
      content: text,
      sources: chunks as unknown as object[],
      model: response.type === "answer" ? response.model : null,
    })
    .throwOnError();

  // Auto-title on first turn (mirrors sendMessage).
  if (history.length === 0) {
    const title = await generateChatTitle(trimmed, { orgId, userId });
    await db
      .from("chat_conversations")
      .update({ title })
      .eq("id", conversationId)
      .eq("organization_id", orgId);
  }

  revalidatePath("/chat", "layout");
  return { response, steps };
}
