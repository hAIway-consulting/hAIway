// Cross-tenant queries for the platform-admin cockpit views
// (docs/spec-admin-dashboard.md §5–§6).
//
// Everything in here runs on the SERVICE client: the cross-tenant views
// (ai_usage_platform_daily, agent_runs_daily) grant service_role only and
// ai_provider_keys is deny-all RLS. Callers MUST gate with the strict
// isPlatformAdmin() check — the soft /admin layout gate is not enough.
//
// Defensive by design: every query resolves to an empty result on error so
// the pages render their German empty states even before the cockpit
// migrations are pushed.

import { createServiceClient } from "../supabase-server";

// ─── PROVIDER KEYS (admin spec §5) ───────────────────────────────────────
// IMPORTANT: encrypted_key is NEVER selected here — raw/encrypted key
// material must not travel into page props. The UI only sees key_hint.

export type PlatformKey = {
  id: string;
  provider: string;
  name: string;
  key_hint: string;
  status: string;
  rotated_at: string | null;
  constraints: Record<string, unknown>;
  created_at: string;
};

export async function listPlatformKeys(): Promise<PlatformKey[]> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("ai_provider_keys")
      .select("id, provider, name, key_hint, status, rotated_at, constraints, created_at")
      .is("organization_id", null)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as PlatformKey[];
  } catch {
    return [];
  }
}

export type TenantKey = {
  provider: string;
  key_hint: string;
  status: string;
  constraints: Record<string, unknown>;
};

export type TenantKeyAssignment = {
  organization_id: string;
  org_name: string;
  default_model: string | null;
  keys: TenantKey[];
};

/** Org × provider matrix: which tenant runs on which key/model. */
export async function listTenantKeyAssignments(): Promise<TenantKeyAssignment[]> {
  try {
    const db = createServiceClient();
    const [orgsRes, keysRes] = await Promise.all([
      db
        .from("organizations")
        .select("id, name, metadata")
        .eq("is_platform", false)
        .order("name"),
      db
        .from("ai_provider_keys")
        .select("organization_id, provider, key_hint, status, constraints")
        .not("organization_id", "is", null),
    ]);
    if (orgsRes.error || !orgsRes.data) return [];

    const keysByOrg = new Map<string, TenantKey[]>();
    for (const k of keysRes.data ?? []) {
      const list = keysByOrg.get(k.organization_id) ?? [];
      list.push({
        provider: k.provider,
        key_hint: k.key_hint,
        status: k.status,
        constraints: (k.constraints as Record<string, unknown>) ?? {},
      });
      keysByOrg.set(k.organization_id, list);
    }

    return orgsRes.data.map((org) => {
      const aiSettings = (org.metadata as { ai_settings?: { default_model?: string } } | null)
        ?.ai_settings;
      return {
        organization_id: org.id,
        org_name: org.name,
        default_model: aiSettings?.default_model ?? null,
        keys: keysByOrg.get(org.id) ?? [],
      };
    });
  } catch {
    return [];
  }
}

// ─── USAGE & QUOTA (admin spec §6) ───────────────────────────────────────

export type OrgUsage = {
  organization_id: string;
  org_name: string;
  plan_id: string | null;
  tokens: number;
  cost_cents: number;
  tokens_limit: number | null;
};

export type UsageBreakdownRow = {
  provider: string;
  model: string;
  purpose: string;
  tokens: number;
  cost_cents: number;
  events: number;
};

export type UsagePlatformRollup = {
  perOrg: OrgUsage[];
  breakdown: UsageBreakdownRow[];
};

/**
 * Current-month rollup from ai_usage_platform_daily (service_role-only view):
 * per-org tokens/cost vs. plan limit + provider/model/purpose breakdown.
 */
export async function usagePlatformRollup(): Promise<UsagePlatformRollup> {
  const empty: UsagePlatformRollup = { perOrg: [], breakdown: [] };
  try {
    const db = createServiceClient();
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const { data: rows, error } = await db
      .from("ai_usage_platform_daily")
      .select("organization_id, provider, model, purpose, tokens_in, tokens_out, cost_cents, events")
      .gte("day", monthStart);
    if (error || !rows || rows.length === 0) return empty;

    const orgIds = [...new Set(rows.map((r) => r.organization_id as string))];
    const [orgsRes, plansRes] = await Promise.all([
      db.from("organizations").select("id, name, plan_id").in("id", orgIds),
      db.from("plan_tiers").select("id, limits"),
    ]);

    const orgMeta = new Map(
      (orgsRes.data ?? []).map(
        (o) => [o.id, { name: o.name as string, plan_id: o.plan_id as string | null }] as const,
      ),
    );
    const planLimits = new Map(
      (plansRes.data ?? []).map((p) => {
        const limit = (p.limits as Record<string, unknown> | null)?.max_ai_tokens_month;
        return [p.id as string, typeof limit === "number" ? limit : null] as const;
      }),
    );

    const perOrgMap = new Map<string, OrgUsage>();
    const breakdownMap = new Map<string, UsageBreakdownRow>();
    for (const r of rows) {
      const tokens = Number(r.tokens_in ?? 0) + Number(r.tokens_out ?? 0);
      const cost = Number(r.cost_cents ?? 0);

      const meta = orgMeta.get(r.organization_id);
      const planId = meta?.plan_id ?? null;
      const org =
        perOrgMap.get(r.organization_id) ??
        {
          organization_id: r.organization_id,
          org_name: meta?.name ?? r.organization_id,
          plan_id: planId,
          tokens: 0,
          cost_cents: 0,
          tokens_limit: planId ? (planLimits.get(planId) ?? null) : null,
        };
      org.tokens += tokens;
      org.cost_cents += cost;
      perOrgMap.set(r.organization_id, org);

      const dimKey = `${r.provider}:${r.model}:${r.purpose}`;
      const dim =
        breakdownMap.get(dimKey) ??
        { provider: r.provider, model: r.model, purpose: r.purpose, tokens: 0, cost_cents: 0, events: 0 };
      dim.tokens += tokens;
      dim.cost_cents += cost;
      dim.events += Number(r.events ?? 0);
      breakdownMap.set(dimKey, dim);
    }

    return {
      perOrg: [...perOrgMap.values()].sort((a, b) => b.tokens - a.tokens),
      breakdown: [...breakdownMap.values()].sort((a, b) => b.tokens - a.tokens),
    };
  } catch {
    return empty;
  }
}

export type QuotaAlarm = OrgUsage & { ratio: number };

/** Orgs at ≥ `threshold` (default 80 %) of plan_tiers.limits.max_ai_tokens_month. */
export async function quotaAlarms(threshold = 0.8): Promise<QuotaAlarm[]> {
  try {
    const { perOrg } = await usagePlatformRollup();
    return perOrg
      .filter((o) => o.tokens_limit !== null && o.tokens_limit > 0 && o.tokens / o.tokens_limit >= threshold)
      .map((o) => ({ ...o, ratio: o.tokens / (o.tokens_limit as number) }))
      .sort((a, b) => b.ratio - a.ratio);
  } catch {
    return [];
  }
}

// ─── RUNS (admin spec §6) ────────────────────────────────────────────────

export type RunsDailyRow = {
  organization_id: string;
  day: string;
  total: number;
  failed: number;
  p95_duration_ms: number | null;
};

/** agent_runs_daily (last `days` days). */
export async function runsDaily(days = 14): Promise<RunsDailyRow[]> {
  try {
    const db = createServiceClient();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const agentsRes = await db
      .from("agent_runs_daily")
      .select("organization_id, day, total, failed, p95_duration_ms")
      .gte("day", since);
    if (agentsRes.error) return [];

    return ((agentsRes.data ?? []) as RunsDailyRow[]).map((r) => ({
      organization_id: r.organization_id,
      day: r.day,
      total: Number(r.total ?? 0),
      failed: Number(r.failed ?? 0),
      p95_duration_ms: r.p95_duration_ms === null ? null : Number(r.p95_duration_ms),
    }));
  } catch {
    return [];
  }
}
