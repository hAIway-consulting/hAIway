// OpenAI-compatible function-calling loop (tools + tool_calls + role:"tool").
// A configurable baseURL makes this work against OpenAI cloud AND locally
// hosted models (Ollama http://localhost:11434/v1, vLLM, LM Studio,
// llama.cpp) — all speak the same /v1/chat/completions + tools surface.

import type OpenAI from "openai";
import type { AgentAdapter, AgentResult, AgentStep } from "../types";
import { execTool } from "../exec";

export const openAICompatibleAdapter: AgentAdapter = {
  async run(opts): Promise<AgentResult> {
    const { OpenAI: OpenAIClient } = await import("openai");
    const client = new OpenAIClient({
      apiKey: opts.apiKey ?? "not-needed", // local servers usually ignore the key
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = opts.tools.map((t) => ({
      type:     "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: opts.system },
      ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const steps: AgentStep[] = [];
    let usedTools = false;
    const maxRounds = opts.maxRounds ?? 5;
    const tokenUsage = { in: 0, out: 0 };
    const addUsage = (u?: { prompt_tokens?: number; completion_tokens?: number } | null) => {
      tokenUsage.in += u?.prompt_tokens ?? 0;
      tokenUsage.out += u?.completion_tokens ?? 0;
    };

    for (let round = 0; round < maxRounds; round++) {
      // Deadline (spec-cockpit.md §12.3): break to the final no-tools call
      // for a clean partial result instead of starting another round.
      if (opts.deadline && Date.now() >= opts.deadline) break;
      const resp = await client.chat.completions.create({
        model:      opts.model,
        max_tokens: 1500,
        messages,
        tools,
      });
      addUsage(resp.usage);
      const choice = resp.choices[0]?.message;
      const toolCalls = choice?.tool_calls ?? [];

      if (!choice || toolCalls.length === 0) {
        return {
          text: choice?.content ?? "",
          steps,
          usedTools,
          tokenUsage,
          pendingAction: opts.runState?.pendingAction,
        };
      }

      usedTools = true;
      messages.push({ role: "assistant", content: choice.content ?? "", tool_calls: choice.tool_calls });

      for (const tc of toolCalls) {
        const fn = (tc as { function?: { name: string; arguments: string } }).function;
        if (!fn) continue;
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(fn.arguments || "{}") as Record<string, unknown>;
        } catch {
          input = {};
        }
        const output = await execTool(opts, fn.name, input);
        steps.push({ tool: fn.name, input, output: output.slice(0, 2000) });
        messages.push({ role: "tool", tool_call_id: tc.id, content: output });
      }

      // Write preview pending (spec §12.2): stop tool rounds — the final
      // no-tools call below turns the preview into the user-facing text.
      if (opts.runState?.pendingAction) break;
    }

    const final = await client.chat.completions.create({
      model: opts.model,
      max_tokens: 1500,
      messages,
    });
    addUsage(final.usage);
    return {
      text: final.choices[0]?.message?.content ?? "",
      steps,
      usedTools,
      tokenUsage,
      pendingAction: opts.runState?.pendingAction,
    };
  },
};
