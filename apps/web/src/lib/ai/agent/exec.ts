import type { AgentRunOptions } from "./types";

/**
 * Execute a tool by name and return its result as a JSON string (the format
 * both adapters feed back to the model). Handler errors are caught and
 * returned as `{ error }` so the model can recover gracefully instead of the
 * whole turn failing.
 *
 * Write tools (access === "write") are intercepted here (spec §12.2): the
 * handler is ALWAYS called with confirm=false — a code guarantee, not a
 * prompt rule — so the model can only ever produce a preview. The preview is
 * recorded as runState.pendingAction; the actual execution happens after the
 * user confirms in the UI (confirmAgentAction), never via the model. Only
 * one write per run: further write calls are blocked until confirmed.
 */
export async function execTool(
  opts:  AgentRunOptions,
  name:  string,
  input: Record<string, unknown>,
): Promise<string> {
  const tool = opts.tools.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `unknown tool: ${name}` });

  const isWrite = tool.access === "write";
  if (isWrite && opts.runState?.pendingAction) {
    return JSON.stringify({
      error: "weitere Schreibaktion blockiert — zuerst bestätigen",
    });
  }

  try {
    // Force preview mode for writes regardless of what the model passed.
    const effectiveInput = isWrite ? { ...input, confirm: false } : input;
    const result = await tool.handler(effectiveInput, opts.ctx);
    const output = JSON.stringify(result ?? null);

    if (isWrite && opts.runState) {
      const { confirm: _confirm, ...originalInput } = input;
      opts.runState.pendingAction = {
        id:      crypto.randomUUID(),
        tool:    name,
        input:   originalInput,
        preview: output,
      };
    }

    return output;
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}
