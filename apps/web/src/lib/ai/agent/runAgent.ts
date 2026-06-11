// Entry point: resolve the org's agent config, pick the adapter, run the loop.
// Returns null when no agent provider is available (caller falls back to a
// clear unavailability message — the implicit RAG fallback is gone, spec §12.1).
//
// Audit (spec §13): every run writes an agent_runs row (running → final
// status) via the service client. Logging is best-effort — a missing table
// (foundation migration not pushed yet) never breaks the answer.

import type {
  AgentMessage,
  AgentResult,
  AgentRunOptions,
  AgentTool,
  MemberRole,
  PendingAction,
} from "./types";
import { resolveAgentConfig } from "./config";
import { anthropicAdapter } from "./adapters/anthropic";
import { openAICompatibleAdapter } from "./adapters/openai-compatible";
import { filterToolsForRole } from "./registry";

const DEFAULT_TIMEOUT_MS = 60_000;

function digest(value: unknown, max = 300): string {
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

export async function runAgent(params: {
  orgId:      string;
  userId?:    string;
  role?:      MemberRole;
  system:     string;
  messages:   AgentMessage[];
  tools:      AgentTool[];
  maxRounds?: number;
  timeoutMs?: number;
  /** audit linkage (spec §13) */
  conversationId?: string;
  savedAgentId?:   string;
}): Promise<AgentResult | null> {
  const cfg = await resolveAgentConfig(params.orgId);
  if (!cfg.available) return null;

  // Defense in depth: role filtering happens here, not only in callers.
  const tools = filterToolsForRole(params.tools, params.role);

  const adapter = cfg.kind === "anthropic" ? anthropicAdapter : openAICompatibleAdapter;
  const startedAt = Date.now();
  // Shared mutable state with the exec layer — carries the intercepted write
  // preview (spec §12.2) out of the adapter loop.
  const runState: { pendingAction?: PendingAction } = {};
  const opts: AgentRunOptions = {
    system:    params.system,
    messages:  params.messages,
    tools,
    ctx:       { orgId: params.orgId, userId: params.userId, role: params.role },
    model:     cfg.model,
    apiKey:    cfg.apiKey,
    baseURL:   cfg.baseURL,
    maxRounds: params.maxRounds ?? 5,
    deadline:  startedAt + (params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    runState,
  };

  const runId = await startRunLog(params, cfg.model);

  try {
    const result = await adapter.run(opts);
    result.runId = runId;
    await finishRunLog(runId, params, cfg.model, startedAt, result, null);
    return result;
  } catch (err) {
    await finishRunLog(runId, params, cfg.model, startedAt, null, err);
    throw err;
  }
}

type RunParams = Parameters<typeof runAgent>[0];

async function startRunLog(params: RunParams, model: string): Promise<string | null> {
  try {
    const { createServiceClient } = await import("@/lib/db/supabase-server");
    const db = createServiceClient();
    const { data } = await db
      .from("agent_runs")
      .insert({
        organization_id: params.orgId,
        conversation_id: params.conversationId ?? null,
        saved_agent_id:  params.savedAgentId ?? null,
        triggered_by:    params.userId ?? null,
        model,
        status: "running",
      })
      .select("id")
      .single();
    return (data?.id as string) ?? null;
  } catch {
    return null;
  }
}

async function finishRunLog(
  runId: string | null,
  params: RunParams,
  model: string,
  startedAt: number,
  result: AgentResult | null,
  error: unknown,
): Promise<void> {
  const durationMs = Date.now() - startedAt;

  if (runId) {
    try {
      const { createServiceClient } = await import("@/lib/db/supabase-server");
      const db = createServiceClient();
      // A pending write keeps the run open (no finished_at) until the user
      // decides in the UI — confirmAgentAction settles it (spec §12.2).
      const awaiting = Boolean(result?.pendingAction);
      await db
        .from("agent_runs")
        .update({
          status: awaiting ? "awaiting_confirmation" : result ? "success" : "failed",
          ...(awaiting
            ? { pending_action: result?.pendingAction ?? null }
            : { finished_at: new Date().toISOString(), duration_ms: durationMs }),
          tool_calls: (result?.steps ?? []).map((s) => ({
            tool:          s.tool,
            input_digest:  digest(s.input),
            result_digest: digest(s.output),
            // confirmed stays null until the user decided (write tools only).
            confirmed:     null,
          })),
          token_usage:   result ? result.tokenUsage : null,
          error_message: error ? (error instanceof Error ? error.message : String(error)) : null,
        })
        .eq("id", runId);
    } catch {
      /* best effort */
    }
  }

  if (result) {
    const { recordAiUsage } = await import("@/lib/ai/usage");
    void recordAiUsage({
      orgId:     params.orgId,
      userId:    params.userId,
      provider:  model.toLowerCase().startsWith("claude") ? "anthropic" : "openai",
      model,
      purpose:   "agent",
      tokensIn:  result.tokenUsage.in,
      tokensOut: result.tokenUsage.out,
      refType:   runId ? "agent_run" : null,
      refId:     runId,
    });
  }
}
