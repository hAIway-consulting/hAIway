// Dispatcher for the Twenty CRM sync engine.
//
// Real instances: POST to the connector-twenty edge function (business logic
// lives there, per repo rule "Business-Logik in Edge Functions").
//
// Mock instances (config.base_url = "mock://twenty", used by the claude-test
// sandbox org and e2e): the state transitions are simulated inline so local
// dev and Playwright runs need neither a Twenty instance nor a running edge
// runtime. The mock mirrors the edge function's DB side effects:
//   grant -> pending/invited · reconcile -> synced + empty drift · revoke -> row gone

import { createServiceClient } from "@/lib/db/supabase-server";

const PROVIDER_ID = "twenty";
const APP_KEY = "crm";

export type TwentySyncAction = "test-connection" | "grant" | "revoke" | "reconcile";

export interface TwentySyncParams {
  user_id?: string;
  email?: string;
  level?: string;
}

export interface TwentySyncResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

const MOCK_ROLES = [
  { id: "mock-role-admin", label: "Admin" },
  { id: "mock-role-member", label: "Member" },
];

export async function runTwentySync(
  orgId: string,
  action: TwentySyncAction,
  params: TwentySyncParams = {},
): Promise<TwentySyncResult> {
  const db = createServiceClient();
  const { data: integration } = await db
    .from("organization_integrations")
    .select("config")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .maybeSingle<{ config: { base_url?: string } }>();

  if (integration?.config?.base_url?.startsWith("mock://")) {
    return runMockSync(orgId, action, params);
  }

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/connector-twenty`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ organization_id: orgId, action, ...params }),
        cache: "no-store",
      },
    );
    return (await res.json()) as TwentySyncResult;
  } catch (err) {
    return {
      ok: false,
      error: `Sync-Engine nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function runMockSync(
  orgId: string,
  action: TwentySyncAction,
  params: TwentySyncParams,
): Promise<TwentySyncResult> {
  const db = createServiceClient();

  switch (action) {
    case "test-connection": {
      const { data: row } = await db
        .from("organization_integrations")
        .select("config")
        .eq("organization_id", orgId)
        .eq("provider_id", PROVIDER_ID)
        .maybeSingle<{ config: Record<string, unknown> }>();
      await db
        .from("organization_integrations")
        .update({
          status: "active",
          error_message: null,
          last_synced_at: new Date().toISOString(),
          config: {
            ...(row?.config ?? {}),
            available_roles: MOCK_ROLES,
            service_login_ok: true,
          },
        })
        .eq("organization_id", orgId)
        .eq("provider_id", PROVIDER_ID);
      return { ok: true, roles: MOCK_ROLES, serviceLoginOk: true };
    }

    case "grant": {
      if (!params.user_id) return { ok: false, error: "user_id required" };
      await db
        .from("member_app_permissions")
        .update({
          sync_status: "pending",
          external_member_id: null,
          external_invite_status: "invited",
          sync_error: null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("organization_id", orgId)
        .eq("user_id", params.user_id)
        .eq("app_key", APP_KEY);
      return { ok: true, state: "invited" };
    }

    case "revoke": {
      if (!params.user_id) return { ok: false, error: "user_id required" };
      await db
        .from("member_app_permissions")
        .delete()
        .eq("organization_id", orgId)
        .eq("user_id", params.user_id)
        .eq("app_key", APP_KEY);
      return { ok: true, state: "revoked" };
    }

    case "reconcile": {
      const { data: rows } = await db
        .from("member_app_permissions")
        .select("user_id")
        .eq("organization_id", orgId)
        .eq("app_key", APP_KEY);
      for (const permission of rows ?? []) {
        await db
          .from("member_app_permissions")
          .update({
            sync_status: "synced",
            external_member_id: `mock-member-${permission.user_id}`,
            external_invite_status: "accepted",
            sync_error: null,
            last_synced_at: new Date().toISOString(),
          })
          .eq("organization_id", orgId)
          .eq("user_id", permission.user_id)
          .eq("app_key", APP_KEY);
      }
      const drift = {
        checked_at: new Date().toISOString(),
        only_in_twenty: [],
        missing_in_twenty: [],
        role_mismatch: [],
      };
      const { data: row } = await db
        .from("organization_integrations")
        .select("config")
        .eq("organization_id", orgId)
        .eq("provider_id", PROVIDER_ID)
        .maybeSingle<{ config: Record<string, unknown> }>();
      await db
        .from("organization_integrations")
        .update({
          last_synced_at: new Date().toISOString(),
          config: { ...(row?.config ?? {}), last_drift: drift },
        })
        .eq("organization_id", orgId)
        .eq("provider_id", PROVIDER_ID);
      return { ok: true, drift, finalized: rows?.length ?? 0, rolesFixed: 0 };
    }
  }
}
