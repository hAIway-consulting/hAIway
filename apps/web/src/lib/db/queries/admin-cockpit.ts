// Cross-tenant queries for the platform-admin cockpit views
// (docs/spec-admin-dashboard.md §3–§6).
//
// Everything in here runs on the SERVICE client: the cross-tenant views
// (ai_usage_platform_daily, agent_runs_daily, skill_runs_daily) grant
// service_role only, ai_provider_keys is deny-all RLS, and library rows
// (skills.organization_id IS NULL, automation_templates) are written via
// service role exclusively. Callers MUST gate with the strict
// isPlatformAdmin() check — the soft /admin layout gate is not enough.
//
// Defensive by design: every query resolves to an empty result on error so
// the pages render their German empty states even before the cockpit
// migrations are pushed.

import { createServiceClient } from "../supabase-server";

// ─── AUTOMATIONS (admin spec §3) ─────────────────────────────────────────

export type PlatformAutomation = {
  id: string;
  organization_id: string;
  org_name: string;
  key: string;
  name: string;
  description: string;
  requires: string[];
  status: string;
  owner_name: string | null;
  template_id: string | null;
};

export async function listAllAutomations(): Promise<PlatformAutomation[]> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("automations")
      .select("id, organization_id, key, name, description, requires, status, owner, template_id")
      .order("key")
      .order("created_at");
    if (error || !data) return [];

    const orgIds = [...new Set(data.map((a) => a.organization_id as string))];
    const ownerIds = [...new Set(data.map((a) => a.owner as string | null).filter(Boolean))] as string[];

    const [orgsRes, ownersRes] = await Promise.all([
      orgIds.length
        ? db.from("organizations").select("id, name").in("id", orgIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ownerIds.length
        ? db.from("profiles").select("id, full_name, email").in("id", ownerIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    ]);

    const orgNames = new Map((orgsRes.data ?? []).map((o) => [o.id, o.name] as const));
    const ownerNames = new Map(
      (ownersRes.data ?? []).map((p) => [p.id, p.full_name ?? p.email ?? null] as const),
    );

    return data.map((a) => ({
      id: a.id,
      organization_id: a.organization_id,
      org_name: orgNames.get(a.organization_id) ?? a.organization_id,
      key: a.key,
      name: a.name,
      description: a.description ?? "",
      requires: (a.requires as string[]) ?? [],
      status: a.status,
      owner_name: a.owner ? (ownerNames.get(a.owner) ?? null) : null,
      template_id: a.template_id,
    }));
  } catch {
    return [];
  }
}

export type AutomationHealth = {
  organization_id: string;
  workflow_key: string;
  total: number;
  failed: number;
};

/** failed/total per org + workflow key from workflow_runs (last `days` days). */
export async function automationHealth(days = 14): Promise<AutomationHealth[]> {
  try {
    const db = createServiceClient();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data, error } = await db
      .from("workflow_runs")
      .select("organization_id, workflow_key, status")
      .gte("started_at", since)
      .limit(10_000);
    if (error || !data) return [];

    const byKey = new Map<string, AutomationHealth>();
    for (const run of data) {
      const mapKey = `${run.organization_id}:${run.workflow_key}`;
      const entry =
        byKey.get(mapKey) ??
        { organization_id: run.organization_id, workflow_key: run.workflow_key, total: 0, failed: 0 };
      entry.total += 1;
      if (run.status === "failed") entry.failed += 1;
      byKey.set(mapKey, entry);
    }
    return [...byKey.values()];
  } catch {
    return [];
  }
}

export type AutomationTemplate = {
  id: string;
  key: string;
  name: string;
  description: string;
  requires: string[];
  default_config: Record<string, unknown>;
  industry_tag: string | null;
  version: number;
  updated_at: string;
};

export async function listTemplates(): Promise<AutomationTemplate[]> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("automation_templates")
      .select("id, key, name, description, requires, default_config, industry_tag, version, updated_at")
      .order("key");
    if (error || !data) return [];
    return data as AutomationTemplate[];
  } catch {
    return [];
  }
}

/** Connection status per org × provider — drives the requires/blocker badges. */
export type OrgProviderConnection = {
  organization_id: string;
  provider_id: string;
  status: string;
};

export async function listOrgProviderConnections(): Promise<OrgProviderConnection[]> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("organization_integrations")
      .select("organization_id, provider_id, status");
    if (error || !data) return [];
    return data as OrgProviderConnection[];
  } catch {
    return [];
  }
}

// ─── SKILL LIBRARY (admin spec §4) ───────────────────────────────────────

export type LibrarySkill = {
  id: string;
  name: string;
  description: string;
  industry_scope: string | null;
  prompt_template: string;
  tool_refs: string[];
  code_ref: string | null;
  status: string;
  version: number;
  updated_at: string;
};

export async function listLibrarySkills(): Promise<LibrarySkill[]> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("skills")
      .select("id, name, description, industry_scope, prompt_template, tool_refs, code_ref, status, version, updated_at")
      .is("organization_id", null)
      .order("name");
    if (error || !data) return [];
    return data as LibrarySkill[];
  } catch {
    return [];
  }
}

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
  kind: "agent" | "skill";
  organization_id: string;
  day: string;
  total: number;
  failed: number;
  p95_duration_ms: number | null;
};

/** agent_runs_daily + skill_runs_daily merged (last `days` days). */
export async function runsDaily(days = 14): Promise<RunsDailyRow[]> {
  try {
    const db = createServiceClient();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const [agentsRes, skillsRes] = await Promise.all([
      db
        .from("agent_runs_daily")
        .select("organization_id, day, total, failed, p95_duration_ms")
        .gte("day", since),
      db
        .from("skill_runs_daily")
        .select("organization_id, day, total, failed, p95_duration_ms")
        .gte("day", since),
    ]);

    const tag = (kind: "agent" | "skill", rows: unknown[] | null): RunsDailyRow[] =>
      ((rows ?? []) as Omit<RunsDailyRow, "kind">[]).map((r) => ({
        kind,
        organization_id: r.organization_id,
        day: r.day,
        total: Number(r.total ?? 0),
        failed: Number(r.failed ?? 0),
        p95_duration_ms: r.p95_duration_ms === null ? null : Number(r.p95_duration_ms),
      }));

    return [
      ...tag("agent", agentsRes.error ? [] : agentsRes.data),
      ...tag("skill", skillsRes.error ? [] : skillsRes.data),
    ];
  } catch {
    return [];
  }
}
