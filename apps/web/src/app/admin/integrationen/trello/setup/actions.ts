"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrgId, requireBeraterRole } from "@/lib/db/org-context";
import { createServiceClient } from "@/lib/db/supabase-server";

interface TrelloCredentials {
  token?:           string;
  board_id?:        string;
  default_list_id?: string;
}

// The wizard writes organization_integrations.credentials with the service
// client, which bypasses RLS and the column privileges. admin/layout.tsx gates
// the PAGE on the Berater roles, but a Server Action is reachable for every
// authenticated user — so the role check has to live here too.
async function patchTrelloCredentials(patch: Partial<TrelloCredentials>): Promise<void> {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = createServiceClient();
  const { data, error: readErr } = await db
    .from("organization_integrations")
    .select("credentials")
    .eq("organization_id", orgId)
    .eq("provider_id", "trello")
    .maybeSingle<{ credentials: TrelloCredentials }>();
  if (readErr) throw readErr;
  if (!data) throw new Error("trello integration not found — connect first");

  const next = { ...(data.credentials ?? {}), ...patch };
  const status = next.token && next.board_id && next.default_list_id ? "active" : "configuring";

  const { error } = await db
    .from("organization_integrations")
    .update({ credentials: next, status, error_message: null })
    .eq("organization_id", orgId)
    .eq("provider_id", "trello");
  if (error) throw error;
}

export async function saveBoardId(formData: FormData): Promise<void> {
  const boardId = String(formData.get("board_id") ?? "").trim();
  if (!boardId) throw new Error("board_id required");
  // Picking a different board invalidates the previously chosen list.
  await patchTrelloCredentials({ board_id: boardId, default_list_id: undefined });
  revalidatePath("/admin/integrationen/trello/setup");
  redirect("/admin/integrationen/trello/setup");
}

export async function saveDefaultListId(formData: FormData): Promise<void> {
  const listId = String(formData.get("list_id") ?? "").trim();
  if (!listId) throw new Error("list_id required");
  await patchTrelloCredentials({ default_list_id: listId });
  revalidatePath("/admin/integrationen");
  redirect("/admin/integrationen?connected=trello");
}

// Lets the user step back from the list picker to the board picker.
export async function clearBoardId(): Promise<void> {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = createServiceClient();
  const { data } = await db
    .from("organization_integrations")
    .select("credentials")
    .eq("organization_id", orgId)
    .eq("provider_id", "trello")
    .maybeSingle<{ credentials: TrelloCredentials }>();
  const next = { ...(data?.credentials ?? {}) };
  delete next.board_id;
  delete next.default_list_id;
  const { error } = await db
    .from("organization_integrations")
    .update({ credentials: next, status: "configuring" })
    .eq("organization_id", orgId)
    .eq("provider_id", "trello");
  if (error) throw error;
  revalidatePath("/admin/integrationen/trello/setup");
  redirect("/admin/integrationen/trello/setup");
}
