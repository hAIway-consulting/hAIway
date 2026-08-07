// connector-gdrive
//
// Google Drive ingest via Drive Changes API.

import {
  getServiceClient,
  jsonResponse,
  errorResponse,
  requireServiceRole,
} from "../_shared/supabase.ts";
import { runSync, SyncRecord } from "../_shared/worker.ts";
import {
  refreshGoogleAccessToken,
  listDriveChanges,
  downloadDriveFileText,
  listAllDriveFileIds,
} from "../_shared/google-drive.ts";

const PROVIDER_ID = "google_drive";

interface IntegrationRow {
  organization_id: string;
  credentials: { refresh_token?: string; access_token?: string; token_expires_at?: string };
  config: Record<string, unknown> & { page_token?: string };
}

async function getValidAccessToken(row: IntegrationRow): Promise<string> {
  const c = row.credentials ?? {};
  if (c.access_token && c.token_expires_at) {
    if (Date.parse(c.token_expires_at) - Date.now() > 60_000) return c.access_token;
  }
  if (!c.refresh_token) throw new Error("google_drive integration has no refresh_token");

  const supabase = getServiceClient();
  let refreshed: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
  try {
    refreshed = await refreshGoogleAccessToken(c.refresh_token, row.organization_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("organization_integrations")
      .update({ status: "error", error_message: message })
      .eq("organization_id", row.organization_id)
      .eq("provider_id", PROVIDER_ID);
    throw err;
  }

  await supabase
    .from("organization_integrations")
    .update({
      credentials: {
        ...c,
        access_token: refreshed.access_token,
        token_expires_at: refreshed.expires_at.toISOString(),
      },
    })
    .eq("organization_id", row.organization_id)
    .eq("provider_id", PROVIDER_ID);

  return refreshed.access_token;
}

// Acquire-or-throw helper. The 409-style error is recognized by callers and
// surfaced to the user as "Sync läuft bereits" instead of a stack trace.
class SyncLockedError extends Error {
  constructor() { super("sync already running for this integration"); this.name = "SyncLockedError"; }
}

async function withSyncLock<T>(orgId: string, owner: string, fn: () => Promise<T>): Promise<T> {
  const supabase = getServiceClient();
  const { data: acquired, error: lockErr } = await supabase.rpc("try_acquire_sync_lock", {
    p_org_id:      orgId,
    p_provider_id: PROVIDER_ID,
    p_owner:       owner,
  });
  if (lockErr) throw lockErr;
  if (!acquired) throw new SyncLockedError();
  try {
    return await fn();
  } finally {
    // Release even on error so the next attempt can run. The 30-minute stale
    // timeout in the RPC is a backstop for cases where the function crashes
    // before reaching this finally (e.g. Edge Function timeout).
    try {
      await supabase.rpc("release_sync_lock", { p_org_id: orgId, p_provider_id: PROVIDER_ID });
    } catch (releaseErr) {
      console.error("[connector-gdrive] release_sync_lock failed", releaseErr);
    }
  }
}

async function syncOrg(orgId: string, mode: "initial" | "delta", trigger: string): Promise<unknown> {
  return await withSyncLock(orgId, `${mode}-sync:${trigger}`, async () => {
  const supabase = getServiceClient();
  const { data: row, error } = await supabase
    .from("organization_integrations")
    .select("organization_id, credentials, config")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .eq("status", "active")
    .maybeSingle<IntegrationRow>();
  if (error) throw error;
  if (!row) throw new Error("no active google_drive integration");

  const accessToken = await getValidAccessToken(row);
  const startToken = mode === "initial" ? undefined : row.config?.page_token;

  return await runSync({
    organizationId: orgId,
    providerId: PROVIDER_ID,
    trigger: "manual",
    rateLimit: { capacity: 60, refillPerSec: 8 },
    syncFn: async () => {
      const { changes, nextPageToken } = await listDriveChanges(accessToken, startToken);
      if (nextPageToken) {
        await supabase
          .from("organization_integrations")
          .update({ config: { ...(row.config ?? {}), page_token: nextPageToken } })
          .eq("organization_id", orgId)
          .eq("provider_id", PROVIDER_ID);
      }

      const records: SyncRecord[] = [];
      for (const ch of changes) {
        const fileId = ch.fileId ?? ch.file?.id;
        if (!fileId) continue;
        let text: string | null = null;
        let formulaWarnings: Record<string, number> | undefined;
        if (!ch.removed && !ch.file?.trashed) {
          try {
            const extracted = await downloadDriveFileText(accessToken, fileId, ch.file?.mimeType);
            if (extracted) {
              text = extracted.text;
              formulaWarnings = extracted.formulaWarnings;
            }
          } catch (err) {
            console.warn("[gdrive] download failed:", fileId, err);
          }
        }
        // Sanitize: Postgres JSONB rejects \u0000 (null bytes). Binary-ish
        // files (xlsx, docx, pdf) sometimes surface them in metadata.
        const cleanPayload = JSON.parse(
          JSON.stringify({
            ...ch,
            _extracted_text: text,
            _formula_warnings: formulaWarnings ?? null,
          }).replace(/\\u0000/g, ""),
        ) as Record<string, unknown>;
        records.push({
          external_id: fileId,
          entity_type: "drive_item",
          payload: cleanPayload,
        });
      }
      return records;
    },
  });
  });
}

// Reconcile pass: pull a fresh snapshot of every visible Drive file id and
// soft-delete every source whose external_id is no longer in that set.
// Used by the daily cron and the manual "Aufräumen" button on /quellen.
async function reconcileOrg(orgId: string): Promise<{ removed: number }> {
  return await withSyncLock(orgId, "reconcile", async () => {
  const supabase = getServiceClient();
  const { data: row, error } = await supabase
    .from("organization_integrations")
    .select("organization_id, credentials, config")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .eq("status", "active")
    .maybeSingle<IntegrationRow>();
  if (error) throw error;
  if (!row) throw new Error("no active google_drive integration");

  const accessToken = await getValidAccessToken(row);
  const ids = await listAllDriveFileIds(accessToken);
  const { data: removed, error: rpcErr } = await supabase.rpc("reconcile_drive_sources", {
    p_org_id: orgId,
    p_connector: "gdrive",
    p_existing_ids: ids,
  });
  if (rpcErr) throw rpcErr;
  return { removed: (removed as number) ?? 0 };
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // Server-to-server only: organization_id comes straight from the body and
  // every DB access runs through the service client, which bypasses RLS.
  // Callers: apps/web/src/app/quellen/actions.ts (service-role bearer) and the
  // pg_cron jobs, which 20260806100000_connector_crons_service_role.sql moved
  // off the public anon key onto the vault service_role_key.
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  let body: { action?: string; organization_id?: string; trigger?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action  = body.action  ?? "delta-sync";
  const trigger = body.trigger ?? "manual";
  const supabase = getServiceClient();

  if (body.organization_id) {
    try {
      const result =
        action === "reconcile"
          ? await reconcileOrg(body.organization_id)
          : await syncOrg(
              body.organization_id,
              action === "initial-sync" ? "initial" : "delta",
              trigger,
            );
      return jsonResponse(result);
    } catch (err) {
      if (err instanceof SyncLockedError) {
        return jsonResponse({ skipped: "sync already running" }, 409);
      }
      return errorResponse(err instanceof Error ? err.message : String(err), 500);
    }
  }

  const { data: rows } = await supabase
    .from("organization_integrations")
    .select("organization_id")
    .eq("provider_id", PROVIDER_ID)
    .eq("status", "active");

  const results: unknown[] = [];
  for (const r of (rows ?? []) as { organization_id: string }[]) {
    try {
      if (action === "reconcile") {
        results.push({ organization_id: r.organization_id, ...(await reconcileOrg(r.organization_id)) });
      } else {
        results.push(await syncOrg(r.organization_id, "delta", trigger));
      }
    } catch (err) {
      // Skipped (lock held) is normal at the cron path — log + continue.
      if (err instanceof SyncLockedError) {
        results.push({ organization_id: r.organization_id, skipped: "sync already running" });
      } else {
        results.push({ organization_id: r.organization_id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return jsonResponse({ runs: results });
});
