"use server";

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId, requireBeraterRole } from "@/lib/db/org-context";

type Payload = {
  system_prompt: string;
  tone: "formal" | "casual" | "neutral";
  // Agentic model (tool-calling). Empty provider = platform default (env).
  agent_provider: "" | "anthropic" | "openai-compatible";
  agent_model: string;
  agent_base_url: string;
};

export async function saveAiSettings(payload: Payload): Promise<void> {
  // Role gate, not just org membership: settings.ai.agent.base_url redirects
  // the agent endpoint, and the platform API key travels to whatever host is
  // configured there. A plain member must not be able to set it — Server
  // Actions are reachable by any authenticated user, the page gate is not
  // enough.
  await requireBeraterRole();

  const orgId = await requireOrgId();
  const db = await createUserClient();

  // Read-modify-write the JSONB settings column to keep other keys intact.
  const { data: existing } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .single();

  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const next = {
    ...current,
    ai: {
      system_prompt: payload.system_prompt.trim(),
      tone: payload.tone,
      // Resolved by lib/ai/agent/config.ts; empty values fall back to env.
      agent: {
        provider: payload.agent_provider,
        model: payload.agent_model.trim(),
        base_url: payload.agent_base_url.trim(),
      },
    },
  };

  const { error } = await db
    .from("organizations")
    .update({ settings: next })
    .eq("id", orgId);

  if (error) throw error;

  revalidatePath("/admin/ai-settings");
  revalidatePath("/chat", "layout");
}
