// Agent-Loop (provider-agnostisch).
//
// Multi-Step-Tool-Calling über das Vercel AI SDK — läuft über JEDEN Gateway-
// Provider (Anthropic/OpenAI/Google/Mistral/DeepSeek), nicht nur Anthropic.
// Die Schleife (Modell ruft Tool → Ergebnis → erneut) übernimmt das SDK via
// `stopWhen: stepCountIs(MAX_STEPS)`. Der heutige RAG-Pfad (`chat.ts`) bleibt
// unangetastet — dies ist ein additiver Pfad.

import { generateText, stepCountIs, type LanguageModel } from "ai";
import { buildSystemPrompt, type ChatTurn } from "./chat";
import { DEFAULT_MODEL_STRING } from "./models";
import { getEnabledTools } from "./tools/registry";
import { toAiSdkTools } from "./tools/to-ai-sdk";
import type { AgentToolStep, ToolContext } from "./tools/types";

const MAX_STEPS = 8;
const MAX_OUTPUT_TOKENS = 2048;

export type AgentRunResult = {
  finalText: string;
  steps: AgentToolStep[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  stopReason: "end_turn" | "max_steps" | "error";
  model: string;
};

const TOOL_GUIDANCE = `

Du hast Werkzeuge (Tools) zur Verfügung. Regeln für den Tool-Einsatz:
- Nutze 'search_knowledge' für JEDE Faktenfrage, bevor du antwortest.
- Für Listen-/CRM-Fragen nutze 'find_entities' bzw. 'list_entities_by_status'; mit den gelieferten IDs dann 'get_company' / 'get_contact'.
- Erfinde keine Tool-Argumente. Fehlt ein Pflichtwert, frage den Nutzer.
- Nach Tool-Ergebnissen gelten weiter die harten Quellen-Regeln oben: zitiere nur, was die Tools zurückgegeben haben. Liefert ein Tool {found: 0}, sage das transparent und erfinde nichts.`;

export async function buildAgentSystemPrompt(entityContext?: string): Promise<string> {
  const base = await buildSystemPrompt(entityContext);
  return base + TOOL_GUIDANCE;
}

export async function runAgent(params: {
  orgId: string;
  userId?: string;
  question: string;
  history: ChatTurn[];
  model?: string;
}): Promise<AgentRunResult> {
  const model = params.model || DEFAULT_MODEL_STRING;
  const systemPrompt = await buildAgentSystemPrompt();

  const ctx: ToolContext = { orgId: params.orgId, userId: params.userId };
  const defs = await getEnabledTools(params.orgId);
  const steps: AgentToolStep[] = [];
  const tools = toAiSdkTools(defs, ctx, steps);

  const messages: ChatTurn[] = [
    ...params.history,
    { role: "user", content: params.question },
  ];

  try {
    const result = await generateText({
      model: model as unknown as LanguageModel,
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });

    const finishedClean = result.finishReason === "stop";
    const reachedCap = (result.steps?.length ?? 0) >= MAX_STEPS && !finishedClean;
    const finalText =
      result.text?.trim() ||
      (reachedCap
        ? "Die Anfrage erforderte zu viele Schritte und wurde gestoppt. Bitte präzisiere die Aufgabe."
        : "Ich konnte dazu keine Antwort erzeugen.");

    const u = result.totalUsage;
    return {
      finalText,
      steps,
      usage: {
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
        totalTokens: u?.totalTokens ?? 0,
      },
      stopReason: reachedCap ? "max_steps" : "end_turn",
      model,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      finalText: `Der Agent konnte nicht ausgeführt werden: ${message}`,
      steps,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      stopReason: "error",
      model,
    };
  }
}
