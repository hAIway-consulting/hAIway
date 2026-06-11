// Read helpers for agent_runs (spec-cockpit.md §13, berater spec §6).
// Run reads go through the user client so RLS scopes them to the caller's
// org; profile display names resolve via the service client because the
// profiles SELECT policy is self-only (the cockpit oversight pages sit
// behind the /admin Berater gate).

import { createServiceClient, createUserClient } from "@/lib/db/supabase-server";

export type AgentRunStatus =
  | "running"
  | "awaiting_confirmation"
  | "success"
  | "failed"
  | "cancelled";

export const AGENT_RUN_STATUSES: AgentRunStatus[] = [
  "running",
  "awaiting_confirmation",
  "success",
  "failed",
  "cancelled",
];

export interface AgentRun {
  id: string;
  saved_agent_id: string | null;
  triggered_by: string | null;
  model: string | null;
  status: AgentRunStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  tool_calls: unknown[];
  token_usage: Record<string, unknown> | null;
  error_message: string | null;
}

export interface AgentRunFilters {
  status?: AgentRunStatus;
  savedAgentId?: string;
}

/**
 * Latest agent runs of the org (newest first). Returns [] when the table
 * does not exist yet (foundation migration not pushed) — callers render the
 * pre-push empty state.
 */
export async function listAgentRuns(
  orgId: string,
  filters: AgentRunFilters = {},
  limit = 50,
): Promise<AgentRun[]> {
  try {
    const db = await createUserClient();
    let query = db
      .from("agent_runs")
      .select(
        "id, saved_agent_id, triggered_by, model, status, started_at, finished_at, duration_ms, tool_calls, token_usage, error_message",
      )
      .eq("organization_id", orgId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.savedAgentId) query = query.eq("saved_agent_id", filters.savedAgentId);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as AgentRun[];
  } catch {
    return [];
  }
}

/**
 * Resolve profile display names (full_name, email fallback) for the given
 * user ids. Berater-gated callers only.
 */
export async function resolveProfileNames(
  userIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  try {
    const db = createServiceClient();
    const { data } = await db.from("profiles").select("id, full_name, email").in("id", ids);
    const map = new Map<string, string>();
    for (const row of data ?? []) {
      const name = (row.full_name as string | null) || (row.email as string | null) || "—";
      map.set(row.id as string, name);
    }
    return map;
  } catch {
    return new Map();
  }
}
