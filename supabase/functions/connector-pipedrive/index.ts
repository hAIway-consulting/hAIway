// connector-pipedrive
//
// Pipedrive ingest. Pulls organizations, persons, deals, activities,
// pipelines and stages via the REST v1 API. Wraps everything in the
// shared runSync() lifecycle so observability + dead-lettering match
// the existing connectors (google_drive, sharepoint, google_calendar).
//
// Sync modes:
//   - action=sync     manual / single-org. Body: { organization_id, since? }
//   - action=cron     iterate all orgs whose pipedrive integration is active
//
// Incremental: each entity carries its own cursor in
// organization_integrations.config.cursors.<entity>. We fall back to a full
// snapshot only when no cursor exists yet (first sync).

import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import { runSync, SyncRecord } from "../_shared/worker.ts";
import {
  getPipedriveCredsForOrg,
  listOrganizations,
  listPersons,
  listDeals,
  listActivities,
  listPipelines,
  listStages,
  PipedriveAuthError,
  PipedriveEntity,
} from "../_shared/pipedrive.ts";

const PROVIDER_ID = "pipedrive";

class SyncLockedError extends Error {
  constructor() { super("sync already running for this integration"); this.name = "SyncLockedError"; }
}

async function withSyncLock<T>(orgId: string, owner: string, fn: () => Promise<T>): Promise<T> {
  const supabase = getServiceClient();
  const { data: acquired, error } = await supabase.rpc("try_acquire_sync_lock", {
    p_org_id:      orgId,
    p_provider_id: PROVIDER_ID,
    p_owner:       owner,
  });
  if (error) throw error;
  if (!acquired) throw new SyncLockedError();
  try {
    return await fn();
  } finally {
    try {
      await supabase.rpc("release_sync_lock", { p_org_id: orgId, p_provider_id: PROVIDER_ID });
    } catch (e) {
      console.error("[connector-pipedrive] release_sync_lock failed", e);
    }
  }
}

interface Cursors {
  organizations?: string;
  persons?:       string;
  deals?:         string;
  activities?:    string;
}

async function readCursors(orgId: string): Promise<Cursors> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("organization_integrations")
    .select("config")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .maybeSingle<{ config: { cursors?: Cursors } }>();
  return data?.config?.cursors ?? {};
}

async function writeCursors(orgId: string, next: Cursors): Promise<void> {
  const supabase = getServiceClient();
  // Read-modify-write to avoid clobbering other config keys (e.g. company_domain).
  const { data: row } = await supabase
    .from("organization_integrations")
    .select("config")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .maybeSingle<{ config: Record<string, unknown> }>();
  const merged = { ...(row?.config ?? {}), cursors: { ...((row?.config?.cursors as Cursors) ?? {}), ...next } };
  await supabase
    .from("organization_integrations")
    .update({ config: merged, last_synced_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID);
}

function maxUpdateTime(rows: PipedriveEntity[]): string | undefined {
  let max: string | undefined;
  for (const r of rows) {
    const t = (r.update_time as string | undefined) ?? (r.add_time as string | undefined);
    if (t && (!max || t > max)) max = t;
  }
  return max;
}

function asRecord(entityType: string, rows: PipedriveEntity[]): SyncRecord[] {
  return rows
    .filter((r) => typeof r.id !== "undefined" && r.id !== null)
    .map((r) => ({
      external_id: String(r.id),
      entity_type: `pipedrive:${entityType}`,
      payload:     r,
    }));
}

async function syncOrg(orgId: string, trigger: "manual" | "cron" = "cron") {
  return await withSyncLock(orgId, `sync:${trigger}`, async () => {
    const creds = await getPipedriveCredsForOrg(orgId);
    const cursors = await readCursors(orgId);

    const result = await runSync({
      organizationId: orgId,
      providerId:     PROVIDER_ID,
      trigger,
      // ~80 req/min → ~1.33 / sec, burst 80.
      rateLimit: { capacity: 80, refillPerSec: 1.33 },
      syncFn: async () => {
        const records: SyncRecord[] = [];

        // Pipelines + stages — always full (small, slow-changing).
        const pipelines = await listPipelines(creds);
        const stages    = await listStages(creds);
        records.push(...asRecord("pipeline", pipelines));
        records.push(...asRecord("stage",    stages));

        // Organizations
        const orgs = await listOrganizations(creds, cursors.organizations);
        records.push(...asRecord("organization", orgs));
        const orgsMax = maxUpdateTime(orgs);

        // Persons
        const persons = await listPersons(creds, cursors.persons);
        records.push(...asRecord("person", persons));
        const personsMax = maxUpdateTime(persons);

        // Deals
        const deals = await listDeals(creds, cursors.deals);
        records.push(...asRecord("deal", deals));
        const dealsMax = maxUpdateTime(deals);

        // Activities
        const acts = await listActivities(creds, cursors.activities);
        records.push(...asRecord("activity", acts));
        const actsMax = maxUpdateTime(acts);

        await writeCursors(orgId, {
          organizations: orgsMax    ?? cursors.organizations,
          persons:       personsMax ?? cursors.persons,
          deals:         dealsMax   ?? cursors.deals,
          activities:    actsMax    ?? cursors.activities,
        });

        return records;
      },
    });

    return result;
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: { action?: string; organization_id?: string; trigger?: "manual" | "cron" };
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action ?? "sync";

  const supabase = getServiceClient();

  if (action === "sync" && body.organization_id) {
    try {
      const result = await syncOrg(body.organization_id, body.trigger ?? "manual");
      return jsonResponse(result);
    } catch (err) {
      if (err instanceof SyncLockedError) {
        return jsonResponse({ skipped: "sync already running" }, 409);
      }
      if (err instanceof PipedriveAuthError) {
        await supabase
          .from("organization_integrations")
          .update({ status: "error", error_message: err.message })
          .eq("organization_id", body.organization_id)
          .eq("provider_id", PROVIDER_ID);
        return jsonResponse({ error: err.message }, 401);
      }
      return errorResponse(err instanceof Error ? err.message : String(err), 500);
    }
  }

  // action=cron: iterate active integrations
  const { data: rows } = await supabase
    .from("organization_integrations")
    .select("organization_id")
    .eq("provider_id", PROVIDER_ID)
    .eq("status", "active");

  const results: unknown[] = [];
  for (const r of (rows ?? []) as { organization_id: string }[]) {
    try {
      results.push(await syncOrg(r.organization_id, "cron"));
    } catch (err) {
      if (err instanceof SyncLockedError) {
        results.push({ organization_id: r.organization_id, skipped: "sync already running" });
      } else if (err instanceof PipedriveAuthError) {
        await supabase
          .from("organization_integrations")
          .update({ status: "error", error_message: err.message })
          .eq("organization_id", r.organization_id)
          .eq("provider_id", PROVIDER_ID);
        results.push({ organization_id: r.organization_id, error: err.message });
      } else {
        results.push({ organization_id: r.organization_id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return jsonResponse({ runs: results });
});
