// Resolve which agentic model to run: env defaults, per-org override.
//
// Env: AGENT_PROVIDER (anthropic | openai-compatible), AGENT_MODEL,
//      AGENT_BASE_URL, AGENT_API_KEY. Falls back to ANTHROPIC_API_KEY /
//      OPENAI key already present on the platform.
// Org override: organizations.settings.ai.agent = { provider, model, base_url }.
//      (Configured by the Berater in the KI-Einstellungen — incl. a local model.)

import { createUserClient } from "@/lib/db/supabase-server";
import { getOpenAIKeyForChat } from "@/lib/ai/embeddings";
import { resolveProviderKey } from "@/lib/ai/provider-keys";

export type AgentKind = "anthropic" | "openai-compatible";

export interface ResolvedAgentConfig {
  kind:      AgentKind;
  model:     string;
  baseURL?:  string;
  apiKey?:   string;
  available: boolean;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL    = "gpt-4o";

function normalizeKind(v: string | undefined | null): AgentKind | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s === "anthropic" || s === "claude") return "anthropic";
  if (s === "openai-compatible" || s === "openai" || s === "local") return "openai-compatible";
  return null;
}

interface OrgAgentSettings {
  provider?: string;
  model?:    string;
  base_url?: string;
}

export async function resolveAgentConfig(orgId?: string): Promise<ResolvedAgentConfig> {
  // 1. Env defaults
  let kind: AgentKind = normalizeKind(process.env.AGENT_PROVIDER) ?? "anthropic";
  let explicit = normalizeKind(process.env.AGENT_PROVIDER) !== null;
  let model = process.env.AGENT_MODEL ?? "";
  let baseURL = process.env.AGENT_BASE_URL || undefined;

  // 2. Per-org override
  if (orgId) {
    try {
      const db = await createUserClient();
      const { data } = await db
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .single();
      const agent =
        ((data?.settings as { ai?: { agent?: OrgAgentSettings } } | null)?.ai?.agent) ?? {};
      const k = normalizeKind(agent.provider);
      if (k) { kind = k; explicit = true; }
      if (agent.model) model = agent.model;
      if (agent.base_url) baseURL = agent.base_url;
    } catch {
      /* fall back to env */
    }
  }

  // 3. API key — resolution chain: explicit env override → tenant key →
  //    platform key → env fallback (spec-cockpit.md §5.2). Local endpoints
  //    often need none.
  let apiKey = process.env.AGENT_API_KEY || undefined;
  if (!apiKey) {
    const resolved = await resolveProviderKey(
      kind === "anthropic" ? "anthropic" : "openai",
      orgId,
    );
    apiKey = resolved?.apiKey;
  }
  if (!apiKey) {
    apiKey =
      (kind === "anthropic" ? process.env.ANTHROPIC_API_KEY : getOpenAIKeyForChat()) ||
      undefined;
  }

  // Default provider with no Anthropic key but an OpenAI key present → use the
  // OpenAI-compatible path so the agent still works (mirrors the chat fallback).
  if (!explicit && kind === "anthropic" && !apiKey && !baseURL) {
    const oa = getOpenAIKeyForChat();
    if (oa) {
      kind = "openai-compatible";
      apiKey = oa;
    }
  }

  if (!model) model = kind === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL;

  // anthropic needs a key; openai-compatible can run keyless against a local base_url.
  const available = kind === "anthropic" ? !!apiKey : !!apiKey || !!baseURL;

  return { kind, model, baseURL, apiKey, available };
}
