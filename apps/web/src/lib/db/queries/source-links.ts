import { createUserClient } from "../supabase-server";

export type SourceLink = {
  id: string;
  source_id: string;
  linked_type: string;
  linked_id: string;
  link_role: string;
  created_at: string;
  linked_name: string;
};

export async function listLinksForSource(sourceId: string): Promise<SourceLink[]> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("get_source_links_resolved", {
    p_source_id: sourceId,
  });
  if (error) throw error;
  return (data ?? []) as SourceLink[];
}
