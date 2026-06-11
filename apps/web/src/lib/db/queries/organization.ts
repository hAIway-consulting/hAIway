import { createUserClient, getUser } from "../supabase-server";
import { requireOrgId } from "../org-context";

export type Organization = {
  id: string;
  slug: string;
  name: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type OrgBranding = {
  displayName: string;
  shortName: string;
  accentColor: string;
  accentColorHover: string;
  logoUrl: string | null;
};

const DEFAULT_BRANDING: OrgBranding = {
  displayName: "hAIway",
  shortName: "HA",
  accentColor: "#0d9488",
  accentColorHover: "#0f766e",
  logoUrl: "/brand/logo-tile.png",
};

export async function getOrganization(): Promise<Organization | null> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single();
  if (error) return null;
  return data;
}

export async function getOrgBranding(): Promise<OrgBranding> {
  const org = await getOrganization();
  if (!org) return DEFAULT_BRANDING;

  const branding = (org.metadata as any)?.branding;
  if (!branding) return DEFAULT_BRANDING;

  return {
    displayName: branding.display_name || DEFAULT_BRANDING.displayName,
    shortName: branding.short_name || DEFAULT_BRANDING.shortName,
    accentColor: branding.accent_color || DEFAULT_BRANDING.accentColor,
    accentColorHover: branding.accent_color_hover || DEFAULT_BRANDING.accentColorHover,
    logoUrl: branding.logo_url || null,
  };
}

/**
 * Platform admin = profiles.is_platform_admin flag OR owner/admin role in the
 * platform org. Mirrors the SQL function is_platform_admin() so role
 * assignment in the own org grants the full admin view without touching the
 * profile flag.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;

  const db = await createUserClient();
  const [{ data: profile }, { data: platformMembership }] = await Promise.all([
    db.from("profiles").select("is_platform_admin").eq("id", user.id).single(),
    db
      .from("organization_members")
      .select("role, organizations!inner(is_platform)")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .eq("organizations.is_platform", true)
      .limit(1)
      .maybeSingle(),
  ]);

  return profile?.is_platform_admin === true || platformMembership != null;
}
