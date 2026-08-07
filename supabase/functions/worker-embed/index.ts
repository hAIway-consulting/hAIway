// worker-embed
//
// Drains the `embed` pgmq queue. For each message:
//   1. Upserts a `sources` row representing the Silver entity (one source per
//      provider+external_id, source_type='entity').
//   2. Replaces its `content_chunks` with a fresh chunk + embedding so the
//      RAG layer always reflects the current Silver state.
//
// This is the bridge from Silver → Gold. The phone-assistant-rag and any
// chat surface query `content_chunks` directly, so once this worker has
// processed an entity it is immediately available to the AI layer.

import {
  getServiceClient,
  jsonResponse,
  errorResponse,
  requireServiceRole,
} from "../_shared/supabase.ts";
import { readBatch, ack, deadLetter, enqueue, queueLength } from "../_shared/queue.ts";
import { embedText } from "../_shared/embeddings.ts";
import { chunkText, chunkTabularText, chunkVerticalText } from "../_shared/chunking.ts";

const QUEUE                = "embed";
// Visibility timeout must exceed worst-case batch wall time so the next
// cron tick (2 min) does not re-read messages this worker is still
// processing. Worst case = BATCH_SIZE * ~60s embed-API call.
const VISIBILITY_TIMEOUT   = 300;
const BATCH_SIZE           = 5;
const MAX_ATTEMPTS_PER_MSG = 5;
// Hard cap on total characters per source before chunking. Must stay within
// Edge Function memory + timeout limits: 50k chars ≈ 31 chunks ≈ 31 embed
// API calls, comfortably within the ~60s execution window.
const MAX_SOURCE_CHARS     = 50_000;

interface EmbedMsg {
  organization_id: string;
  provider_id:     string;
  entity_type:     string;
  external_id:     string;
  run_id?:         string;
  title:           string;
  text:            string;
  metadata?:       Record<string, unknown>;
  // Connector workers (gdrive/sharepoint) pass the existing connector source
  // id so we update that row in place instead of creating a parallel
  // source_type='entity' row. Without this the connector rows stay forever
  // on sync_status='queued' and the /quellen progress bar never advances.
  source_id?:      string;
  // When a large sheet is split into multiple messages, only the first part
  // carries replace_sheet=true so the embed worker deletes old chunks once.
  // Subsequent parts (replace_sheet=false) append without deleting.
  replace_sheet?:  boolean;
}

Deno.serve(async (req) => {
  // verify_jwt only proves that SOME valid token was sent — the public anon
  // key qualifies. The cron authenticates with the service role key
  // (20260806150000); every embed call spends OpenAI budget, so nothing else
  // may drive this worker.
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // Conditional polling: skip the heavier pgmq.read + embedding pipeline
  // when the queue is empty. Most cron ticks at steady state hit this path.
  const pending = await queueLength(QUEUE);
  if (pending === 0) {
    return jsonResponse({ skipped: "queue empty", processed: 0, failed: 0, batch: 0 });
  }

  const supabase = getServiceClient();
  const messages = await readBatch<EmbedMsg>(QUEUE, VISIBILITY_TIMEOUT, BATCH_SIZE);

  let processed = 0;
  let failed    = 0;

  for (const m of messages) {
    const msg = m.message;
    try {
      let text = (msg.text ?? "").slice(0, MAX_SOURCE_CHARS).trim();
      if (!text) {
        await ack(QUEUE, m.msg_id);
        continue;
      }

      // Detect structured content from xlsx extraction:
      // - Tabular: Markdown tables with "|" rows
      // - Vertical: key-value blocks with "### Zeile" headers (wide tables)
      const sheetMatch = text.match(/^## Sheet:\s*(.+)/m);
      const msgSheetName = sheetMatch?.[1]?.trim() ?? null;
      const isTabular  = !!sheetMatch && text.includes("\n|");
      const isVertical = !!sheetMatch && !isTabular && text.includes("### Zeile");

      // Strip trailing empty columns from Markdown tables. Older extractions
      // may carry dozens of empty "|  " columns that bloat each chunk.
      // Strategy: find max non-empty column index across all data rows in
      // each section, then trim header + separator + data rows to match.
      if (isTabular) {
        const lines = text.split("\n");
        // First pass: find the max used column for each section.
        let maxCol = 0;
        for (const line of lines) {
          if (!line.startsWith("|") || /^\|[\s\-|]+\|$/.test(line)) continue;
          const cells = line.split("|");
          for (let i = cells.length - 1; i >= 1; i--) {
            if (cells[i].trim()) { if (i > maxCol) maxCol = i; break; }
          }
        }
        if (maxCol > 0) {
          text = lines.map((line) => {
            if (!line.startsWith("|")) return line;
            const cells = line.split("|");
            if (cells.length <= maxCol + 2) return line;
            return cells.slice(0, maxCol + 1).join("|") + " |";
          }).join("\n");
        }
      }
      console.log("[worker-embed] chunking", { msg_id: m.msg_id, isTabular, isVertical, textLen: text.length });
      let chunks;
      try {
        chunks = isTabular
          ? chunkTabularText(text, { targetTokens: 400 })
          : isVertical
          ? chunkVerticalText(text, { targetTokens: 400 })
          : chunkText(text, { targetTokens: 400, overlapTokens: 50 });
      } catch (chunkErr) {
        console.error("[worker-embed] chunking FAILED", { msg_id: m.msg_id, error: chunkErr instanceof Error ? chunkErr.message : String(chunkErr), stack: chunkErr instanceof Error ? chunkErr.stack : undefined });
        throw chunkErr;
      }
      console.log("[worker-embed] chunks created", { msg_id: m.msg_id, count: chunks.length });
      if (chunks.length === 0) {
        await ack(QUEUE, m.msg_id);
        continue;
      }

      // 1. Resolve the target sources row.
      //    a) Connector path: msg.source_id is set by worker-normalize for
      //       gdrive/sharepoint. Update that connector row in place and flip
      //       both `status` (used by /sources) and `sync_status` (used by
      //       /quellen) to `ready`.
      //    b) Entity path: legacy callers (calendar etc.) carry no source_id;
      //       we keep the metadata.source_key lookup and create a parallel
      //       source_type='entity' row.
      const sourceKey = `${msg.provider_id}:${msg.entity_type}:${msg.external_id}`;
      const wordCount = text.split(/\s+/).length;
      let sourceId: string;

      if (msg.source_id) {
        sourceId = msg.source_id;
        // Only stage title/word_count here. status/sync_status flip to
        // 'ready'/'success' happens below, after embeddings actually succeeded.
        // For multi-sheet xlsx each sheet arrives as a separate message —
        // don't overwrite raw_text with a single sheet's portion.
        const updatePayload: Record<string, unknown> = { title: msg.title };
        if (!msgSheetName) {
          // Non-sheet content: single message per source, safe to set full text.
          updatePayload.raw_text = text;
          updatePayload.word_count = wordCount;
        }
        const { error: updErr } = await supabase
          .from("sources")
          .update(updatePayload)
          .eq("id", sourceId)
          .eq("organization_id", msg.organization_id);
        if (updErr) throw updErr;
      } else {
        const { data: existing, error: selErr } = await supabase
          .from("sources")
          .select("id")
          .eq("organization_id", msg.organization_id)
          .eq("source_type",     "entity")
          .contains("metadata",  { source_key: sourceKey })
          .limit(1);
        if (selErr) throw selErr;

        if (existing && existing.length > 0) {
          sourceId = existing[0].id as string;
          const { error: updErr } = await supabase
            .from("sources")
            .update({
              title:      msg.title,
              raw_text:   text,
              status:     "ready",
              word_count: wordCount,
              metadata:   {
                source_key:  sourceKey,
                provider_id: msg.provider_id,
                entity_type: msg.entity_type,
                external_id: msg.external_id,
                ...(msg.metadata ?? {}),
              },
            })
            .eq("id", sourceId);
          if (updErr) throw updErr;
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("sources")
            .insert({
              organization_id: msg.organization_id,
              title:           msg.title,
              source_type:     "entity",
              raw_text:        text,
              status:          "ready",
              word_count:      wordCount,
              metadata: {
                source_key:  sourceKey,
                provider_id: msg.provider_id,
                entity_type: msg.entity_type,
                external_id: msg.external_id,
                ...(msg.metadata ?? {}),
              },
            })
            .select("id")
            .single();
          if (insErr) throw insErr;
          sourceId = ins!.id as string;
        }
      }

      // 2. Embed each chunk in parallel. Any failure must be loud — silently
      //    persisting embedding=null masks rate limits / API key issues and
      //    leaves the source flagged as "ready" while RAG search is broken.
      const embeddings: number[][] = [];
      for (const c of chunks) {
        embeddings.push(await embedText(c.text) as number[]);
      }

      // 3. Replace existing chunks for this source. For multi-sheet xlsx
      //    each sheet arrives as a separate message — only delete chunks
      //    belonging to the same sheet, not the whole source.
      //    When a large sheet is split into multiple messages, only the
      //    first part (replace_sheet=true) deletes; subsequent parts
      //    (replace_sheet=false) append to avoid overwriting each other.
      const shouldDelete = msg.replace_sheet !== false;
      if (shouldDelete) {
        let delQuery = supabase
          .from("content_chunks")
          .delete()
          .eq("source_id", sourceId);
        if (msgSheetName) {
          delQuery = delQuery.contains("metadata", { sheet_name: msgSheetName });
        }
        const { error: delErr } = await delQuery;
        if (delErr) throw delErr;
      }

      const rows = chunks.map((c, i) => ({
        organization_id: msg.organization_id,
        source_id:       sourceId,
        chunk_index:     c.index,
        chunk_text:      c.text,
        token_count:     c.tokenCount,
        char_start:      c.charStart,
        char_end:        c.charEnd,
        embedding:       embeddings[i] ?? null,
        metadata: {
          provider_id: msg.provider_id,
          entity_type: msg.entity_type,
          external_id: msg.external_id,
          // Always set sheet_name from the message header so all chunks
          // (tabular and non-tabular) are identifiable per sheet.
          ...(msgSheetName ? { sheet_name: msgSheetName } : {}),
          ...(c.sheetName ? {
            content_format: "tabular",
            row_start:      c.rowStart,
            row_end:        c.rowEnd,
          } : {}),
        },
      }));

      const { error: chunkErr } = await supabase
        .from("content_chunks")
        .insert(rows);
      if (chunkErr) throw chunkErr;

      // Embeddings persisted. Increment the progress counter atomically
      // and only flip status='ready'/sync_status='success' once ALL
      // enqueued embed messages for this source have been processed.
      // Otherwise multi-sheet xlsx uploads would flash "bereit" after the
      // first sheet while DELETE+INSERT churn continues for later sheets.
      if (msg.source_id) {
        const { data: progressRow, error: progressErr } = await supabase
          .rpc("increment_embed_progress", { p_source_id: sourceId })
          .single<{ done: number; total: number; is_complete: boolean }>();
        if (progressErr) throw progressErr;

        if (progressRow?.is_complete) {
          await supabase
            .from("sources")
            .update({ status: "ready", sync_status: "success" })
            .eq("id", sourceId)
            .eq("organization_id", msg.organization_id);

          // Kick off auto-entity-extraction. The worker-extract-entities
          // function decides whether this source looks like a structured
          // list of contacts/companies/projects and, if yes, writes rows
          // into the CRM tables so "alle Vertriebskontakte"-style queries
          // can hit the entity_list retrieval path without manual tagging.
          try {
            await enqueue("extract", {
              organization_id: msg.organization_id,
              source_id:       sourceId,
            } as Record<string, unknown>);
          } catch (extractErr) {
            // Non-fatal: the embedding succeeded, only extraction enqueue
            // failed. Log and move on — re-ingest will retry.
            console.error("[worker-embed] extract enqueue failed", {
              source_id: sourceId,
              error: (extractErr as { message?: string })?.message ?? String(extractErr),
            });
          }
        }
      }

      await ack(QUEUE, m.msg_id);
      processed++;
    } catch (err) {
      // Supabase errors are plain objects with .message, not Error instances.
      const errMsg = (err as { message?: string })?.message ?? JSON.stringify(err);
      const error = err instanceof Error ? err : new Error(errMsg);
      console.error("[worker-embed] failed", { msg_id: m.msg_id, source_id: msg.source_id, attempt: m.read_ct, error: errMsg });
      if (m.read_ct >= MAX_ATTEMPTS_PER_MSG) {
        // Permanent failure — mark the connector source as error so the user
        // sees it in /quellen instead of stuck on "wartet" forever.
        if (msg.source_id) {
          await supabase
            .from("sources")
            .update({ sync_status: "error" })
            .eq("id", msg.source_id)
            .eq("organization_id", msg.organization_id);
        }
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
      failed++;
    }
  }

  return jsonResponse({ processed, failed, batch: messages.length });
});
