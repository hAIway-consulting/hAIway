/**
 * Modell-Katalog (client-sicher).
 *
 * Reine Daten + reine Funktionen — KEIN Import aus `ai`, damit Client-
 * Komponenten (z. B. der Modell-Picker im Chat) diese Liste nutzen können,
 * ohne das Vercel-AI-SDK ins Browser-Bundle zu ziehen. `gateway.ts` und der
 * Agent-Loop re-exportieren von hier.
 *
 * Modelle werden als Strings im Format `provider/model` referenziert und vom
 * Vercel-AI-Gateway aufgelöst (siehe https://ai-sdk.dev/providers).
 */

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

export function isSupportedModel(id: string): id is SupportedModelId {
  return SUPPORTED_MODELS.some((m) => m.id === id);
}

export function modelLabel(id: string): string {
  return SUPPORTED_MODELS.find((m) => m.id === id)?.label ?? id;
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
