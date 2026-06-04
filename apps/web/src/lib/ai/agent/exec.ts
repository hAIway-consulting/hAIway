import type { AgentRunOptions } from "./types";

/**
 * Execute a tool by name and return its result as a JSON string (the format
 * both adapters feed back to the model). Handler errors are caught and
 * returned as `{ error }` so the model can recover gracefully instead of the
 * whole turn failing.
 */
export async function execTool(
  opts:  AgentRunOptions,
  name:  string,
  input: Record<string, unknown>,
): Promise<string> {
  const tool = opts.tools.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `unknown tool: ${name}` });
  try {
    const result = await tool.handler(input, opts.ctx);
    return JSON.stringify(result ?? null);
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}
