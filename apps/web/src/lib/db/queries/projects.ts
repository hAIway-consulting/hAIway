import { createUserClient } from "../supabase-server";
import { requireOrgId } from "../org-context";

export type Project = {
  id: string;
  company_id: string | null;
  name: string;
  status: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_LIMIT = 200;

export async function listProjects(options?: { limit?: number }): Promise<Project[]> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("projects")
    .select("id, company_id, name, status, description, created_at, updated_at")
    .eq("organization_id", orgId)
    .order("name")
    .limit(options?.limit ?? DEFAULT_LIMIT);
  if (error) throw error;
  return data ?? [];
}
