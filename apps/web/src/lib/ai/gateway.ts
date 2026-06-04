/**
 * Vercel AI Gateway Wrapper.
 *
 * Zentraler Ein-/Ausgang für alle Modell-Aufrufe — egal ob Anthropic, OpenAI,
 * Google, DeepSeek, Mistral, Aleph Alpha. Modelle werden als Strings im
 * Format `provider/model` referenziert (siehe https://ai-sdk.dev/providers).
 *
 * Hosting / DSGVO-Strategie (Memo `project_dsgvo_hosting_concern`):
 *   Pro Pilotkunde wählt der Berater im Cockpit, welche Provider in Frage
 *   kommen. Das Default-Modell pro Org liegt in
 *   `organizations.metadata.ai_settings.default_model`.
 *
 * Migration-Status: dies ist Schritt 1 — Wrapper steht. Schritt 2 ersetzt
 * die direkten Anthropic-SDK-Aufrufe in `lib/ai/chat.ts` schrittweise. Bis
 * dahin laufen produktive Chats weiter über das alte SDK. Der Agent-Loop
 * (`agent-loop.ts`) nutzt den Gateway bereits durchgängig.
 */

import { generateText, type LanguageModel } from "ai";

// Modell-Katalog + Org-Auflösung leben jetzt client-sicher in `models.ts`
// (kein `ai`-Import), damit der Chat-Modell-Picker sie nutzen kann. Hier nur
// re-exportiert, damit bestehende Importe unverändert bleiben.
import { DEFAULT_MODEL_STRING, type SupportedModelId } from "./models";
export {
  DEFAULT_MODEL_STRING,
  SUPPORTED_MODELS,
  resolveOrgModel,
  isSupportedModel,
  modelLabel,
  type SupportedModelId,
} from "./models";

export type GatewayChatTurn = { role: "user" | "assistant" | "system"; content: string };

/**
 * Einfacher Text-Aufruf über den Gateway. Wirft, wenn die Konfiguration
 * fehlt — Caller entscheidet über Fallback-Strategie.
 */
export async function gatewayGenerate(params: {
  model: SupportedModelId | string;
  system?: string;
  messages?: GatewayChatTurn[];
  prompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<{ text: string; model: string }> {
  const { model, system, messages, prompt, temperature, maxOutputTokens } = params;
  const modelLM = (model || DEFAULT_MODEL_STRING) as unknown as LanguageModel;
  const settings = {
    ...(system ? { system } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  };

  if (messages && messages.length > 0) {
    const result = await generateText({
      model: modelLM,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...settings,
    });
    return { text: result.text, model };
  }

  if (prompt) {
    const result = await generateText({
      model: modelLM,
      prompt,
      ...settings,
    });
    return { text: result.text, model };
  }

  throw new Error("gatewayGenerate: either messages or prompt required");
}
