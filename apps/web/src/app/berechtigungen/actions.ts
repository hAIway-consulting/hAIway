"use server";

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId, requireBeraterRole } from "@/lib/db/org-context";

// Reads stay open to every org member (RLS still scopes them to the active
// org). Writes are Berater-only — the RLS policies on permission_groups /
// permission_group_members / source_folders / source_folder_access enforce the
// same rule in the database; this guard exists so a regular member gets a
// clean rejection instead of a raw Postgres RLS error.

// ── Read ────────────────────────────────────────────────────────────────

export async function listPermissionGroups() {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("permission_groups")
    .select("id, name, description, provider_id, created_at")
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listSourceFolders() {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("source_folders")
    .select("id, name, description, external_path, provider_id, created_at")
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listGroupMembers(groupId: string) {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("permission_group_members")
    .select("id, user_id, added_at, profiles(full_name, email)")
    .eq("group_id", groupId)
    .eq("organization_id", orgId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    added_at: row.added_at as string,
    profiles: Array.isArray(row.profiles) ? row.profiles[0] ?? null : row.profiles,
  })) as Array<{
    id: string;
    user_id: string;
    added_at: string;
    profiles: { full_name: string | null; email: string | null } | null;
  }>;
}

export async function listFolderAccess(folderId: string) {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("source_folder_access")
    .select("id, group_id, permission_groups(name)")
    .eq("folder_id", folderId)
    .eq("organization_id", orgId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id as string,
    group_id: row.group_id as string,
    permission_groups: Array.isArray(row.permission_groups) ? row.permission_groups[0] ?? null : row.permission_groups,
  })) as Array<{
    id: string;
    group_id: string;
    permission_groups: { name: string } | null;
  }>;
}

export async function listOrgMembers() {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("organization_members")
    .select("user_id, role, profiles(full_name, email)")
    .eq("organization_id", orgId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    user_id: row.user_id as string,
    role: row.role as string,
    profiles: Array.isArray(row.profiles) ? row.profiles[0] ?? null : row.profiles,
  })) as Array<{
    user_id: string;
    role: string;
    profiles: { full_name: string | null; email: string | null } | null;
  }>;
}

export async function listSourcesInFolder(folderId: string) {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("sources")
    .select("id, title, source_type, status")
    .eq("organization_id", orgId)
    .eq("folder_id", folderId)
    .is("deleted_at", null)
    .order("title");
  if (error) throw error;
  return data ?? [];
}

export async function listUnassignedSources() {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("sources")
    .select("id, title, source_type, status")
    .eq("organization_id", orgId)
    .is("folder_id", null)
    .is("deleted_at", null)
    .order("title")
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

// ── Create ──────────────────────────────────────────────────────────────

export async function createPermissionGroup(name: string, description?: string) {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("permission_groups")
    .insert({ organization_id: orgId, name, description: description || null })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/berechtigungen");
  return data!.id as string;
}

export async function createSourceFolder(name: string, description?: string) {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("source_folders")
    .insert({ organization_id: orgId, name, description: description || null })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/berechtigungen");
  return data!.id as string;
}

export async function addGroupMember(groupId: string, userId: string) {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { error } = await db
    .from("permission_group_members")
    .insert({ group_id: groupId, user_id: userId, organization_id: orgId });
  if (error) throw error;
  revalidatePath("/berechtigungen");
}

export async function removeGroupMember(membershipId: string) {
  await requireBeraterRole();
  const db = await createUserClient();
  const { error } = await db
    .from("permission_group_members")
    .delete()
    .eq("id", membershipId);
  if (error) throw error;
  revalidatePath("/berechtigungen");
}

export async function grantFolderAccess(folderId: string, groupId: string) {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { error } = await db
    .from("source_folder_access")
    .insert({ folder_id: folderId, group_id: groupId, organization_id: orgId });
  if (error) throw error;
  revalidatePath("/berechtigungen");
}

export async function revokeFolderAccess(accessId: string) {
  await requireBeraterRole();
  const db = await createUserClient();
  const { error } = await db
    .from("source_folder_access")
    .delete()
    .eq("id", accessId);
  if (error) throw error;
  revalidatePath("/berechtigungen");
}

export async function assignSourceToFolder(sourceId: string, folderId: string | null) {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { error } = await db
    .from("sources")
    .update({ folder_id: folderId })
    .eq("id", sourceId)
    .eq("organization_id", orgId);
  if (error) throw error;
  revalidatePath("/berechtigungen");
}

export async function assignSourcesToFolder(sourceIds: string[], folderId: string) {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { error } = await db
    .from("sources")
    .update({ folder_id: folderId })
    .in("id", sourceIds)
    .eq("organization_id", orgId);
  if (error) throw error;
  revalidatePath("/berechtigungen");
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deletePermissionGroup(groupId: string) {
  await requireBeraterRole();
  const db = await createUserClient();
  const { error } = await db
    .from("permission_groups")
    .delete()
    .eq("id", groupId);
  if (error) throw error;
  revalidatePath("/berechtigungen");
}

export async function deleteSourceFolder(folderId: string) {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = await createUserClient();
  // Unassign all sources first (set folder_id to null)
  await db
    .from("sources")
    .update({ folder_id: null })
    .eq("folder_id", folderId)
    .eq("organization_id", orgId);
  // Delete the folder (cascades to source_folder_access)
  const { error } = await db
    .from("source_folders")
    .delete()
    .eq("id", folderId);
  if (error) throw error;
  revalidatePath("/berechtigungen");
}
