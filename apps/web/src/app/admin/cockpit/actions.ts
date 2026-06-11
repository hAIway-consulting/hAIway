"use server";

// Berater cockpit actions (spec-cockpit.md §9/§11): consultant oversight
// over the tenant's saved agents. UI follows in the Berater-dashboard PR —
// this ships the gated action only.

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireBeraterRole } from "@/lib/db/org-context";

/**
 * Enable/disable a saved agent. Double-gated: requireBeraterRole() in the
 * app layer plus the saved_agents UPDATE policy (owner or org admin) at the
 * DB boundary.
 */
export async function setSavedAgentStatus(
  agentId: string,
  status: "active" | "disabled",
): Promise<void> {
  if (!agentId) throw new Error("Agent-ID fehlt.");
  if (status !== "active" && status !== "disabled") {
    throw new Error("Ungültiger Status.");
  }

  await requireBeraterRole();

  const db = await createUserClient();
  const { error } = await db
    .from("saved_agents")
    .update({ status })
    .eq("id", agentId);

  if (error) {
    throw new Error("Der Status konnte nicht geändert werden. Bitte versuche es erneut.");
  }

  revalidatePath("/");
}
