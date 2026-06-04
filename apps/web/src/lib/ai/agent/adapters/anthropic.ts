// Native Anthropic tool-use loop (tools + tool_use/tool_result).
// Type-only import keeps the SDK out of the bundle; the client is loaded
// dynamically at call time, mirroring lib/ai/chat.ts.

import type AnthropicSDK from "@anthropic-ai/sdk";
import type { AgentAdapter, AgentResult, AgentStep } from "../types";
import { execTool } from "../exec";

export const anthropicAdapter: AgentAdapter = {
  async run(opts): Promise<AgentResult> {
    const { Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });

    const tools: AnthropicSDK.Tool[] = opts.tools.map((t) => ({
      name:         t.name,
      description:  t.description,
      input_schema: t.parameters as AnthropicSDK.Tool.InputSchema,
    }));

    const messages: AnthropicSDK.MessageParam[] = opts.messages.map((m) => ({
      role:    m.role,
      content: m.content,
    }));

    const steps: AgentStep[] = [];
    let usedTools = false;
    const maxRounds = opts.maxRounds ?? 5;

    for (let round = 0; round < maxRounds; round++) {
      const resp = await client.messages.create({
        model:      opts.model,
        max_tokens: 1500,
        system:     opts.system,
        tools,
        messages,
      });

      const toolUses = resp.content.filter(
        (b): b is AnthropicSDK.ToolUseBlock => b.type === "tool_use",
      );
      const text = resp.content
        .filter((b): b is AnthropicSDK.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
        return { text, steps, usedTools };
      }

      usedTools = true;
      messages.push({ role: "assistant", content: resp.content });

      const results: AnthropicSDK.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        const output = await execTool(opts, tu.name, input);
        steps.push({ tool: tu.name, input, output: output.slice(0, 2000) });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: output });
      }
      messages.push({ role: "user", content: results });
    }

    // Out of rounds → one final call without tools to force a text answer.
    const final = await client.messages.create({
      model:      opts.model,
      max_tokens: 1500,
      system:     opts.system,
      messages,
    });
    const text = final.content
      .filter((b): b is AnthropicSDK.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { text, steps, usedTools };
  },
};
