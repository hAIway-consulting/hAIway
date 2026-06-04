// Tool-Registry — Typen.
//
// Eine ToolDefinition ist die *ausführbare Wahrheit* eines Agenten-Werkzeugs:
// Zod-Schema (Validierung + Anthropic/AI-SDK input_schema) + Handler. Die
// DB-Tabelle `agent_tools` ist nur der Katalog/Toggle-Spiegel.
//
// SICHERHEIT: Handler ziehen `orgId` IMMER aus `ctx`, NIE aus dem Tool-Input.
// Kein input_schema darf ein `organization_id`/`org_id`-Feld enthalten — sonst
// könnte das Modell Cross-Org-Zugriff erzwingen.

import type { z } from "zod";

export type ToolCategory = "knowledge" | "crm" | "connector" | "artifact";

export type ToolContext = {
  orgId: string;
  userId?: string;
};

export type ToolDefinition<I = unknown, O = unknown> = {
  /** == agent_tools.key == AI-SDK tool name (snake_case, stabil). */
  key: string;
  /** Kurzbeschreibung für das LLM (Deutsch — der Agent arbeitet auf Deutsch). */
  description: string;
  category: ToolCategory;
  /** Optionales Feature-Gate via org_has_feature. */
  featureKey?: string;
  /** Optionaler Modell-Hint für aufgaben-spezifische Modellwahl (Phase 2). */
  model?: string;
  inputSchema: z.ZodType<I>;
  handler: (ctx: ToolContext, input: I) => Promise<O>;
};

/** Ein einzelner Tool-Call im Loop — für Audit (`agent_tool_calls`) + UI. */
export type AgentToolStep = {
  tool: string;
  category: ToolCategory | null;
  input: unknown;
  ok: boolean;
  status: "ok" | "invalid_input" | "error" | "unknown_tool";
  result?: unknown;
  error?: string;
  latencyMs: number;
};
