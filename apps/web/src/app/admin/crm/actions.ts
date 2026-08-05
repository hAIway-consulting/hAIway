"use server";

import { revalidatePath } from "next/cache";
import { requireOrgId, getMemberRole, ORG_MANAGER_ROLES } from "@/lib/db/org-context";
import { createServiceClient, createUserClient } from "@/lib/db/supabase-server";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { runTwentySync } from "@/lib/crm/twenty-sync";
import {
  twentyConnectionSchema,
  crmSetLevelSchema,
  crmLevelKeySchema,
} from "@/lib/validation/schemas";

const PROVIDER_ID = "twenty";
const APP_KEY = "crm";
const PAGE = "/admin/crm";

// Stricter than the /admin layout gate (BERATER_ROLES): granting tool access
// is org management — admin/owner or platform admin only, matching the
// is_org_admin() RLS on member_app_permissions.
export async function requireCrmAdmin(): Promise<void> {
  if (await isPlatformAdmin().catch(() => false)) return;
  const role = await getMemberRole();
  if (!role || !ORG_MANAGER_ROLES.includes(role)) {
    throw new Error("Unauthorized: org admin required");
  }
}

type TwentyConfig = {
  base_url?: string;
  role_map?: Record<string, { twenty_role_id: string; label?: string }>;
  available_roles?: Array<{ id: string; label: string }>;
  [key: string]: unknown;
};

async function getIntegrationRow() {
  const orgId = await requireOrgId();
  const db = createServiceClient();
  const { data } = await db
    .from("organization_integrations")
    .select("status, credentials, config, error_message, last_synced_at")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .maybeSingle<{
      status: string;
      credentials: Record<string, string>;
      config: TwentyConfig;
      error_message: string | null;
      last_synced_at: string | null;
    }>();
  return { orgId, row: data };
}

export async function saveTwentyConnection(formData: FormData): Promise<void> {
  await requireCrmAdmin();
  const parsed = twentyConnectionSchema.safeParse({
    baseUrl: formData.get("base_url"),
    apiKey: formData.get("api_key"),
    serviceEmail: formData.get("service_email"),
    servicePassword: formData.get("service_password"),
  });
  if (!parsed.success) return;

  const { orgId, row } = await getIntegrationRow();
  const previous = row?.credentials ?? {};
  // Empty secret fields keep the stored value (they are never round-tripped
  // into the form).
  const credentials = {
    api_key: parsed.data.apiKey ?? previous.api_key ?? "",
    service_email: parsed.data.serviceEmail ?? previous.service_email ?? "",
    service_password: parsed.data.servicePassword ?? previous.service_password ?? "",
  };

  const db = createServiceClient();
  const { error } = await db.from("organization_integrations").upsert(
    {
      organization_id: orgId,
      provider_id: PROVIDER_ID,
      status: "configuring",
      credential_mode: "customer",
      credentials,
      config: { ...(row?.config ?? {}), base_url: parsed.data.baseUrl },
      error_message: null,
    },
    { onConflict: "organization_id,provider_id" },
  );
  if (error) throw error;

  await runTwentySync(orgId, "test-connection");
  revalidatePath(PAGE);
  revalidatePath("/admin/integrationen");
}

export async function testTwentyConnection(): Promise<void> {
  await requireCrmAdmin();
  const orgId = await requireOrgId();
  await runTwentySync(orgId, "test-connection");
  revalidatePath(PAGE);
  revalidatePath("/admin/integrationen");
}

async function persistRoleMap(
  orgId: string,
  config: TwentyConfig,
  roleMap: NonNullable<TwentyConfig["role_map"]>,
): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from("organization_integrations")
    .update({ config: { ...config, role_map: roleMap } })
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID);
  if (error) throw error;
}

export async function saveRoleMap(formData: FormData): Promise<void> {
  await requireCrmAdmin();
  const { orgId, row } = await getIntegrationRow();
  if (!row) return;

  const availableRoles = new Map(
    (row.config.available_roles ?? []).map((r) => [r.id, r.label] as const),
  );
  const levels = formData.getAll("level_name").map(String);
  const roleIds = formData.getAll("level_role").map(String);

  const roleMap: NonNullable<TwentyConfig["role_map"]> = {};
  for (let i = 0; i < levels.length; i++) {
    const levelParsed = crmLevelKeySchema.safeParse(levels[i]);
    const roleId = roleIds[i];
    if (!levelParsed.success || !roleId || !availableRoles.has(roleId)) continue;
    roleMap[levelParsed.data] = {
      twenty_role_id: roleId,
      label: availableRoles.get(roleId),
    };
  }
  if (Object.keys(roleMap).length === 0) return;

  await persistRoleMap(orgId, row.config, roleMap);
  revalidatePath(PAGE);
}

export async function addRoleMapLevel(formData: FormData): Promise<void> {
  await requireCrmAdmin();
  const { orgId, row } = await getIntegrationRow();
  if (!row) return;

  const levelParsed = crmLevelKeySchema.safeParse(formData.get("new_level_name"));
  const roleId = String(formData.get("new_level_role") ?? "");
  const availableRoles = new Map(
    (row.config.available_roles ?? []).map((r) => [r.id, r.label] as const),
  );
  if (!levelParsed.success || !availableRoles.has(roleId)) return;
  if (levelParsed.data === "none") return;

  const roleMap = { ...(row.config.role_map ?? {}) };
  roleMap[levelParsed.data] = { twenty_role_id: roleId, label: availableRoles.get(roleId) };
  await persistRoleMap(orgId, row.config, roleMap);
  revalidatePath(PAGE);
}

export async function removeRoleMapLevel(formData: FormData): Promise<void> {
  await requireCrmAdmin();
  const { orgId, row } = await getIntegrationRow();
  if (!row) return;

  const levelParsed = crmLevelKeySchema.safeParse(formData.get("remove_level"));
  if (!levelParsed.success) return;
  const level = levelParsed.data;

  // A level that is still assigned to members must not disappear.
  const db = createServiceClient();
  const { count } = await db
    .from("member_app_permissions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("app_key", APP_KEY)
    .eq("level", level);
  if ((count ?? 0) > 0) return;

  const roleMap = { ...(row.config.role_map ?? {}) };
  delete roleMap[level];
  await persistRoleMap(orgId, row.config, roleMap);
  revalidatePath(PAGE);
}

export async function setCrmLevel(formData: FormData): Promise<void> {
  await requireCrmAdmin();
  const parsed = crmSetLevelSchema.safeParse({
    userId: formData.get("user_id"),
    level: formData.get("level"),
  });
  if (!parsed.success) return;
  const { userId, level } = parsed.data;

  const orgId = await requireOrgId();
  const serviceDb = createServiceClient();
  const { data: profile } = await serviceDb
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle<{ email: string | null }>();
  const email = profile?.email;
  if (!email) return;

  // Membership stays the precondition for any tool grant.
  const { data: membership } = await serviceDb
    .from("organization_members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return;

  const userDb = await createUserClient(); // writes go through is_org_admin RLS

  if (level === "none") {
    const { error } = await userDb
      .from("member_app_permissions")
      .update({ sync_status: "revoking", sync_error: null })
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("app_key", APP_KEY);
    if (error) throw error;
    await runTwentySync(orgId, "revoke", { user_id: userId, email });
  } else {
    const { row } = await getIntegrationRow();
    if (!row?.config.role_map?.[level]) return;
    const { error } = await userDb.from("member_app_permissions").upsert(
      {
        organization_id: orgId,
        user_id: userId,
        app_key: APP_KEY,
        level,
        sync_status: "pending",
        sync_error: null,
      },
      { onConflict: "organization_id,user_id,app_key" },
    );
    if (error) throw error;
    await runTwentySync(orgId, "grant", { user_id: userId, email, level });
  }
  revalidatePath(PAGE);
}

export async function reconcileCrm(): Promise<void> {
  await requireCrmAdmin();
  const orgId = await requireOrgId();
  await runTwentySync(orgId, "reconcile");
  revalidatePath(PAGE);
}
