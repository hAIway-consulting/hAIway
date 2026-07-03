// worker-normalize
//
// Drains the `normalize` pgmq queue. For each message, looks up the matching
// raw_events row and upserts a typed entity into the appropriate Silver
// table. Currently knows how to normalize:
//   * google_calendar / calendar_event → entities_calendar_events
//
// New entity types are added by extending the NORMALIZERS map. Anything
// unknown is acked silently (the raw row is preserved for later replay).

import type { NormalizeMsg } from "@haiway/contracts/queue-messages";
import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import { readBatch, ack, deadLetter, enqueue, queueLength } from "../_shared/queue.ts";
import { flattenPayloadToText } from "../_shared/normalize.ts";

const QUEUE                 = "normalize";
const VISIBILITY_TIMEOUT    = 60;   // seconds
const BATCH_SIZE            = 25;
const MAX_ATTEMPTS_PER_MSG  = 5;

type Normalizer = (
  msg: NormalizeMsg,
  payload: Record<string, unknown>,
) => Promise<void>;

const NORMALIZERS: Record<string, Normalizer> = {
  "google_calendar:calendar_event": normalizeGoogleCalendarEvent,
  "sharepoint:drive_item":          normalizeDriveItem,
  "google_drive:drive_item":        normalizeDriveItem,
};

// Connector drive items: upsert into the sources table via the
// connector-aware RPC, then enqueue an embed job if content changed.
async function normalizeDriveItem(
  msg: NormalizeMsg,
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = getServiceClient();

  // SharePoint payloads carry the DriveItem fields directly; gdrive change
  // payloads wrap them under `file`.
  const file = (payload.file as Record<string, unknown> | undefined) ?? payload;
  const isDeleted =
    Boolean((payload as { removed?: boolean }).removed) ||
    Boolean((payload as { deleted?: unknown }).deleted) ||
    Boolean((file as { trashed?: boolean }).trashed);

  const externalId = (file.id as string) ?? msg.external_id;
  const title = (file.name as string) ?? `${msg.provider_id} ${externalId}`;
  const etag =
    (file.eTag as string) ??
    (file.cTag as string) ??
    (file.md5Checksum as string) ??
    (file.modifiedTime as string) ??
    (file.lastModifiedDateTime as string) ??
    null;
  const mimeType =
    (file.mimeType as string) ??
    ((file.file as Record<string, unknown> | undefined)?.mimeType as string | undefined) ??
    null;
  const sourceUrl =
    (file.webUrl as string) ??
    (file.webViewLink as string) ??
    null;

  if (isDeleted) {
    // Soft-delete by external_id lookup
    const { data: existing } = await supabase
      .from("sources")
      .select("id")
      .eq("connector_type", msg.provider_id === "sharepoint" ? "sharepoint" : "gdrive")
      .eq("external_id", externalId)
      .eq("organization_id", msg.organization_id)
      .maybeSingle<{ id: string }>();
    if (existing?.id) {
      await supabase.rpc("soft_delete_source", { p_source_id: existing.id });
    }
    return;
  }

  // Propagate xlsx formula-warnings (cells with <f> but no cached <v>) into
  // sources.metadata so the chat debug panel can surface a per-source badge.
  // Always set the key — even empty — so a re-ingested, now-healthy file
  // clears the previous warning instead of carrying it forward.
  const formulaWarnings =
    (payload._formula_warnings as Record<string, number> | null | undefined) ?? {};

  const connectorType = msg.provider_id === "sharepoint" ? "sharepoint" : "gdrive";
  const { data: upsert, error } = await supabase.rpc("upsert_connector_source", {
    p_org_id: msg.organization_id,
    p_connector_type: connectorType,
    p_external_id: externalId,
    p_title: title,
    p_etag: etag,
    p_mime_type: mimeType,
    p_source_url: sourceUrl,
    p_metadata: {
      provider: msg.provider_id,
      run_id: msg.run_id,
      formula_warnings: formulaWarnings,
    },
  });
  if (error) throw error;

  const upsertRow = (Array.isArray(upsert) ? upsert[0] : upsert) as
    | { source_id: string; was_changed: boolean }
    | null;
  if (!upsertRow?.was_changed) return;

  // Enqueue embed job(s). For multi-sheet xlsx the extracted text can be
  // 100s of KB. We split on "## Sheet:" markers and enqueue one message per
  // section so every sheet gets embedded independently within Edge Function
  // memory/timeout limits. Non-tabular content is sent as a single message.
  const MAX_ENQUEUE_CHARS = 50_000;
  const extractedText = (payload._extracted_text as string | null) ?? null;
  const rawText =
    extractedText && extractedText.trim().length > 0
      ? extractedText
      : `Datei: ${title}\nTyp: ${mimeType ?? "unbekannt"}\nQuelle: ${sourceUrl ?? "—"}`;

  // Split tabular content into per-sheet sections.
  const sections = rawText.startsWith("## Sheet:")
    ? rawText.split(/(?=^## Sheet:)/m).filter((s) => s.trim())
    : [rawText];

  // Precompute all parts so we can seed the progress counter before the
  // embed worker starts consuming messages. Otherwise a fast worker could
  // process (and increment) the first message before we've set the total.
  const sectionParts: string[][] = sections.map((section) =>
    section.length > MAX_ENQUEUE_CHARS
      ? splitSheetSection(section, MAX_ENQUEUE_CHARS)
      : [section],
  );
  const totalParts = sectionParts.reduce((sum, parts) => sum + parts.length, 0);

  // Reset progress + mark the source as processing before enqueueing. The
  // embed worker will atomically increment embed_jobs_done as it finishes
  // each message and only flip status='ready' once done >= total.
  await supabase
    .from("sources")
    .update({
      status:           "processing",
      sync_status:      "queued",
      embed_jobs_total: totalParts,
      embed_jobs_done:  0,
    })
    .eq("id", upsertRow.source_id)
    .eq("organization_id", msg.organization_id);

  for (const parts of sectionParts) {
    for (let pi = 0; pi < parts.length; pi++) {
      await enqueue("embed", {
        organization_id: msg.organization_id,
        provider_id: msg.provider_id,
        entity_type: msg.entity_type,
        external_id: externalId,
        run_id: msg.run_id,
        title,
        text: parts[pi],
        source_id: upsertRow.source_id,
        // First part replaces existing chunks for this sheet; subsequent
        // parts append so they don't delete each other's chunks.
        replace_sheet: pi === 0,
      } as Record<string, unknown>);
    }
  }
}

// Split a single sheet section that exceeds maxChars into multiple
// sub-sections. Each sub-section keeps the "## Sheet:" header so the
// embed worker can identify the sheet. Splitting strategy:
//   1. Vertical format ("### Zeile" blocks) — split on block boundaries.
//   2. Tabular format (Markdown rows starting with "|") — split on row
//      boundaries, repeating the table header + separator in each part.
//   3. Fallback — hard split at maxChars boundary on newlines.
function splitSheetSection(section: string, maxChars: number): string[] {
  const lines = section.split("\n");
  // Extract the "## Sheet: ..." header line.
  const sheetHeader = lines[0]?.startsWith("## Sheet:") ? lines[0] : "";

  // --- Vertical format (### Zeile blocks) ---
  if (section.includes("### Zeile")) {
    const blocks: string[] = [];
    let current = "";
    for (let i = sheetHeader ? 1 : 0; i < lines.length; i++) {
      if (lines[i].startsWith("### Zeile") && current.trim()) {
        blocks.push(current);
        current = "";
      }
      current += (current ? "\n" : "") + lines[i];
    }
    if (current.trim()) blocks.push(current);

    const parts: string[] = [];
    let buf = sheetHeader;
    for (const block of blocks) {
      if (buf.length + 1 + block.length > maxChars && buf !== sheetHeader) {
        parts.push(buf);
        buf = sheetHeader;
      }
      buf += (buf ? "\n" : "") + block;
    }
    if (buf.trim()) parts.push(buf);
    return parts.length > 0 ? parts : [section.slice(0, maxChars)];
  }

  // --- Tabular format (Markdown table rows) ---
  if (section.includes("\n|")) {
    let tableHeader = "";
    let separator = "";
    const dataRows: string[] = [];
    let foundHeader = false;

    for (let i = sheetHeader ? 1 : 0; i < lines.length; i++) {
      if (!foundHeader && lines[i].startsWith("|")) {
        tableHeader = lines[i];
        if (i + 1 < lines.length && /^\|[\s\-|]+\|$/.test(lines[i + 1])) {
          separator = lines[i + 1];
          i++;
        }
        foundHeader = true;
        continue;
      }
      if (lines[i].startsWith("|")) {
        dataRows.push(lines[i]);
      }
    }

    if (tableHeader && dataRows.length > 0) {
      const prefix = [sheetHeader, tableHeader, separator].filter(Boolean).join("\n");
      const parts: string[] = [];
      let buf = prefix;
      for (const row of dataRows) {
        if (buf.length + 1 + row.length > maxChars && buf !== prefix) {
          parts.push(buf);
          buf = prefix;
        }
        buf += "\n" + row;
      }
      if (buf !== prefix) parts.push(buf);
      return parts.length > 0 ? parts : [section.slice(0, maxChars)];
    }
  }

  // --- Fallback: split on newline boundaries ---
  const parts: string[] = [];
  let buf = "";
  for (const line of lines) {
    if (buf.length + 1 + line.length > maxChars && buf.trim()) {
      parts.push(buf);
      buf = sheetHeader;
    }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf.trim()) parts.push(buf);
  return parts.length > 0 ? parts : [section.slice(0, maxChars)];
}

async function normalizeGoogleCalendarEvent(
  msg: NormalizeMsg,
  payload: Record<string, unknown>,
): Promise<void> {
  const supabase = getServiceClient();

  const start = (payload.start as Record<string, unknown> | undefined)?.dateTime
             ?? (payload.start as Record<string, unknown> | undefined)?.date;
  const end   = (payload.end   as Record<string, unknown> | undefined)?.dateTime
             ?? (payload.end   as Record<string, unknown> | undefined)?.date;
  const organizer = payload.organizer as Record<string, unknown> | undefined;

  const { error } = await supabase
    .from("entities_calendar_events")
    .upsert({
      organization_id: msg.organization_id,
      provider_id:     msg.provider_id,
      external_id:     msg.external_id,
      payload_hash:    msg.payload_hash,
      summary:         (payload.summary as string)     ?? null,
      description:     (payload.description as string) ?? null,
      starts_at:       start ? new Date(start as string).toISOString() : null,
      ends_at:         end   ? new Date(end   as string).toISOString() : null,
      location:        (payload.location as string) ?? null,
      organizer_email: (organizer?.email as string) ?? null,
      attendees:       payload.attendees ?? [],
      raw:             payload,
      updated_at:      new Date().toISOString(),
    }, { onConflict: "organization_id,provider_id,external_id" });

  if (error) throw error;
}

Deno.serve(async (req) => {
  try {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // Conditional polling: a single COUNT against pgmq.metrics is much cheaper
  // than pgmq.read + downstream lookups. With cron firing every 2 minutes
  // and queues empty most of the time, this turns "always do work" into
  // "only do work when work exists".
  const pending = await queueLength(QUEUE);
  if (pending === 0) {
    return jsonResponse({ skipped: "queue empty", processed: 0, failed: 0, batch: 0 });
  }

  const supabase = getServiceClient();
  const messages = await readBatch<NormalizeMsg>(QUEUE, VISIBILITY_TIMEOUT, BATCH_SIZE);

  let processed = 0;
  let failed    = 0;

  for (const m of messages) {
    const msg = m.message;
    try {
      // Look up the raw payload by (org, provider, external_id, payload_hash).
      const { data: rawRows, error: rawErr } = await supabase
        .from("raw_events")
        .select("payload")
        .eq("organization_id", msg.organization_id)
        .eq("provider_id",     msg.provider_id)
        .eq("external_id",     msg.external_id)
        .eq("payload_hash",    msg.payload_hash)
        .order("fetched_at", { ascending: false })
        .limit(1);

      if (rawErr) throw rawErr;
      if (!rawRows || rawRows.length === 0) {
        // Raw row not found — likely already pruned. Ack and move on.
        await ack(QUEUE, m.msg_id);
        continue;
      }

      const payload    = rawRows[0].payload as Record<string, unknown>;
      const key        = `${msg.provider_id}:${msg.entity_type}`;
      const normalizer = NORMALIZERS[key];
      if (normalizer) {
        await normalizer(msg, payload);
      } else {
        // Unknown type — fall back to a generic flatten so the data still
        // reaches the RAG layer instead of being silently dropped.
        const fallbackTitle = `${msg.entity_type} ${msg.external_id}`;
        const { title, text } = flattenPayloadToText(payload, fallbackTitle);
        if (text) {
          await enqueue("embed", {
            organization_id: msg.organization_id,
            provider_id:     msg.provider_id,
            entity_type:     msg.entity_type,
            external_id:     msg.external_id,
            run_id:          msg.run_id,
            title,
            text,
          });
        }
      }
      await ack(QUEUE, m.msg_id);
      processed++;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // pgmq read_ct counts attempts. After MAX_ATTEMPTS, dead-letter it.
      if (m.read_ct >= MAX_ATTEMPTS_PER_MSG) {
        await deadLetter({
          queue:          QUEUE,
          msgId:          m.msg_id,
          organizationId: msg.organization_id,
          providerId:     msg.provider_id,
          runId:          msg.run_id,
          message:        msg,
          error,
          attemptCount:   m.read_ct,
        });
      }
      // Otherwise: don't ack — visibility timeout expires, msg becomes
      // visible again, next worker tick retries it.
      failed++;
    }
  }

  return jsonResponse({ processed, failed, batch: messages.length });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[worker-normalize] FATAL", err.message, err.stack);
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
});
