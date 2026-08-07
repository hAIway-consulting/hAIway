// AI usage tracking (spec-cockpit.md §5.2). Every model interaction writes
// an ai_usage_events row via the service client; the table is the rollup
// source for dashboards and quota enforcement. chat_messages.token_usage
// stays as per-message detail.

import { createServiceClient } from "@/lib/db/supabase-server";
import { estimateCostCents } from "./pricing";

export type AiUsagePurpose = "chat" | "agent" | "embedding";

export interface AiUsageEvent {
  orgId:     string;
  userId?:   string | null;
  provider:  string;
  model:     string;
  purpose:   AiUsagePurpose;
  tokensIn:  number;
  tokensOut: number;
  refType?:  "chat_message" | "agent_run" | "source" | null;
  refId?:    string | null;
}

/**
 * Fire-and-forget: usage tracking must never break the user-facing call.
 * Errors are logged and swallowed.
 */
export async function recordAiUsage(event: AiUsageEvent): Promise<void> {
  try {
    const db = createServiceClient();
    const { error } = await db.from("ai_usage_events").insert({
      organization_id:     event.orgId,
      user_id:             event.userId ?? null,
      provider:            event.provider,
      model:               event.model,
      purpose:             event.purpose,
      tokens_in:           event.tokensIn,
      tokens_out:          event.tokensOut,
      cost_estimate_cents: estimateCostCents(event.model, event.tokensIn, event.tokensOut),
      ref_type:            event.refType ?? null,
      ref_id:              event.refId ?? null,
    });
    if (error) console.error("[ai-usage] insert failed:", error.message);
  } catch (err) {
    console.error("[ai-usage] record failed:", err);
  }
}

/** Provider segment of a gateway model string ("anthropic/claude-…" → "anthropic"). */
export function providerFromModel(model: string): string {
  const idx = model.indexOf("/");
  if (idx > 0) return model.slice(0, idx);
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("text-embedding") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
  if (m.startsWith("gemini")) return "google";
  if (m.startsWith("deepseek")) return "deepseek";
  if (m.startsWith("mistral")) return "mistral";
  return "unknown";
}
