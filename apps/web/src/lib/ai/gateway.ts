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
 * dahin laufen produktive Chats weiter über das alte SDK.
 */

import { generateText, type LanguageModel } from "ai";

// Default-Modell, wenn die Org kein eigenes konfiguriert hat. Bewusst
// Anthropic-Sonnet, weil das den heutigen produktiven Pfad spiegelt — bei
// Pilot-Onboarding wechselt der Berater pro Org auf das gewünschte Modell.
export const DEFAULT_MODEL_STRING = "anthropic/claude-sonnet-4-6";

// Modell-Strings, die wir UI-seitig zur Auswahl stellen. Liste wächst, sobald
// neue Provider via Gateway unterstützt sind.
export const SUPPORTED_MODELS = [
  // Anthropic
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "Anthropic", region: "US/EU" },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Anthropic", region: "US/EU" },
  // OpenAI
  { id: "openai/gpt-4o", label: "GPT-4o", provider: "OpenAI", region: "US/EU" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini", provider: "OpenAI", region: "US/EU" },
  // Google
  { id: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "Google", region: "US/EU" },
  { id: "google/gemini-2.0-pro", label: "Gemini 2.0 Pro", provider: "Google", region: "US/EU" },
  // DeepSeek
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat", provider: "DeepSeek", region: "CN/Global" },
  { id: "deepseek/deepseek-reasoner", label: "DeepSeek R1", provider: "DeepSeek", region: "CN/Global" },
  // Mistral (EU)
  { id: "mistral/mistral-large-latest", label: "Mistral Large", provider: "Mistral", region: "EU" },
] as const;

export type SupportedModelId = (typeof SUPPORTED_MODELS)[number]["id"];

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
  const modelLM = model as unknown as LanguageModel;
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

/**
 * Liefert das Default-Modell für eine Org. Wenn keine Konfiguration vorliegt,
 * fällt es auf DEFAULT_MODEL_STRING zurück. Die Org-Konfiguration steht in
 * `organizations.metadata.ai_settings.default_model`.
 */
export function resolveOrgModel(orgMetadata: Record<string, unknown> | null | undefined): string {
  const aiSettings = (orgMetadata as { ai_settings?: { default_model?: string } } | null | undefined)?.ai_settings;
  return aiSettings?.default_model || DEFAULT_MODEL_STRING;
}

export interface OrgAiConfig {
  /** gateway model string, e.g. "anthropic/claude-sonnet-4-6" */
  modelString: string;
  /** provider segment of the model string */
  provider: string;
  /** resolved API key (tenant → platform → env) or undefined for the gateway path */
  apiKey?: string;
  /** where the key came from */
  keySource?: "tenant" | "platform" | "env";
  /** routing constraints from the key row, e.g. { eu_only: true } */
  constraints: Record<string, unknown>;
}

/**
 * Combined per-tenant routing config (spec-cockpit.md §5.2/§5.3): the org's
 * default model plus the resolved provider key. When a DB key exists, callers
 * instantiate the provider SDK directly with that key; the env fallback keeps
 * today's gateway path working.
 */
export async function resolveOrgAiConfig(orgId: string): Promise<OrgAiConfig> {
  const { createUserClient } = await import("@/lib/db/supabase-server");
  const { resolveProviderKey } = await import("@/lib/ai/provider-keys");

  let metadata: Record<string, unknown> | null = null;
  try {
    const db = await createUserClient();
    const { data } = await db
      .from("organizations")
      .select("metadata")
      .eq("id", orgId)
      .single();
    metadata = (data?.metadata as Record<string, unknown>) ?? null;
  } catch {
    /* fall back to defaults */
  }

  const modelString = resolveOrgModel(metadata);
  const provider = modelString.split("/")[0] ?? "anthropic";
  const resolved = await resolveProviderKey(provider, orgId);

  return {
    modelString,
    provider,
    apiKey: resolved?.apiKey,
    keySource: resolved?.source,
    constraints: resolved?.constraints ?? {},
  };
}
