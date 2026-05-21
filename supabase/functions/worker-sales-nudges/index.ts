// worker-sales-nudges
//
// Daily nudge worker. For each org with an active Pipedrive integration:
//   * find open ICP deals (commerce/hls/bauwesen) whose last_activity_at is
//     older than 14 days,
//   * skip deals that already have a hAIway nudge activity created in the
//     last 7 days (idempotency via subject prefix match),
//   * skip deals that the co-founder dismissed in /mein-vertrieb,
//   * create a Pipedrive Activity (type 'task', due today) on each match
//     and assign it to the deal's owner.
//
// Triggered via pg_cron `worker-sales-nudges-daily` (06:00 UTC).
// Manual invocation: POST { organization_id?, dry_run?: true }.

import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import { getPipedriveCredsForOrg, createActivity, PipedriveAuthError } from "../_shared/pipedrive.ts";

const STALE_DAYS = 14;
const NUDGE_TTL_DAYS = 7;
const NUDGE_SUBJECT_PREFIX = "Follow-up: Deal stalled (hAIway)";
const TARGET_ICPS = new Set(["commerce", "hls", "bauwesen"]);

interface StaleDealRow {
  deal_external_id:  string;
  title:             string | null;
  industry:          string;
  owner_external_id: string | null;
  org_external_id:   string | null;
  last_activity_at:  string | null;
  days_stale:        number;
}

interface ActivityRow {
  deal_external_id: string | null;
  subject:          string | null;
  add_time:         string | null;
}

interface DismissalRow {
  deal_external_id: string;
}

async function processOrg(
  orgId:    string,
  dryRun:   boolean,
): Promise<{ candidates: number; nudged: number; skipped: number; errors: number }> {
  const supabase = getServiceClient();

  const { data: rpcData, error: rpcErr } = await supabase
    .rpc("list_stale_pipedrive_deals", { p_org_id: orgId, p_days: STALE_DAYS });
  if (rpcErr) throw rpcErr;

  const stale = ((rpcData ?? []) as StaleDealRow[])
    .filter((d) => TARGET_ICPS.has(d.industry) && d.owner_external_id);

  if (stale.length === 0) return { candidates: 0, nudged: 0, skipped: 0, errors: 0 };

  const dealExternalIds = stale.map((d) => d.deal_external_id);

  const nudgeCutoff = new Date(Date.now() - NUDGE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentActs } = await supabase
    .from("entities_pipedrive_activities")
    .select("deal_external_id, subject, add_time")
    .eq("organization_id", orgId)
    .in("deal_external_id", dealExternalIds)
    .gte("add_time", nudgeCutoff);

  const recentNudgedDeals = new Set<string>();
  for (const a of (recentActs ?? []) as ActivityRow[]) {
    if (a.deal_external_id && a.subject?.startsWith(NUDGE_SUBJECT_PREFIX)) {
      recentNudgedDeals.add(a.deal_external_id);
    }
  }

  const { data: dismissals } = await supabase
    .from("nudge_dismissals")
    .select("deal_external_id")
    .eq("organization_id", orgId)
    .eq("source", "stale_deal")
    .in("deal_external_id", dealExternalIds);
  const dismissed = new Set((dismissals ?? []).map((d: DismissalRow) => d.deal_external_id));

  const candidates = stale.filter((d) =>
    !recentNudgedDeals.has(d.deal_external_id) && !dismissed.has(d.deal_external_id),
  );
  if (candidates.length === 0) return { candidates: 0, nudged: 0, skipped: stale.length, errors: 0 };

  if (dryRun) {
    return { candidates: candidates.length, nudged: 0, skipped: stale.length - candidates.length, errors: 0 };
  }

  const creds = await getPipedriveCredsForOrg(orgId);
  const today = new Date().toISOString().slice(0, 10);

  let nudged = 0;
  let errors = 0;
  for (const d of candidates) {
    const dealIdNum = Number(d.deal_external_id);
    const ownerIdNum = Number(d.owner_external_id);
    if (!Number.isFinite(dealIdNum) || !Number.isFinite(ownerIdNum)) {
      errors++;
      continue;
    }
    try {
      const subject = `${NUDGE_SUBJECT_PREFIX} — ${d.title ?? d.deal_external_id}`;
      const note = `Dieser Deal hat seit ${d.days_stale} Tagen keine Aktivität. ` +
        `Branche: ${d.industry}. ` +
        `Vorschlag: kurzer Call oder gezielte Mail, um den nächsten Schritt zu klären.`;
      await createActivity(creds, {
        deal_id:  dealIdNum,
        user_id:  ownerIdNum,
        type:     "task",
        subject,
        due_date: today,
        note,
      });
      nudged++;
    } catch (err) {
      console.error("[worker-sales-nudges]", d.deal_external_id, err);
      errors++;
    }
  }

  return { candidates: candidates.length, nudged, skipped: stale.length - candidates.length, errors };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  let body: { organization_id?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* fan-out mode */ }

  const supabase = getServiceClient();
  const orgIds: string[] = [];
  if (body.organization_id) {
    orgIds.push(body.organization_id);
  } else {
    const { data: rows } = await supabase
      .from("organization_integrations")
      .select("organization_id")
      .eq("provider_id", "pipedrive")
      .eq("status", "active");
    for (const r of (rows ?? []) as { organization_id: string }[]) orgIds.push(r.organization_id);
  }

  const dryRun = Boolean(body.dry_run);
  const results: Array<Record<string, unknown>> = [];
  for (const orgId of orgIds) {
    try {
      const out = await processOrg(orgId, dryRun);
      results.push({ organization_id: orgId, ...out });
    } catch (err) {
      if (err instanceof PipedriveAuthError) {
        await supabase
          .from("organization_integrations")
          .update({ status: "error", error_message: err.message })
          .eq("organization_id", orgId)
          .eq("provider_id", "pipedrive");
      }
      results.push({ organization_id: orgId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return jsonResponse({ runs: results });
});
