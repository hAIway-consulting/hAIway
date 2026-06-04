"use server";

import { revalidatePath } from "next/cache";
import { requireOrgId, requireBeraterRole } from "@/lib/db/org-context";
import { getUser, createServiceClient } from "@/lib/db/supabase-server";
import { runComplaintToTrello, WORKFLOW_KEY } from "@/lib/orchestrator/run-complaint";

function revalidate(): void {
  revalidatePath("/admin/automatisierungen");
  revalidatePath("/");
}

/**
 * Manual trigger for the Shopware -> Trello complaint orchestrator. Replaces
 * the (intentionally bypassed) e-mail/message trigger. A failed run is still
 * recorded as a workflow_runs row, so it never throws on a connector error.
 */
export async function runComplaintOrchestrator(): Promise<void> {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const user = await getUser();
  await runComplaintToTrello(orgId, user?.id ?? null);
  revalidate();
}

/**
 * Seeds clearly-marked simulated tickets so the cockpit KPIs/alert render like
 * a live operation (e.g. "99/100") without spamming the real Trello board.
 */
export async function seedDemoTickets(): Promise<void> {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const user = await getUser();
  const db = createServiceClient();

  const TOTAL  = 100;
  const FAILED = 1; // index 0 fails -> "Handlungsbedarf"
  const now = Date.now();

  const rows = Array.from({ length: TOTAL }, (_, i) => {
    const isFailed = i < FAILED;
    // stagger over the last ~5 days, newest first
    const startedAt = new Date(now - i * 72 * 60 * 1000);
    const durationMs = 1800 + (i % 7) * 240;
    const customer = `Demo-Kunde ${String(TOTAL - i).padStart(3, "0")}`;
    const product  = `Demo-Produkt ${(i % 12) + 1}`;
    const steps = isFailed
      ? [
          { key: "shopware_fetch", label: "Shopware: Kunde + Produkt laden", status: "success", detail: `${customer} · ${product}` },
          { key: "compose",        label: "Reklamation aufbereiten",          status: "success" },
          { key: "trello_create",  label: "Trello: Karte erstellen",          status: "failed",  detail: "Trello API: 429 rate limit (Demo)" },
        ]
      : [
          { key: "shopware_fetch", label: "Shopware: Kunde + Produkt laden", status: "success", detail: `${customer} · ${product}` },
          { key: "compose",        label: "Reklamation aufbereiten",          status: "success" },
          { key: "trello_create",  label: "Trello: Karte erstellen",          status: "success", detail: "https://trello.com/c/demo" },
        ];
    return {
      organization_id: orgId,
      workflow_key:    WORKFLOW_KEY,
      status:          isFailed ? "failed" : "success",
      trigger:         "simulated" as const,
      started_at:      startedAt.toISOString(),
      finished_at:     new Date(startedAt.getTime() + durationMs).toISOString(),
      duration_ms:     durationMs,
      steps,
      source_ref:      { customer_name: customer, product_name: product, demo: true },
      target_ref:      isFailed ? null : { url: "https://trello.com/c/demo", name: `Reklamation – ${product} (${customer})` },
      error_message:   isFailed ? "Trello API: 429 rate limit (Demo)" : null,
      created_by:      user?.id ?? null,
    };
  });

  const { error } = await db.from("workflow_runs").insert(rows);
  if (error) throw error;
  revalidate();
}

/** Removes all simulated demo tickets (keeps real runs). */
export async function clearDemoTickets(): Promise<void> {
  await requireBeraterRole();
  const orgId = await requireOrgId();
  const db = createServiceClient();
  const { error } = await db
    .from("workflow_runs")
    .delete()
    .eq("organization_id", orgId)
    .eq("trigger", "simulated");
  if (error) throw error;
  revalidate();
}
