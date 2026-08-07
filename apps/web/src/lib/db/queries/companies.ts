import { createUserClient } from "../supabase-server";
import { requireOrgId } from "../org-context";

export type Company = {
  id: string;
  name: string;
  website: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_LIMIT = 200;

export async function listCompanies(options?: { limit?: number }): Promise<Company[]> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("companies")
    .select("id, name, website, status, notes, created_at, updated_at")
    .eq("organization_id", orgId)
    .order("name")
    .limit(options?.limit ?? DEFAULT_LIMIT);
  if (error) throw error;
  return data ?? [];
}
