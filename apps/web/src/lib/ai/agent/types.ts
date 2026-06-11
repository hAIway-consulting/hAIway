// Provider-agnostic agent layer.
//
// Tools are defined once (JSON-Schema params + a handler) and run by any
// adapter. Two adapters ship: native Anthropic and OpenAI-compatible (the
// latter covers OpenAI cloud AND locally-hosted models via base_url —
// Ollama, vLLM, LM Studio, llama.cpp). New providers = new adapter only.

export type MemberRole = "member" | "admin" | "owner";

export interface AgentContext {
  orgId:   string;
  userId?: string;
  /** caller's org role — drives tool filtering (spec-cockpit.md §11/§12.2) */
  role?:   MemberRole;
}

export interface AgentTool {
  name:        string;
  description: string;
  /** JSON Schema object — maps directly to Anthropic input_schema + OpenAI function.parameters. */
  parameters:  Record<string, unknown>;
  handler:     (input: Record<string, unknown>, ctx: AgentContext) => Promise<unknown>;
}

export interface AgentMessage {
  role:    "user" | "assistant";
  content: string;
}

export interface AgentStep {
  tool:   string;
  input:  Record<string, unknown>;
  output: string; // stringified tool result (truncated)
}

export interface AgentTokenUsage {
  in:  number;
  out: number;
}

export interface AgentResult {
  text:     string;
  steps:    AgentStep[];
  usedTools: boolean;
  /** summed across all rounds (incl. final no-tools call) */
  tokenUsage: AgentTokenUsage;
}

export interface AgentRunOptions {
  system:    string;
  messages:  AgentMessage[];
  tools:     AgentTool[];
  ctx:       AgentContext;
  model:     string;
  apiKey?:   string;
  baseURL?:  string;
  maxRounds?: number;
  /** epoch ms — adapters break to the final no-tools call once reached (spec §12.3) */
  deadline?: number;
}

export interface AgentAdapter {
  run(opts: AgentRunOptions): Promise<AgentResult>;
}
