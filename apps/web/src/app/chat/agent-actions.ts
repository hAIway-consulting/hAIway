"use server";

// Agent-mode server actions (spec-cockpit.md §12): the explicit tool-use
// path of the Cockpit. Chat mode (sendMessage) is pure RAG; this path runs
// the provider-agnostic agent loop with limits + audit (agent_runs).

import { revalidatePath } from "next/cache";
<<<<<<< HEAD
import { createUserClient, createServiceClient } from "@/lib/db/supabase-server";
=======
import { createUserClient } from "@/lib/db/supabase-server";
>>>>>>> origin/feature/cockpit-db-foundation
import { requireOrgId, getMemberRole } from "@/lib/db/org-context";
import { hybridSearch } from "@/lib/db/queries/search";
import {
  buildSystemPrompt,
  buildContextBlock,
  generateChatTitle,
<<<<<<< HEAD
  summarizeConversationAsAgentPrompt,
  type ChatResponse,
  type SavedAgentDraft,
} from "@/lib/ai/chat";
import { runAgent } from "@/lib/ai/agent/runAgent";
import { resolveAgentConfig } from "@/lib/ai/agent/config";
import { AGENT_TOOLS, filterToolsForRole, roleSatisfies } from "@/lib/ai/agent/registry";
import type { AgentMessage, AgentStep, MemberRole, PendingAction } from "@/lib/ai/agent/types";
=======
  type ChatResponse,
} from "@/lib/ai/chat";
import { runAgent } from "@/lib/ai/agent/runAgent";
import { resolveAgentConfig } from "@/lib/ai/agent/config";
import { AGENT_TOOLS } from "@/lib/ai/agent/registry";
import type { AgentMessage, AgentStep, MemberRole } from "@/lib/ai/agent/types";
>>>>>>> origin/feature/cockpit-db-foundation
import { checkAiQuota } from "@/lib/ai/quota";

const AGENT_MAX_ROUNDS = 8;     // spec §12.3
const AGENT_TIMEOUT_MS = 60_000; // spec §12.3
const RETRIEVAL_LIMIT = 8;       // light doc context — tools cover structured data
const HISTORY_WINDOW = 10;

<<<<<<< HEAD
/** Write action awaiting UI confirmation — what the client needs to render the card. */
export interface PendingConfirmation {
  runId:   string;
  tool:    string;
  preview: string;
}

export interface AgentChatResponse {
  response: ChatResponse;
  steps: AgentStep[];
  /** set when a write tool produced a preview — the UI must confirm/cancel (spec §12.2) */
  pendingAction?: PendingConfirmation;
=======
export interface AgentChatResponse {
  response: ChatResponse;
  steps: AgentStep[];
>>>>>>> origin/feature/cockpit-db-foundation
}

export async function sendAgentMessage(
  conversationId: string,
  question: string,
<<<<<<< HEAD
  /** saved-agent linkage for the agent_runs audit trail (spec §9/§13) */
  opts?: { savedAgentId?: string },
=======
>>>>>>> origin/feature/cockpit-db-foundation
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
<<<<<<< HEAD
  let pendingAction: PendingConfirmation | undefined;
=======
>>>>>>> origin/feature/cockpit-db-foundation
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
<<<<<<< HEAD
      savedAgentId: opts?.savedAgentId,
=======
>>>>>>> origin/feature/cockpit-db-foundation
    });
    if (!result) throw new Error("agent unavailable");
    text = result.text.trim() ||
      "Der Agent hat keine Antwort erzeugt. Bitte formuliere die Anfrage konkreter.";
    steps = result.steps;
<<<<<<< HEAD
    // Without a persisted run row there is nothing to confirm against — the
    // preview text still shows, but no card (defensive, e.g. table missing).
    if (result.pendingAction && result.runId) {
      pendingAction = {
        runId:   result.runId,
        tool:    result.pendingAction.tool,
        preview: result.pendingAction.preview,
      };
    }
=======
>>>>>>> origin/feature/cockpit-db-foundation
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
<<<<<<< HEAD
  return { response, steps, pendingAction };
}

// ── Write confirmation (spec-cockpit.md §12.2) ───────────────────────────

const RESULT_TRUNCATE = 2000;
const CONFIRM_SUMMARY_TIMEOUT_MS = 30_000;

function digest(value: unknown, max = 300): string {
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

export interface ConfirmActionResult {
  ok: boolean;
  /** assistant-style text for the chat (success summary or German error) */
  text: string;
}

type AgentRunRow = {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  triggered_by: string | null;
  status: string;
  started_at: string;
  tool_calls: unknown;
  pending_action: PendingAction | null;
};

/**
 * Settle a pending write action (spec §12.2). The persisted input is executed
 * verbatim with confirm=true — the model is NOT involved in the execution and
 * cannot re-issue or alter the action. Idempotent: any state other than
 * awaiting_confirmation returns a German notice instead of throwing.
 */
export async function confirmAgentAction(
  runId: string,
  approve: boolean,
): Promise<ConfirmActionResult> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, text: "Nicht angemeldet." };

  // Load via USER client — RLS guarantees org membership.
  let run: AgentRunRow | null = null;
  try {
    const { data } = await db
      .from("agent_runs")
      .select("id, organization_id, conversation_id, triggered_by, status, started_at, tool_calls, pending_action")
      .eq("id", runId)
      .maybeSingle();
    run = (data as AgentRunRow | null) ?? null;
  } catch {
    run = null;
  }

  if (!run || run.organization_id !== orgId || !run.pending_action) {
    return { ok: false, text: "Diese Aktion ist nicht mehr offen — sie wurde bereits verarbeitet oder ist nicht verfügbar." };
  }
  if (run.triggered_by !== user.id) {
    return { ok: false, text: "Nur wer die Aktion ausgelöst hat, kann sie bestätigen oder abbrechen." };
  }
  if (run.status !== "awaiting_confirmation") {
    return { ok: false, text: "Diese Aktion wurde bereits bestätigt oder abgebrochen." };
  }

  const pending = run.pending_action;
  const tool = AGENT_TOOLS.find((t) => t.name === pending.tool);
  if (!tool) {
    return { ok: false, text: "Das Werkzeug dieser Aktion ist nicht mehr verfügbar." };
  }

  // Re-check permissions at decision time (role may have changed since the
  // preview): write tools are never available to members + minRole applies.
  const role = ((await getMemberRole().catch(() => null)) ?? "member") as MemberRole;
  if ((tool.access === "write" && role === "member") || !roleSatisfies(role, tool.minRole)) {
    return { ok: false, text: "Dir fehlt die Berechtigung, diese Aktion auszuführen." };
  }

  const startedAtMs = new Date(run.started_at).getTime();
  const priorCalls = Array.isArray(run.tool_calls) ? (run.tool_calls as unknown[]) : [];
  const service = createServiceClient();

  // Atomically claim the pending action (status -> running). Guarantees a
  // double-submit or parallel tab can never execute the write twice — only
  // one caller wins the compare-and-set.
  try {
    const { data: claimed } = await service
      .from("agent_runs")
      .update({ status: "running" })
      .eq("id", run.id)
      .eq("status", "awaiting_confirmation")
      .select("id");
    if (!claimed || claimed.length === 0) {
      return { ok: false, text: "Diese Aktion wurde bereits bestätigt oder abgebrochen." };
    }
  } catch {
    return { ok: false, text: "Die Aktion konnte gerade nicht verarbeitet werden. Bitte versuche es erneut." };
  }

  async function persistAssistantMessage(text: string): Promise<void> {
    if (!run?.conversation_id) return;
    await db
      .from("chat_messages")
      .insert({
        conversation_id: run.conversation_id,
        organization_id: orgId,
        role: "assistant",
        content: text,
      })
      .throwOnError();
  }

  // ── Cancel ──────────────────────────────────────────────────────────────
  if (!approve) {
    const text = "Aktion abgebrochen — es wurde nichts verändert.";
    try {
      await service
        .from("agent_runs")
        .update({
          status:         "cancelled",
          pending_action: null,
          finished_at:    new Date().toISOString(),
          duration_ms:    Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : null,
          tool_calls:     [...priorCalls, { tool: pending.tool, input_digest: digest(pending.input), confirmed: false }],
        })
        .eq("id", run.id);
    } catch {
      /* best effort */
    }
    try {
      await persistAssistantMessage(text);
    } catch {
      /* message persistence is best effort */
    }
    revalidatePath("/chat", "layout");
    return { ok: true, text };
  }

  // ── Approve: execute the PERSISTED input directly — no model involved. ──
  let result: unknown;
  try {
    result = await tool.handler(
      { ...pending.input, confirm: true },
      { orgId, userId: user.id, role },
    );
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    try {
      await service
        .from("agent_runs")
        .update({
          status:         "failed",
          pending_action: null,
          finished_at:    new Date().toISOString(),
          duration_ms:    Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : null,
          tool_calls:     [...priorCalls, { tool: pending.tool, input_digest: digest(pending.input), confirmed: true }],
          error_message:  reason,
        })
        .eq("id", run.id);
    } catch {
      /* best effort */
    }
    const text = "Die Aktion konnte nicht ausgeführt werden. Bitte versuche es erneut — bei wiederholten Fehlern hilft euer Berater weiter.";
    try {
      await persistAssistantMessage(text);
    } catch {
      /* best effort */
    }
    revalidatePath("/chat", "layout");
    return { ok: false, text };
  }

  const resultJson = digest(result, RESULT_TRUNCATE);

  // ONE summarization round — read-only tools only, so the model cannot
  // trigger another write while phrasing the outcome.
  let summary = "Die Aktion wurde ausgeführt.";
  try {
    const systemPrompt = await buildSystemPrompt(undefined, true);
    const summaryResult = await runAgent({
      orgId,
      userId: user.id,
      role,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content:
            "Die Aktion wurde vom Nutzer bestätigt und ausgeführt. " +
            `Ergebnis: ${resultJson}. Fasse das Ergebnis kurz für den Nutzer zusammen.`,
        },
      ],
      tools: filterToolsForRole(AGENT_TOOLS, "member"),
      maxRounds: 1,
      timeoutMs: CONFIRM_SUMMARY_TIMEOUT_MS,
      conversationId: run.conversation_id ?? undefined,
    });
    if (summaryResult?.text.trim()) summary = summaryResult.text.trim();
  } catch {
    /* fall back to the generic confirmation text */
  }

  try {
    await persistAssistantMessage(summary);
  } catch {
    /* best effort */
  }

  try {
    await service
      .from("agent_runs")
      .update({
        status:         "success",
        pending_action: null,
        finished_at:    new Date().toISOString(),
        duration_ms:    Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : null,
        tool_calls: [
          ...priorCalls,
          {
            tool:          pending.tool,
            input_digest:  digest(pending.input),
            result_digest: digest(result),
            confirmed:     true,
          },
        ],
      })
      .eq("id", run.id);
  } catch {
    /* best effort */
  }

  revalidatePath("/chat", "layout");
  return { ok: true, text: summary };
}

/**
 * Reconstruct an open confirmation after a page refresh: newest
 * awaiting_confirmation run of this conversation, scoped to the triggering
 * user. Defensive — a missing table (foundation migration not pushed yet)
 * yields null.
 */
export async function getPendingConfirmation(
  conversationId: string,
): Promise<PendingConfirmation | null> {
  try {
    const db = await createUserClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return null;
    const { data } = await db
      .from("agent_runs")
      .select("id, pending_action")
      .eq("conversation_id", conversationId)
      .eq("status", "awaiting_confirmation")
      .eq("triggered_by", user.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const pending = (data?.pending_action ?? null) as PendingAction | null;
    if (!data || !pending) return null;
    return { runId: data.id as string, tool: pending.tool, preview: pending.preview };
  } catch {
    return null;
  }
}

// ── Saved agents (spec-cockpit.md §9) ────────────────────────────────────

/**
 * Summarize the conversation into an editable saved-agent draft. The draft
 * is ALWAYS shown to the user for review — saveSavedAgent only runs after
 * the user confirmed/edited it (review instead of blackbox, spec §9).
 */
export async function proposeSavedAgent(
  conversationId: string,
): Promise<SavedAgentDraft> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data: { user } } = await db.auth.getUser();

  const { data: rows } = await db
    .from("chat_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const history = (rows ?? []).filter(
    (m): m is { role: "user" | "assistant"; content: string } =>
      m.role === "user" || m.role === "assistant",
  );

  if (history.length < 2) {
    throw new Error(
      "Zum Speichern braucht der Agent mindestens einen abgeschlossenen Auftrag (Frage und Antwort).",
    );
  }

  return summarizeConversationAsAgentPrompt(history, { orgId, userId: user?.id });
}

export interface SaveSavedAgentInput {
  name: string;
  description: string;
  prompt: string;
  visibility: "private" | "org";
  sourceConversationId?: string;
}

/**
 * Persist the reviewed draft as a saved agent. Insert runs through the user
 * client — RLS enforces org membership and created_by = auth.uid().
 */
export async function saveSavedAgent(input: SaveSavedAgentInput): Promise<string> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Nicht angemeldet.");

  const name = (input.name ?? "").trim();
  const description = (input.description ?? "").trim();
  const prompt = (input.prompt ?? "").trim();
  const visibility = input.visibility;

  if (name.length < 1 || name.length > 80) {
    throw new Error("Der Name muss zwischen 1 und 80 Zeichen lang sein.");
  }
  if (prompt.length < 1 || prompt.length > 4000) {
    throw new Error("Der Prompt muss zwischen 1 und 4000 Zeichen lang sein.");
  }
  if (visibility !== "private" && visibility !== "org") {
    throw new Error("Ungültige Sichtbarkeit.");
  }

  const { data, error } = await db
    .from("saved_agents")
    .insert({
      organization_id: orgId,
      name,
      description,
      prompt,
      created_by: user.id,
      visibility,
      source_conversation_id: input.sourceConversationId ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      "Der Agent konnte nicht gespeichert werden. Bitte versuche es erneut.",
    );
  }

  revalidatePath("/");
  return data.id as string;
=======
  return { response, steps };
>>>>>>> origin/feature/cockpit-db-foundation
}
