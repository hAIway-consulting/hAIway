"use server";

// Berater cockpit actions (spec-cockpit.md §9/§11, spec-berater-dashboard.md
// §4/§6): consultant oversight over the tenant's saved agents plus
// start/stop + KPI configuration for automations. `automations` has no
// client write policies — those writes go through the service role behind
// requireBeraterRole().

import { revalidatePath } from "next/cache";
import { createServiceClient, createUserClient, getUser } from "@/lib/db/supabase-server";
import { requireBeraterRole, requireOrgId } from "@/lib/db/org-context";

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
  revalidatePath("/admin/cockpit/agenten");
}

// ── Automations (berater spec §4) ───────────────────────────────────────
// Start/Stopp + KPI parameter live exclusively in the Berater-Cockpit; the
// customer only sees results. Every change appends { at, actor, change } to
// automations.config_history (append-only audit log).

interface ConfigHistoryEntry {
  at: string;
  actor: string | null;
  change: Record<string, unknown>;
}

async function updateAutomation(
  automationId: string,
  patch: Record<string, unknown>,
  change: Record<string, unknown>,
): Promise<void> {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const user = await getUser();

  const db = createServiceClient();
  const { data: row, error: readError } = await db
    .from("automations")
    .select("id, config_history")
    .eq("id", automationId)
    .eq("organization_id", orgId)
    .single();

  if (readError || !row) {
    throw new Error("Automatisierung nicht gefunden.");
  }

  const history = Array.isArray(row.config_history)
    ? (row.config_history as ConfigHistoryEntry[])
    : [];
  const entry: ConfigHistoryEntry = {
    at: new Date().toISOString(),
    actor: user?.id ?? null,
    change,
  };

  const { error } = await db
    .from("automations")
    .update({ ...patch, config_history: [...history, entry] })
    .eq("id", automationId)
    .eq("organization_id", orgId);

  if (error) {
    throw new Error("Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.");
  }

  revalidatePath("/admin/cockpit/automatisierungen");
  revalidatePath("/admin/cockpit/modelle");
}

/** Start/stop an automation (consultant switch, berater spec §4). */
export async function setAutomationStatus(
  automationId: string,
  status: "active" | "stopped",
): Promise<void> {
  if (!automationId) throw new Error("Automatisierungs-ID fehlt.");
  if (status !== "active" && status !== "stopped") {
    throw new Error("Ungültiger Status.");
  }
  await updateAutomation(automationId, { status }, { field: "status", to: status });
}

/** KPI-v1 parameter: minutes saved per successful run (0–600). */
export async function setMinutesSaved(automationId: string, minutes: number): Promise<void> {
  if (!automationId) throw new Error("Automatisierungs-ID fehlt.");
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 600) {
    throw new Error("Minuten pro Lauf müssen zwischen 0 und 600 liegen.");
  }
  await updateAutomation(
    automationId,
    { minutes_saved_per_run: minutes },
    { field: "minutes_saved_per_run", to: minutes },
  );
}

/** Form bridge for the inline "Min/Lauf" input (parses + validates). */
export async function setMinutesSavedForm(formData: FormData): Promise<void> {
  const automationId = String(formData.get("automation_id") ?? "");
  const minutes = Number(String(formData.get("minutes") ?? "").replace(",", "."));
  await setMinutesSaved(automationId, minutes);
}
