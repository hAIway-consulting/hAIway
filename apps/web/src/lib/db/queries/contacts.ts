import { createUserClient } from "../supabase-server";
import { requireOrgId } from "../org-context";

export type Contact = {
  id: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  role_title: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_LIMIT = 200;

export async function listContacts(options?: { limit?: number }): Promise<Contact[]> {
  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { data, error } = await db
    .from("contacts")
    .select("id, company_id, first_name, last_name, email, phone, role_title, status, notes, created_at, updated_at")
    .eq("organization_id", orgId)
    .order("last_name")
    .limit(options?.limit ?? DEFAULT_LIMIT);
  if (error) throw error;
  return data ?? [];
}
