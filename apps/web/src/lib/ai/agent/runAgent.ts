// Entry point: resolve the org's agent config, pick the adapter, run the loop.
// Returns null when no agent provider is available (caller falls back to RAG).

import type { AgentMessage, AgentResult, AgentRunOptions, AgentTool } from "./types";
import { resolveAgentConfig } from "./config";
import { anthropicAdapter } from "./adapters/anthropic";
import { openAICompatibleAdapter } from "./adapters/openai-compatible";

export async function runAgent(params: {
  orgId:      string;
  userId?:    string;
  system:     string;
  messages:   AgentMessage[];
  tools:      AgentTool[];
  maxRounds?: number;
}): Promise<AgentResult | null> {
  const cfg = await resolveAgentConfig(params.orgId);
  if (!cfg.available) return null;

  const adapter = cfg.kind === "anthropic" ? anthropicAdapter : openAICompatibleAdapter;
  const opts: AgentRunOptions = {
    system:    params.system,
    messages:  params.messages,
    tools:     params.tools,
    ctx:       { orgId: params.orgId, userId: params.userId },
    model:     cfg.model,
    apiKey:    cfg.apiKey,
    baseURL:   cfg.baseURL,
    maxRounds: params.maxRounds ?? 5,
  };
  return adapter.run(opts);
}
