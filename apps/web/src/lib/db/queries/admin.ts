import { createServiceClient } from "../supabase-server";

export type AdminOrg = {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan_id: string | null;
  is_platform: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  member_count: number;
};

export type AdminOrgDetail = AdminOrg & {
  members: AdminOrgMember[];
  features: AdminOrgFeature[];
};

export type AdminOrgMember = {
  id: string;
  user_id: string;
  role: string;
  is_default: boolean;
  created_at: string;
  profile: {
    full_name: string | null;
    email: string | null;
  };
};

export type AdminOrgFeature = {
  feature_key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  is_core: boolean;
  has_override: boolean;
};

export type AdminStats = {
  orgCount: number;
  userCount: number;
  sourceCount: number;
};

export async function getAdminStats(): Promise<AdminStats> {
  const db = createServiceClient();

  const [orgs, users, sources] = await Promise.all([
    db
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("is_platform", false),
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("sources").select("id", { count: "exact", head: true }),
  ]);

  return {
    orgCount: orgs.count ?? 0,
    userCount: users.count ?? 0,
    sourceCount: sources.count ?? 0,
  };
}

export async function listOrganizations(): Promise<AdminOrg[]> {
  const db = createServiceClient();

  const { data: orgs, error } = await db
    .from("organizations")
    .select("*")
    .eq("is_platform", false)
    .order("created_at", { ascending: false });

  if (error || !orgs) return [];

  // Get member counts
  const { data: counts } = await db
    .from("organization_members")
    .select("organization_id");

  const countMap = new Map<string, number>();
  if (counts) {
    for (const row of counts) {
      countMap.set(row.organization_id, (countMap.get(row.organization_id) ?? 0) + 1);
    }
  }

  return orgs.map((org) => ({
    ...org,
    member_count: countMap.get(org.id) ?? 0,
  }));
}

export async function getPlatformOrganization(): Promise<AdminOrgDetail | null> {
  const db = createServiceClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("is_platform", true)
    .limit(1)
    .maybeSingle();

  if (!org) return null;
  return getOrganizationAdmin(org.id);
}

export async function getOrganizationAdmin(id: string): Promise<AdminOrgDetail | null> {
  const db = createServiceClient();

  // Fetch org
  const { data: org, error } = await db
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !org) return null;

  // Fetch members with profiles
  const { data: members } = await db
    .from("organization_members")
    .select("id, user_id, role, is_default, created_at, profiles(full_name, email)")
    .eq("organization_id", id)
    .order("created_at");

  // Fetch all feature flags + org overrides + plan features
  const { data: flags } = await db.from("feature_flags").select("*").order("key");
  const { data: overrides } = await db
    .from("organization_features")
    .select("*")
    .eq("organization_id", id);

  // Get plan-based feature keys
  const planId = org.plan_id ?? "standard";
  const { data: planFeatures } = await db
    .from("plan_tier_features")
    .select("feature_key")
    .eq("plan_id", planId);

  const overrideMap = new Map<string, boolean>();
  if (overrides) {
    for (const o of overrides) {
      overrideMap.set(o.feature_key, o.enabled);
    }
  }

  const planFeatureSet = new Set((planFeatures ?? []).map((pf: any) => pf.feature_key));

  const features: AdminOrgFeature[] = (flags ?? []).map((f: any) => ({
    feature_key: f.key,
    name: f.name,
    description: f.description,
    is_core: f.is_core,
    has_override: overrideMap.has(f.key),
    enabled: overrideMap.has(f.key)
      ? overrideMap.get(f.key)!
      : planFeatureSet.has(f.key) || f.is_core,
  }));

  // Count members
  const memberCount = members?.length ?? 0;

  return {
    ...org,
    member_count: memberCount,
    members: (members ?? []).map((m: any) => ({
      ...m,
      profile: m.profiles ?? { full_name: null, email: null },
    })),
    features,
  };
}

export async function updateOrganizationAdmin(
  id: string,
  data: { name?: string; status?: string; metadata?: Record<string, unknown> },
) {
  const db = createServiceClient();
  await db.from("organizations").update(data).eq("id", id);
}

export async function setOrgFeature(orgId: string, featureKey: string, enabled: boolean) {
  const db = createServiceClient();
  await db.from("organization_features").upsert(
    {
      organization_id: orgId,
      feature_key: featureKey,
      enabled,
    },
    { onConflict: "organization_id,feature_key" },
  );
}

export async function removeOrgFeatureOverride(orgId: string, featureKey: string) {
  const db = createServiceClient();
  await db
    .from("organization_features")
    .delete()
    .eq("organization_id", orgId)
    .eq("feature_key", featureKey);
}

// ─── PLAN TIERS ──────────────────────────────────────────────────────────

export type PlanTier = {
  id: string;
  name: string;
  description: string | null;
  limits: Record<string, number | null>;
  instance_type: string;
  sort_order: number;
};

export async function listPlanTiers(): Promise<PlanTier[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("plan_tiers")
    .select("id, name, description, limits, instance_type, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as PlanTier[];
}

export async function updateOrgPlan(orgId: string, planId: string) {
  const db = createServiceClient();

  // Update the plan
  await db.from("organizations").update({ plan_id: planId }).eq("id", orgId);

  // Sync organization_features: remove non-core overrides, then add plan features
  const [{ data: planFeatures }, { data: coreFlags }, { data: currentOverrides }] = await Promise.all([
    db.from("plan_tier_features").select("feature_key").eq("plan_id", planId),
    db.from("feature_flags").select("key").eq("is_core", true),
    db.from("organization_features").select("feature_key").eq("organization_id", orgId),
  ]);

  const coreKeys = new Set((coreFlags ?? []).map((f: any) => f.key));
  const planKeys = new Set((planFeatures ?? []).map((f: any) => f.feature_key));

  // Batch-remove overrides for features not in new plan and not core
  const keysToDelete = (currentOverrides ?? [])
    .filter((o: any) => !planKeys.has(o.feature_key) && !coreKeys.has(o.feature_key))
    .map((o: any) => o.feature_key);

  if (keysToDelete.length > 0) {
    await db
      .from("organization_features")
      .delete()
      .eq("organization_id", orgId)
      .in("feature_key", keysToDelete);
  }

  // Batch-add overrides for non-core plan features
  const rowsToUpsert = [...planKeys]
    .filter((key) => !coreKeys.has(key))
    .map((key) => ({ organization_id: orgId, feature_key: key, enabled: true }));

  if (rowsToUpsert.length > 0) {
    await db
      .from("organization_features")
      .upsert(rowsToUpsert, { onConflict: "organization_id,feature_key" });
  }
}

// ─── INTEGRATION REGISTRY ────────────────────────────────────────────────

export type AdminOrgIntegration = {
  id: string;
  provider_id: string;
  provider_name: string;
  category: string;
  status: string;
  credential_mode: string;
  error_message: string | null;
  last_synced_at: string | null;
};

export async function getOrgIntegrations(orgId: string): Promise<AdminOrgIntegration[]> {
  const db = createServiceClient();

  const { data: integrations } = await db
    .from("organization_integrations")
    .select("id, provider_id, status, credential_mode, error_message, last_synced_at")
    .eq("organization_id", orgId);

  if (!integrations || integrations.length === 0) return [];

  // Get provider names
  const providerIds = integrations.map((i: any) => i.provider_id);
  const { data: providers } = await db
    .from("integration_providers")
    .select("id, name, category")
    .in("id", providerIds);

  const providerMap = new Map<string, { name: string; category: string }>();
  for (const p of providers ?? []) {
    providerMap.set(p.id, { name: p.name, category: p.category });
  }

  return integrations.map((i: any) => ({
    ...i,
    provider_name: providerMap.get(i.provider_id)?.name ?? i.provider_id,
    category: providerMap.get(i.provider_id)?.category ?? "unknown",
  }));
}

export async function updateOrgIntegrationStatus(
  integrationId: string,
  status: string,
  errorMessage?: string,
) {
  const db = createServiceClient();
  await db
    .from("organization_integrations")
    .update({
      status,
      error_message: errorMessage ?? null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", integrationId);
}

// ─── EXISTING ────────────────────────────────────────────────────────────

export async function updateOrgMemberRole(orgId: string, memberId: string, role: string) {
  const db = createServiceClient();
  const { error } = await db
    .from("organization_members")
    .update({ role })
    .eq("id", memberId)
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
}

export async function inviteUserToOrg(orgId: string, email: string, role: string = "member") {
  const db = createServiceClient();

  // Check if user exists
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();

  if (!profile) {
    // Invite via Supabase Auth
    const { data: invite, error: inviteError } = await db.auth.admin.inviteUserByEmail(email);
    if (inviteError || !invite.user) {
      throw new Error(inviteError?.message ?? "Einladung fehlgeschlagen");
    }

    // Add membership
    await db.from("organization_members").insert({
      organization_id: orgId,
      user_id: invite.user.id,
      role,
      is_default: true,
    });
  } else {
    // User exists — add membership
    await db.from("organization_members").upsert(
      {
        organization_id: orgId,
        user_id: profile.id,
        role,
      },
      { onConflict: "organization_id,user_id" },
    );
  }
}
