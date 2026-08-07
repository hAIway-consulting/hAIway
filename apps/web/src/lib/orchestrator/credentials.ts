// Reads per-org connector credentials for the Trello tools (service-role,
// bypasses RLS — same pattern as saveTrelloToken in app/quellen/actions.ts).
// Secrets never reach the client; this runs only in server actions.

import { createServiceClient } from "@/lib/db/supabase-server";
import type { TrelloConfig } from "./trello";

async function readCredentials(
  orgId:      string,
  providerId: string,
): Promise<Record<string, unknown>> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("organization_integrations")
    .select("credentials")
    .eq("organization_id", orgId)
    .eq("provider_id", providerId)
    .eq("status", "active")
    .maybeSingle<{ credentials: Record<string, unknown> }>();
  if (error) throw error;
  if (!data?.credentials) {
    throw new Error(`${providerId} integration not active for this org`);
  }
  return data.credentials;
}

export async function getTrelloConfig(orgId: string): Promise<TrelloConfig> {
  const c = await readCredentials(orgId, "trello");
  const token           = c.token           as string | undefined;
  const board_id        = c.board_id        as string | undefined;
  const default_list_id = c.default_list_id as string | undefined;
  if (!token || !board_id) {
    throw new Error("trello integration not configured (token/board_id missing — finish the setup wizard)");
  }
  // api_key is platform-wide (registered at trello.com/app-key); the per-tenant
  // token is bound to it through the 1-click grant.
  const api_key = process.env.TRELLO_API_KEY;
  if (!api_key) throw new Error("TRELLO_API_KEY env var not set on the platform");
  return { api_key, token, board_id, default_list_id };
}
