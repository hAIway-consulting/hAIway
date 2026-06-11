"use server";

import { revalidatePath } from "next/cache";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { getMemberRole, ORG_MANAGER_ROLES } from "@/lib/db/org-context";
import {
  getOrganizationAdmin,
  inviteUserToOrg,
  updateOrgMemberRole,
} from "@/lib/db/queries/admin";
import { roleOptionsFor } from "@/lib/org-roles";

/** Platform admin OR owner/admin of the given org may manage it. */
async function requireOrgManager(orgId: string) {
  const [admin, role] = await Promise.all([
    isPlatformAdmin().catch(() => false),
    getMemberRole(orgId).catch(() => null),
  ]);
  if (!admin && (!role || !ORG_MANAGER_ROLES.includes(role))) {
    throw new Error("Unauthorized");
  }
}

export async function changeMemberRole(orgId: string, memberId: string, formData: FormData) {
  await requireOrgManager(orgId);

  const role = (formData.get("role") as string)?.trim();
  const org = await getOrganizationAdmin(orgId);
  if (!org || !role) return;

  const allowed = roleOptionsFor(org.is_platform).map((r) => r.value);
  if (!allowed.includes(role)) return;

  const target = org.members.find((m) => m.id === memberId);
  if (!target || target.role === role) return;

  // Lockout-Schutz: mindestens ein Inhaber/Admin muss in der Org bleiben.
  const managesOrg = (r: string) => r === "owner" || r === "admin";
  if (managesOrg(target.role) && !managesOrg(role)) {
    const remaining = org.members.filter((m) => m.id !== memberId && managesOrg(m.role));
    if (remaining.length === 0) return;
  }

  await updateOrgMemberRole(orgId, memberId, role);
  revalidatePath("/organisation");
}

export async function inviteOrgMember(orgId: string, formData: FormData) {
  await requireOrgManager(orgId);

  const email = (formData.get("email") as string)?.trim();
  const role = (formData.get("role") as string)?.trim() || "member";
  if (!email) return;

  const org = await getOrganizationAdmin(orgId);
  if (!org) return;

  const allowed = roleOptionsFor(org.is_platform).map((r) => r.value);
  if (!allowed.includes(role)) return;

  await inviteUserToOrg(orgId, email, role);
  revalidatePath("/organisation");
}
