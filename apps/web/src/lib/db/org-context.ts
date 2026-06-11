import { cache } from "react";
import { createUserClient, getUser } from "./supabase-server";

export type MemberRole = "member" | "admin" | "owner" | "manager" | "berater";

export const MEMBER_ROLES: MemberRole[] = ["member", "admin", "owner", "manager", "berater"];

/**
 * Roles that open the Berater persona (Cockpit + Outcome work) in the active
 * org. 'manager' and 'berater' exist only in the platform org; in customer
 * orgs the set stays admin/owner.
 */
export const BERATER_ROLES: MemberRole[] = ["admin", "owner", "manager", "berater"];

/** Roles that may manage the org itself (Stammdaten, Team, Rollen). */
export const ORG_MANAGER_ROLES: MemberRole[] = ["admin", "owner"];

/**
 * Returns the active organization ID for the current request.
 *
 * Resolution order:
 * 1. FIXED_ORG_ID env var (dedicated instance mode)
 * 2. User's default org from organization_members
 * 3. User's first org membership
 *
 * Wrapped with React cache() — resolved once per request.
 */
export const requireOrgId = cache(async (): Promise<string> => {
  // Dedicated instance: fixed org from env
  const fixedOrgId = process.env.FIXED_ORG_ID;
  if (fixedOrgId) return fixedOrgId;

  const user = await getUser();
  if (!user) throw new Error("Not authenticated");

  const supabase = await createUserClient();

  // Try default org first
  const { data: defaultMember } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .single();

  if (defaultMember) return defaultMember.organization_id;

  // Fallback: first org membership
  const { data: firstMember } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (firstMember) return firstMember.organization_id;

  throw new Error("User has no organization membership");
});

/**
 * Returns the current user's role in the given org (or active org if omitted).
 * Returns null if the user is not a member or not authenticated.
 */
export const getMemberRole = cache(async (orgId?: string): Promise<MemberRole | null> => {
  const user = await getUser();
  if (!user) return null;

  let targetOrgId = orgId;
  if (!targetOrgId) {
    try {
      targetOrgId = await requireOrgId();
    } catch {
      return null;
    }
  }

  const supabase = await createUserClient();
  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", targetOrgId)
    .single();

  if (!data) return null;
  const role = data.role as MemberRole;
  if (MEMBER_ROLES.includes(role)) return role;
  return null;
});

/**
 * Throws unless the current user has a Berater-capable role in the active org.
 * Used to gate the Berater-Cockpit (`/admin/*` route group).
 */
export async function requireBeraterRole(): Promise<MemberRole> {
  const role = await getMemberRole();
  if (!role || !BERATER_ROLES.includes(role)) {
    throw new Error("Forbidden: berater role required");
  }
  return role;
}
