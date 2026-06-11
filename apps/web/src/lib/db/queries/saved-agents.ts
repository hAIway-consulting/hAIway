// Saved agents (spec-cockpit.md §9): customer-created, click-triggered
// agents. Reads go through the user client — RLS scopes visibility
// (org-wide + own private + Berater oversight).

import { createUserClient } from "@/lib/db/supabase-server";

export type SavedAgentAccent = "teal" | "amber" | "violet" | "rose" | "sky";
export type SavedAgentIcon = "draft" | "briefing" | "mail" | "summary";

export interface SavedAgent {
  id: string;
  name: string;
  description: string;
  prompt: string;
  visibility: "private" | "org";
  status: "active" | "disabled";
  createdBy: string | null;
  ui: { accent?: SavedAgentAccent; icon?: SavedAgentIcon };
}

interface SavedAgentRow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  visibility: "private" | "org";
  status: "active" | "disabled";
  created_by: string | null;
  ui: Record<string, unknown> | null;
}

function mapRow(row: SavedAgentRow): SavedAgent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    visibility: row.visibility,
    status: row.status,
    createdBy: row.created_by,
    ui: (row.ui ?? {}) as SavedAgent["ui"],
  };
}

/**
 * Active agents visible to the current user (RLS-scoped). Returns [] when
 * the table does not exist yet (foundation migration not pushed) — callers
 * decide on a fallback.
 */
export async function listVisibleSavedAgents(orgId: string): Promise<SavedAgent[]> {
  try {
    const db = await createUserClient();
    const { data, error } = await db
      .from("saved_agents")
      .select("id, name, description, prompt, visibility, status, created_by, ui")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as SavedAgentRow[]).map(mapRow);
  } catch {
    return [];
  }
}
