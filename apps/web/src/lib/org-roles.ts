/**
 * Role options per org type. The same column (organization_members.role)
 * carries different semantics depending on organizations.is_platform:
 *
 * Platform org (own company): owner/admin → full platform view,
 * manager → Berater persona incl. Verwaltung, berater → Berater-Arbeitsbereich.
 * Customer org: unchanged — admin is the hAIway Berater for that org.
 */
export type RoleOption = { value: string; label: string };

export const PLATFORM_ORG_ROLES: RoleOption[] = [
  { value: "owner", label: "Inhaber" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "berater", label: "Berater" },
  { value: "member", label: "Mitglied" },
];

export const CUSTOMER_ORG_ROLES: RoleOption[] = [
  { value: "owner", label: "Inhaber" },
  { value: "admin", label: "Berater" },
  { value: "member", label: "Mitglied" },
];

export function roleOptionsFor(isPlatform: boolean): RoleOption[] {
  return isPlatform ? PLATFORM_ORG_ROLES : CUSTOMER_ORG_ROLES;
}

export function roleLabel(role: string, isPlatform: boolean): string {
  return roleOptionsFor(isPlatform).find((r) => r.value === role)?.label ?? role;
}
