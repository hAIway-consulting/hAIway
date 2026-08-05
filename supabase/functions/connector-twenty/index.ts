// connector-twenty
//
// Sync engine between hAIway member permissions and a self-hosted Twenty CRM
// workspace. hAIway is the source of truth: granting a CRM level invites the
// user into Twenty with the mapped role, revoking removes them, reconcile
// repairs drift and reports what cannot be repaired.
//
// Body: { organization_id, action, ...params }
//
//   action = "test-connection"  params: —
//   action = "grant"            params: { user_id, email, level }
//   action = "revoke"           params: { user_id, email }
//   action = "reconcile"        params: —
//
// Twenty downtime or auth degradation never fails the caller hard: per-row
// state lands in member_app_permissions.sync_status / sync_error and the
// response is 200 { ok: false, error } for action-level failures.

import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import {
  type TwentyConfig,
  TwentyAuthError,
  ping,
  listRoles,
  listWorkspaceMembers,
  listInvitations,
  sendInvitation,
  updateMemberRole,
  removeMember,
  deleteInvitation,
  getServiceAccessToken,
} from "../_shared/twenty.ts";

const PROVIDER_ID = "twenty";
const APP_KEY = "crm";

interface RoleMapEntry {
  twenty_role_id: string;
  label?: string;
}

interface TwentyIntegrationRow {
  status: string;
  credentials: { api_key?: string; service_email?: string; service_password?: string };
  config: {
    base_url?: string;
    role_map?: Record<string, RoleMapEntry>;
    [key: string]: unknown;
  };
}

async function getIntegration(orgId: string): Promise<TwentyIntegrationRow> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("organization_integrations")
    .select("status, credentials, config")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .maybeSingle<TwentyIntegrationRow>();
  if (error) throw error;
  if (!data) throw new Error("twenty integration not configured for this org");
  if (data.status === "disabled") throw new Error("twenty integration is disabled");
  return data;
}

function toClientConfig(row: TwentyIntegrationRow): TwentyConfig {
  const baseUrl = row.config?.base_url;
  const apiKey = row.credentials?.api_key;
  if (!baseUrl || !apiKey) throw new Error("twenty integration missing base_url or api_key");
  return {
    baseUrl,
    apiKey,
    serviceEmail: row.credentials?.service_email || undefined,
    servicePassword: row.credentials?.service_password || undefined,
  };
}

type PermissionPatch = {
  sync_status?: string;
  external_member_id?: string | null;
  external_invite_status?: string | null;
  sync_error?: string | null;
  last_synced_at?: string;
};

async function patchPermissionRow(orgId: string, userId: string, patch: PermissionPatch) {
  const db = getServiceClient();
  const { error } = await db
    .from("member_app_permissions")
    .update({ ...patch, last_synced_at: patch.last_synced_at ?? new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("app_key", APP_KEY);
  if (error) throw error;
}

async function deletePermissionRow(orgId: string, userId: string) {
  const db = getServiceClient();
  const { error } = await db
    .from("member_app_permissions")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("app_key", APP_KEY);
  if (error) throw error;
}

async function mergeIntegrationConfig(orgId: string, patch: Record<string, unknown>, status?: string, errorMessage?: string | null) {
  const db = getServiceClient();
  const row = await getIntegration(orgId);
  const update: Record<string, unknown> = {
    config: { ...row.config, ...patch },
    last_synced_at: new Date().toISOString(),
  };
  if (status) update.status = status;
  if (errorMessage !== undefined) update.error_message = errorMessage;
  const { error } = await db
    .from("organization_integrations")
    .update(update)
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID);
  if (error) throw error;
}

function isAuthDegradation(err: unknown): err is TwentyAuthError {
  return err instanceof TwentyAuthError;
}

// --- actions -----------------------------------------------------------------

async function actionTestConnection(orgId: string) {
  const row = await getIntegration(orgId);
  const cfg = toClientConfig(row);
  try {
    await ping(cfg);
    const roles = await listRoles(cfg);
    let serviceLoginOk = false;
    let serviceLoginError: string | null = null;
    if (cfg.serviceEmail && cfg.servicePassword) {
      try {
        await getServiceAccessToken(cfg);
        serviceLoginOk = true;
      } catch (err) {
        serviceLoginError = err instanceof Error ? err.message : String(err);
      }
    }
    await mergeIntegrationConfig(
      orgId,
      {
        available_roles: roles.map((r) => ({ id: r.id, label: r.label })),
        service_login_ok: serviceLoginOk,
      },
      "active",
      serviceLoginError,
    );
    return jsonResponse({ ok: true, roles: roles.map((r) => ({ id: r.id, label: r.label })), serviceLoginOk });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await mergeIntegrationConfig(orgId, {}, "error", message).catch(() => {});
    return jsonResponse({ ok: false, error: message });
  }
}

async function actionGrant(orgId: string, userId: string, email: string, level: string) {
  const row = await getIntegration(orgId);
  const cfg = toClientConfig(row);
  const roleEntry = row.config?.role_map?.[level];
  if (!roleEntry?.twenty_role_id) {
    await patchPermissionRow(orgId, userId, {
      sync_status: "error",
      sync_error: `Level "${level}" hat keine Twenty-Rolle im Mapping`,
    });
    return jsonResponse({ ok: false, error: `no role mapping for level "${level}"` });
  }

  const emailLc = email.toLowerCase();
  try {
    const members = await listWorkspaceMembers(cfg);
    const member = members.find((m) => m.userEmail?.toLowerCase() === emailLc);
    if (member) {
      await updateMemberRole(cfg, member.id, roleEntry.twenty_role_id);
      await patchPermissionRow(orgId, userId, {
        sync_status: "synced",
        external_member_id: member.id,
        external_invite_status: "accepted",
        sync_error: null,
      });
      return jsonResponse({ ok: true, state: "synced" });
    }

    const pending = (await listInvitations(cfg)).some((i) => i.email.toLowerCase() === emailLc);
    if (!pending) await sendInvitation(cfg, emailLc, roleEntry.twenty_role_id);
    await patchPermissionRow(orgId, userId, {
      sync_status: "pending",
      external_member_id: null,
      external_invite_status: "invited",
      sync_error: null,
    });
    return jsonResponse({ ok: true, state: "invited" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patchPermissionRow(orgId, userId, {
      sync_status: isAuthDegradation(err) ? "manual_required" : "error",
      external_invite_status: isAuthDegradation(err) ? "manual" : undefined,
      sync_error: message,
    }).catch(() => {});
    return jsonResponse({ ok: false, error: message });
  }
}

async function actionRevoke(orgId: string, userId: string, email: string) {
  const row = await getIntegration(orgId);
  const cfg = toClientConfig(row);
  const db = getServiceClient();
  const { data: permission } = await db
    .from("member_app_permissions")
    .select("external_member_id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("app_key", APP_KEY)
    .maybeSingle<{ external_member_id: string | null }>();

  const emailLc = email.toLowerCase();
  try {
    if (permission?.external_member_id) {
      await removeMember(cfg, permission.external_member_id);
    } else {
      const invitation = (await listInvitations(cfg)).find(
        (i) => i.email.toLowerCase() === emailLc,
      );
      if (invitation) await deleteInvitation(cfg, invitation.id);
    }
    await deletePermissionRow(orgId, userId);
    return jsonResponse({ ok: true, state: "revoked" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patchPermissionRow(orgId, userId, {
      sync_status: isAuthDegradation(err) ? "manual_required" : "error",
      sync_error: `Entzug fehlgeschlagen: ${message}`,
    }).catch(() => {});
    return jsonResponse({ ok: false, error: message });
  }
}

async function actionReconcile(orgId: string) {
  const row = await getIntegration(orgId);
  const cfg = toClientConfig(row);
  const roleMap = row.config?.role_map ?? {};
  const db = getServiceClient();

  const { data: permissionRows, error: permError } = await db
    .from("member_app_permissions")
    .select("user_id, level, sync_status, external_member_id, profiles:user_id (email)")
    .eq("organization_id", orgId)
    .eq("app_key", APP_KEY);
  if (permError) throw permError;

  type PermRow = {
    user_id: string;
    level: string;
    sync_status: string;
    external_member_id: string | null;
    profiles: { email: string | null } | null;
  };
  const rows = (permissionRows ?? []) as unknown as PermRow[];

  try {
    const [members, roles, invitations] = await Promise.all([
      listWorkspaceMembers(cfg),
      listRoles(cfg),
      listInvitations(cfg),
    ]);
    const membersByEmail = new Map(members.map((m) => [m.userEmail?.toLowerCase(), m] as const));
    const roleByMemberId = new Map<string, string>();
    for (const role of roles) for (const mid of role.memberIds) roleByMemberId.set(mid, role.id);
    const invitedEmails = new Set(invitations.map((i) => i.email.toLowerCase()));
    const grantedEmails = new Set<string>();

    const drift = {
      checked_at: new Date().toISOString(),
      only_in_twenty: [] as Array<{ email: string; workspace_member_id: string }>,
      missing_in_twenty: [] as Array<{ email: string; level: string }>,
      role_mismatch: [] as Array<{ email: string; expected_role_id: string; actual_role_id: string | null }>,
    };
    let finalized = 0;
    let rolesFixed = 0;

    for (const permission of rows) {
      const email = permission.profiles?.email?.toLowerCase();
      if (!email) continue;
      grantedEmails.add(email);
      const expectedRoleId = roleMap[permission.level]?.twenty_role_id ?? null;
      const member = membersByEmail.get(email);

      if (member) {
        const actualRoleId = roleByMemberId.get(member.id) ?? null;
        if (expectedRoleId && actualRoleId !== expectedRoleId) {
          try {
            await updateMemberRole(cfg, member.id, expectedRoleId);
            rolesFixed++;
          } catch (err) {
            drift.role_mismatch.push({
              email,
              expected_role_id: expectedRoleId,
              actual_role_id: actualRoleId,
            });
            if (!isAuthDegradation(err)) throw err;
          }
        }
        if (permission.sync_status !== "synced" || permission.external_member_id !== member.id) {
          await patchPermissionRow(orgId, permission.user_id, {
            sync_status: "synced",
            external_member_id: member.id,
            external_invite_status: "accepted",
            sync_error: null,
          });
          finalized++;
        } else {
          await patchPermissionRow(orgId, permission.user_id, {});
        }
      } else if (invitedEmails.has(email)) {
        await patchPermissionRow(orgId, permission.user_id, {
          sync_status: "pending",
          external_member_id: null,
          external_invite_status: "invited",
          sync_error: null,
        });
      } else {
        drift.missing_in_twenty.push({ email, level: permission.level });
        await patchPermissionRow(orgId, permission.user_id, {
          sync_status: permission.sync_status === "manual_required" ? "manual_required" : "pending",
          external_member_id: null,
          sync_error: "In Twenty weder Mitglied noch eingeladen",
        });
      }
    }

    const serviceEmailLc = cfg.serviceEmail?.toLowerCase();
    for (const member of members) {
      const email = member.userEmail?.toLowerCase();
      if (!email || grantedEmails.has(email) || email === serviceEmailLc) continue;
      drift.only_in_twenty.push({ email, workspace_member_id: member.id });
    }

    await mergeIntegrationConfig(orgId, { last_drift: drift }, "active", null);
    return jsonResponse({
      ok: true,
      drift,
      finalized,
      rolesFixed,
      members: members.length,
      pendingInvitations: invitations.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await mergeIntegrationConfig(orgId, {}, "error", message).catch(() => {});
    return jsonResponse({ ok: false, error: message });
  }
}

// --- entrypoint --------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: {
    organization_id?: string;
    action?: string;
    user_id?: string;
    email?: string;
    level?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON", 400);
  }

  if (!body.organization_id || !body.action) {
    return errorResponse("organization_id and action required", 400);
  }

  try {
    switch (body.action) {
      case "test-connection":
        return await actionTestConnection(body.organization_id);
      case "grant": {
        if (!body.user_id || !body.email || !body.level) {
          return errorResponse("user_id, email and level required", 400);
        }
        return await actionGrant(body.organization_id, body.user_id, body.email, body.level);
      }
      case "revoke": {
        if (!body.user_id || !body.email) {
          return errorResponse("user_id and email required", 400);
        }
        return await actionRevoke(body.organization_id, body.user_id, body.email);
      }
      case "reconcile":
        return await actionReconcile(body.organization_id);
      default:
        return errorResponse(`unknown action: ${body.action}`, 400);
    }
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 500);
  }
});
