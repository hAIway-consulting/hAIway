// CRM (Twenty) access resolution for nav + launch page.
//
// showLaunch: the current user may open the CRM (feature enabled AND they
//   have a member_app_permissions row for app_key 'crm' — read through the
//   user client, so RLS keeps it to their own row).
// showAdmin: the feature is enabled — which persona/nav-variant actually
//   renders the management link is decided in the nav components.

import { cache } from "react";
import { createServiceClient, createUserClient, getUser } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { hasFeature } from "@/lib/features/flags";

const APP_KEY = "crm";
const PROVIDER_ID = "twenty";

export interface CrmNavState {
  showLaunch: boolean;
  showAdmin: boolean;
}

export interface CrmAccess {
  level: string;
  syncStatus: string;
  inviteStatus: string | null;
  syncError: string | null;
  baseUrl: string | null;
}

export const getCrmNavState = cache(async (): Promise<CrmNavState> => {
  const enabled = await hasFeature("crm_workspace");
  if (!enabled) return { showLaunch: false, showAdmin: false };

  const user = await getUser();
  if (!user) return { showLaunch: false, showAdmin: false };

  try {
    const orgId = await requireOrgId();
    const db = await createUserClient();
    const { data } = await db
      .from("member_app_permissions")
      .select("level")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .eq("app_key", APP_KEY)
      .maybeSingle();
    return { showLaunch: !!data, showAdmin: true };
  } catch {
    return { showLaunch: false, showAdmin: true };
  }
});

/** Full access state for the /crm launch page. Null = no permission row. */
export const getCrmAccess = cache(async (): Promise<CrmAccess | null> => {
  const user = await getUser();
  if (!user) return null;
  const orgId = await requireOrgId();

  const db = await createUserClient();
  const { data: permission } = await db
    .from("member_app_permissions")
    .select("level, sync_status, external_invite_status, sync_error")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .eq("app_key", APP_KEY)
    .maybeSingle<{
      level: string;
      sync_status: string;
      external_invite_status: string | null;
      sync_error: string | null;
    }>();
  if (!permission) return null;

  // base_url only — credentials never leave the server-side read.
  const serviceDb = createServiceClient();
  const { data: integration } = await serviceDb
    .from("organization_integrations")
    .select("config")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .maybeSingle<{ config: { base_url?: string } }>();

  return {
    level: permission.level,
    syncStatus: permission.sync_status,
    inviteStatus: permission.external_invite_status,
    syncError: permission.sync_error,
    baseUrl: integration?.config?.base_url ?? null,
  };
});
