"use server";

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId, requireBeraterRole } from "@/lib/db/org-context";
import { aiSettingsSchema, type AiSettingsInput } from "@/lib/validation/schemas";

export type SaveAiSettingsResult = { ok: true } | { ok: false; error: string };

export async function saveAiSettings(
  payload: AiSettingsInput,
): Promise<SaveAiSettingsResult> {
  // Role gate, not just org membership: settings.ai.agent.base_url redirects
  // the agent endpoint, and the platform API key travels to whatever host is
  // configured there. A plain member must not be able to set it — Server
  // Actions are reachable by any authenticated user, the page gate is not
  // enough. The RLS policy organizations_berater_update (20260806130000 §6a)
  // mirrors this role set, and the column GRANT there limits the user client
  // to the `settings` column.
  await requireBeraterRole();

  // The base_url validation is the actual security control: without it an org
  // admin could point the agent at a foreign host and collect the API key.
  const parsed = aiSettingsSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe.",
    };
  }
  const data = parsed.data;

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
      system_prompt: data.system_prompt,
      tone: data.tone,
      // Resolved by lib/ai/agent/config.ts; empty values fall back to env.
      agent: {
        provider: data.agent_provider,
        model: data.agent_model,
        base_url: data.agent_base_url,
      },
    },
  };

  // .select() so an UPDATE that RLS filters down to zero rows is visible:
  // PostgREST reports no error for that case, which used to make the form
  // claim success without saving anything.
  const { data: updated, error } = await db
    .from("organizations")
    .update({ settings: next })
    .eq("id", orgId)
    .select("id");

  if (error) throw error;
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      error:
        "Speichern nicht möglich — für diese Organisation fehlt die Berechtigung.",
    };
  }

  revalidatePath("/admin/ai-settings");
  revalidatePath("/chat", "layout");
  return { ok: true };
}
