// Orchestrator: Shopware complaint -> Trello card.
//
// The real trigger (incoming e-mail / customer message) is intentionally
// bypassed — the Berater runs this manually. It reads the most recent product
// + customer from Shopware, composes a complaint card, creates it on the
// tenant's Trello board, and records the whole run as an auditable "ticket"
// in workflow_runs (status + per-step trace + source/target refs).

import { createServiceClient } from "@/lib/db/supabase-server";
import { getShopwareConfig, getTrelloConfig } from "./credentials";
import { fetchRecentProducts, fetchRecentCustomers } from "./shopware";
import { createCard } from "./trello";

export const WORKFLOW_KEY = "shopware_complaint_to_trello";

type StepStatus = "success" | "failed" | "skipped";

interface Step {
  key:    string;
  label:  string;
  status: StepStatus;
  detail?: string;
}

export interface RunResult {
  runId:   string;
  status:  "success" | "failed";
  cardUrl?: string;
  error?:  string;
}

function customerName(c: { firstName: string | null; lastName: string | null; email: string }): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.email;
}

/**
 * Runs the complaint orchestrator once for the given org. Never throws on a
 * connector failure — a failed run is persisted as a `failed` workflow_runs
 * row so it surfaces in the Berater cockpit as "Handlungsbedarf".
 */
export async function runComplaintToTrello(
  orgId:     string,
  createdBy: string | null,
): Promise<RunResult> {
  const db = createServiceClient();
  const startedAt = Date.now();
  const steps: Step[] = [];

  // Open the ticket immediately so a long/crashing run is still visible.
  const { data: inserted, error: insertErr } = await db
    .from("workflow_runs")
    .insert({
      organization_id: orgId,
      workflow_key:    WORKFLOW_KEY,
      status:          "running",
      trigger:         "manual",
      created_by:      createdBy,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    throw new Error(`could not open workflow run: ${insertErr?.message ?? "no row"}`);
  }
  const runId = inserted.id as string;

  const finish = async (
    status:    "success" | "failed",
    extra:     { source_ref?: unknown; target_ref?: unknown; error_message?: string },
  ): Promise<void> => {
    await db
      .from("workflow_runs")
      .update({
        status,
        finished_at:  new Date().toISOString(),
        duration_ms:  Date.now() - startedAt,
        steps,
        source_ref:   extra.source_ref ?? null,
        target_ref:   extra.target_ref ?? null,
        error_message: extra.error_message ?? null,
      })
      .eq("id", runId);
  };

  try {
    // ── Step 1: load product + customer from Shopware ──────────────────────
    const shopware = await getShopwareConfig(orgId);
    const [products, customers] = await Promise.all([
      fetchRecentProducts(shopware, 1),
      fetchRecentCustomers(shopware, 1),
    ]);
    const product  = products[0];
    const customer = customers[0];
    if (!product)  throw new Error("Kein Produkt in Shopware gefunden");
    if (!customer) throw new Error("Kein Kunde in Shopware gefunden");

    const kunde = customerName(customer);
    steps.push({
      key:    "shopware_fetch",
      label:  "Shopware: Kunde + Produkt laden",
      status: "success",
      detail: `${kunde} · ${product.name ?? product.productNumber}`,
    });

    // ── Step 2: compose the complaint ──────────────────────────────────────
    const cardName = `Reklamation – ${product.name ?? product.productNumber} (${kunde})`;
    const desc = [
      "**Automatisch erstellte Reklamation** (Orchestrator-Test, Trigger übersprungen)",
      "",
      `**Kunde:** ${kunde}`,
      `**E-Mail:** ${customer.email}`,
      customer.customerNumber ? `**Kundennummer:** ${customer.customerNumber}` : null,
      "",
      `**Produkt:** ${product.name ?? "—"}`,
      `**Artikelnummer:** ${product.productNumber}`,
      "",
      "**Anliegen:** Der Kunde meldet einen Defekt am gelieferten Produkt und bittet um Prüfung.",
      "",
      "_Quelle: Shopware · Ziel: Trello · erstellt von der hAIway-Plattform._",
    ]
      .filter(Boolean)
      .join("\n");
    steps.push({
      key:    "compose",
      label:  "Reklamation aufbereiten",
      status: "success",
      detail: cardName,
    });

    const source_ref = {
      product_id:    product.id,
      product_name:  product.name,
      product_number: product.productNumber,
      customer_id:   customer.id,
      customer_name: kunde,
      customer_email: customer.email,
    };

    // ── Step 3: create the Trello card ─────────────────────────────────────
    const trello = await getTrelloConfig(orgId);
    const card = await createCard(trello, { name: cardName, desc });
    steps.push({
      key:    "trello_create",
      label:  "Trello: Karte erstellen",
      status: "success",
      detail: card.shortUrl || card.url,
    });

    await finish("success", {
      source_ref,
      target_ref: { card_id: card.id, url: card.shortUrl || card.url, name: card.name },
    });
    return { runId, status: "success", cardUrl: card.shortUrl || card.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Mark the first not-yet-recorded step as the failure point.
    steps.push({
      key:    `failed_${steps.length}`,
      label:  steps.length === 0 ? "Shopware: Kunde + Produkt laden" : "Trello: Karte erstellen",
      status: "failed",
      detail: message,
    });
    await finish("failed", { error_message: message });
    return { runId, status: "failed", error: message };
  }
}
