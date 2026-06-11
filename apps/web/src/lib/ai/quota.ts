// Monthly AI token quota (spec-cockpit.md §12.3): budget from
// plan_tiers.limits.max_ai_tokens_month, consumption from the
// ai_usage_events rollup (get_org_ai_usage_month).
//
// Fails open: if the RPC or limit is missing (migration not pushed yet,
// enterprise = null limit), requests are never blocked.

import { createUserClient } from "@/lib/db/supabase-server";

export interface AiQuotaStatus {
  exceeded: boolean;
  /** German user-facing message when exceeded */
  message: string;
  tokensUsed: number;
  tokensLimit: number | null;
}

const OK: AiQuotaStatus = { exceeded: false, message: "", tokensUsed: 0, tokensLimit: null };

export async function checkAiQuota(orgId: string): Promise<AiQuotaStatus> {
  try {
    const db = await createUserClient();

    const [usageRes, limitRes] = await Promise.all([
      db.rpc("get_org_ai_usage_month", { p_org_id: orgId }),
      db.rpc("get_org_limit", { p_org_id: orgId, p_limit_key: "max_ai_tokens_month" }),
    ]);

    const limit = limitRes.data as number | null;
    if (limitRes.error || limit == null) return OK;

    const row = Array.isArray(usageRes.data) ? usageRes.data[0] : usageRes.data;
    const tokensUsed = Number((row as { tokens?: number } | null)?.tokens ?? 0);

    if (tokensUsed < limit) {
      return { exceeded: false, message: "", tokensUsed, tokensLimit: limit };
    }

    return {
      exceeded: true,
      tokensUsed,
      tokensLimit: limit,
      message:
        "Das monatliche KI-Kontingent eurer Organisation ist aufgebraucht. " +
        "Euer Berater wurde im Dashboard informiert — er kann das Kontingent anpassen. " +
        "Ab dem nächsten Monat steht das volle Kontingent wieder zur Verfügung.",
    };
  } catch {
    return OK;
  }
}
