// Adapter: ToolDefinition[] → Vercel-AI-SDK ToolSet.
//
// Das AI-SDK konsumiert Zod-Schemas direkt als `inputSchema` (kein JSON-Schema-
// Adapter nötig) und validiert den Input VOR `execute` — halluzinierte Argumente
// werden so abgefangen. Der execute-Wrapper isoliert Handler-Fehler (gibt sie
// strukturiert ans Modell zurück statt zu werfen) und protokolliert jeden
// Tool-Call in den Audit-Sink.

import { tool, type ToolSet } from "ai";
import type { ToolContext, ToolDefinition, AgentToolStep } from "./types";

export function toAiSdkTools(
  defs: ToolDefinition[],
  ctx: ToolContext,
  sink: AgentToolStep[],
): ToolSet {
  const out: ToolSet = {};
  for (const def of defs) {
    out[def.key] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async (input: unknown) => {
        const t0 = Date.now();
        try {
          const result = await def.handler(ctx, input);
          sink.push({
            tool: def.key,
            category: def.category,
            input,
            ok: true,
            status: "ok",
            result,
            latencyMs: Date.now() - t0,
          });
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sink.push({
            tool: def.key,
            category: def.category,
            input,
            ok: false,
            status: "error",
            error: message,
            latencyMs: Date.now() - t0,
          });
          // Strukturierter Fehler statt Throw → Modell kann umplanen.
          return { error: message };
        }
      },
    });
  }
  return out;
}
