// worker-extract-entities
//
// Drains the `extract` pgmq queue. For each message (= one source whose
// embedding just finished):
//   1. Load the source + its chunks (concatenated up to LLM budget).
//   2. Ask GPT-4o-mini "is this a structured list of contacts/companies/
//      projects?" via function calling with a rigid JSON schema.
//   3. If yes: wipe this source's previous auto-extracted rows (so a
//      re-ingest cleanly replaces them), then upsert each extracted row
//      via the dedicated RPCs. Tags come from list-column values (e.g.
//      "Warm", "Lauwarm") and are auto-created + linked.
//   4. Ack.
//
// Manual entities (extracted_at IS NULL) are never touched — the user
// always wins over the machine. See 20260416140000_auto_entity_extraction.sql.
//
// Uses the OpenAI REST API directly (no SDK) so the deploy surface stays
// minimal. Key reused from the same env var the chat/embeddings use:
// OPENAI_RESEARCH_TIMEKEEPER_KEY (preferred) or OPENAI_API_KEY. Model
// override via EXTRACTION_MODEL (default "gpt-4o-mini").

import {
  getServiceClient,
  jsonResponse,
  errorResponse,
  requireServiceRole,
} from "../_shared/supabase.ts";
import { readBatch, ack, deadLetter, queueLength } from "../_shared/queue.ts";

const QUEUE                = "extract";
// Visibility timeout must exceed worst-case batch wall time. With a 2-min
// cron interval and BATCH_SIZE=3 LLM calls of 10–30s each, 300s leaves
// plenty of head room before pgmq makes a message visible again.
const VISIBILITY_TIMEOUT   = 300;
const BATCH_SIZE           = 3;
const MAX_ATTEMPTS_PER_MSG = 3;
// LLM input budget. GPT-4o-mini has a 128k context window, so 40k is
// comfortable. We cap here to keep per-extraction cost bounded — typical
// contact lists fit in 5–20k chars.
const MAX_TEXT_CHARS       = 40_000;
const DEFAULT_MODEL        = "gpt-4o-mini";

interface ExtractMsg {
  organization_id: string;
  source_id:       string;
}

type ExtractedRow = {
  entity_type: "contact" | "company" | "project";
  first_name?: string;
  last_name?:  string;
  email?:      string;
  phone?:      string;
  role_title?: string;
  name?:       string;
  website?:    string;
  company_name?: string;
  description?:  string;
  status?:     string;
  tags?:       string[];
};

type ExtractionResult = {
  is_entity_list: boolean;
  rows: ExtractedRow[];
};

const EXTRACTION_TOOL_NAME = "record_extracted_entities";

// OpenAI function-calling tool. Schema is the same JSON Schema shape as
// Anthropic's input_schema — OpenAI accepts it under `function.parameters`.
const EXTRACTION_TOOL = {
  type: "function",
  function: {
    name: EXTRACTION_TOOL_NAME,
    description:
      "Classify whether the document is a structured list of business " +
      "entities (contacts, companies, projects) and, if yes, extract every " +
      "row. If the document is prose (meeting notes, emails, instructions), " +
      "return is_entity_list=false with an empty rows array.",
    parameters: {
      type: "object",
      properties: {
        is_entity_list: {
          type: "boolean",
          description:
            "true only if the document is a structured list/table with one " +
            "row per person, company, or project. Free-form prose that " +
            "merely mentions people is NOT a list.",
        },
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              entity_type: {
                type: "string",
                enum: ["contact", "company", "project"],
                description:
                  "contact = a person. company = an organization. project = a named initiative/deal.",
              },
              first_name:   { type: "string" },
              last_name:    { type: "string" },
              email:        { type: "string" },
              phone:        { type: "string" },
              role_title:   { type: "string", description: "Job title for contacts." },
              name:         { type: "string", description: "For companies/projects." },
              website:      { type: "string" },
              company_name: { type: "string", description: "Company the contact/project belongs to." },
              description:  { type: "string", description: "For projects." },
              tags: {
                type: "array",
                items: { type: "string" },
                description:
                  "Short single-word labels from list columns like 'Status' " +
                  "(e.g. 'Warm', 'Lauwarm', 'Pilot', 'Enterprise'). Do NOT " +
                  "invent tags — only copy values that appear in the source.",
              },
            },
            required: ["entity_type"],
          },
        },
      },
      required: ["is_entity_list", "rows"],
    },
  },
};

async function classifyAndExtract(
  model: string,
  apiKey: string,
  sourceTitle: string,
  text: string,
): Promise<ExtractionResult | null> {
  const body = {
    model,
    temperature: 0,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "function", function: { name: EXTRACTION_TOOL_NAME } },
    messages: [
      {
        role: "system",
        content:
          "You extract structured business entities from documents. Be " +
          "STRICT: only treat a document as an entity list if it has a clear " +
          "tabular or CSV-like structure with one row per entity. Meeting " +
          "notes, strategy memos, or bullet lists of mentions are NOT entity " +
          "lists. When extracting, copy values verbatim — do not invent or " +
          "infer fields. Respond ONLY via the record_extracted_entities function.",
      },
      {
        role: "user",
        content:
          `Document title: ${sourceTitle}\n\n` +
          `Document content:\n---\n${text}\n---`,
      },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`openai ${res.status}: ${err.slice(0, 500)}`);
  }
  const data = await res.json() as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{
          type: string;
          function?: { name: string; arguments: string };
        }>;
      };
    }>;
  };
  const toolCall = data.choices?.[0]?.message?.tool_calls?.find(
    (c) => c.type === "function" && c.function?.name === EXTRACTION_TOOL_NAME,
  );
  const rawArgs = toolCall?.function?.arguments;
  if (!rawArgs) return null;
  try {
    return JSON.parse(rawArgs) as ExtractionResult;
  } catch (parseErr) {
    throw new Error(
      `openai returned non-JSON tool arguments: ${(parseErr as Error).message} — raw: ${rawArgs.slice(0, 500)}`,
    );
  }
}

async function handleMessage(msg: ExtractMsg): Promise<void> {
  const supabase = getServiceClient();
  // Reuse the same OpenAI key that powers embeddings + chat so we don't
  // need a second billing relationship. Accept either env var name.
  const apiKey =
    Deno.env.get("OPENAI_RESEARCH_TIMEKEEPER_KEY") ??
    Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI key not set (OPENAI_RESEARCH_TIMEKEEPER_KEY or OPENAI_API_KEY)");
  }
  const model = Deno.env.get("EXTRACTION_MODEL") ?? DEFAULT_MODEL;

  // 1) Load source + chunks
  const { data: source, error: srcErr } = await supabase
    .from("sources")
    .select("id, title, raw_text")
    .eq("id", msg.source_id)
    .eq("organization_id", msg.organization_id)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; title: string; raw_text: string | null }>();
  if (srcErr) throw srcErr;
  if (!source) return; // source deleted or RLS-hidden — silently done

  let text = (source.raw_text ?? "").trim();
  if (!text) {
    // Some connector paths only persist chunks, not raw_text. Fall back
    // to concatenating chunks in order.
    const { data: chunks } = await supabase
      .from("content_chunks")
      .select("chunk_index, chunk_text")
      .eq("source_id", msg.source_id)
      .order("chunk_index", { ascending: true })
      .limit(200);
    text = (chunks ?? []).map((c) => c.chunk_text as string).join("\n\n").trim();
  }
  if (!text) return;
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);

  // 2) LLM classify + extract
  const result = await classifyAndExtract(model, apiKey, source.title, text);
  if (!result || !result.is_entity_list || !Array.isArray(result.rows) || result.rows.length === 0) {
    return; // not a list, nothing to do
  }

  // 3) Wipe previous auto-extractions for this source
  const { error: delErr } = await supabase.rpc("delete_auto_extracted_by_source", {
    p_org_id:    msg.organization_id,
    p_source_id: msg.source_id,
  });
  if (delErr) throw delErr;

  // 4) Upsert each row via dedicated RPCs
  for (const row of result.rows) {
    const tags = Array.isArray(row.tags) ? row.tags.filter((t) => typeof t === "string" && t.trim()) : [];

    if (row.entity_type === "contact") {
      const { error } = await supabase.rpc("upsert_contact_from_extraction", {
        p_org_id:           msg.organization_id,
        p_source_id:        msg.source_id,
        p_first_name:       row.first_name ?? "",
        p_last_name:        row.last_name ?? "",
        p_email:            row.email ?? "",
        p_phone:            row.phone ?? "",
        p_role_title:       row.role_title ?? "",
        p_status:           row.status ?? "",
        p_company_name:     row.company_name ?? "",
        p_extraction_model: model,
        p_tags:             tags,
      });
      if (error) throw error;
    } else if (row.entity_type === "company") {
      const { error } = await supabase.rpc("upsert_company_from_extraction", {
        p_org_id:           msg.organization_id,
        p_source_id:        msg.source_id,
        p_name:             row.name ?? row.company_name ?? "",
        p_website:          row.website ?? "",
        p_status:           row.status ?? "",
        p_extraction_model: model,
        p_tags:             tags,
      });
      if (error) throw error;
    } else if (row.entity_type === "project") {
      const { error } = await supabase.rpc("upsert_project_from_extraction", {
        p_org_id:           msg.organization_id,
        p_source_id:        msg.source_id,
        p_name:             row.name ?? "",
        p_company_name:     row.company_name ?? "",
        p_status:           row.status ?? "",
        p_description:      row.description ?? "",
        p_extraction_model: model,
        p_tags:             tags,
      });
      if (error) throw error;
    }
  }
}

Deno.serve(async (req) => {
  try {
    // verify_jwt only proves that SOME valid token was sent — the public anon
    // key qualifies. The cron authenticates with the service role key
    // (20260806150000). This is the most expensive worker (one LLM call per
    // message), so an anonymous caller must not be able to start it.
    const unauthorized = requireServiceRole(req);
    if (unauthorized) return unauthorized;

    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    // Conditional polling: extract is the most expensive worker (per-message
    // LLM call), so skipping when the queue is empty matters most here.
    const pending = await queueLength(QUEUE);
    if (pending === 0) {
      return jsonResponse({ skipped: "queue empty", processed: 0, failed: 0, batch: 0 });
    }

    const messages = await readBatch<ExtractMsg>(QUEUE, VISIBILITY_TIMEOUT, BATCH_SIZE);

    let processed = 0;
    let failed    = 0;
    // Surface per-message failures in the HTTP response body so callers
    // (and MCP-driven debugging) can see *why* a batch went 0 processed /
    // N failed without needing access to function-edge-log analytics.
    const failures: Array<{ msg_id: number; source_id?: string; error: string }> = [];

    for (const m of messages) {
      const msg = m.message;
      try {
        await handleMessage(msg);
        await ack(QUEUE, m.msg_id);
        processed++;
      } catch (err) {
        const errMsg = (err as { message?: string })?.message ?? JSON.stringify(err);
        const error  = err instanceof Error ? err : new Error(errMsg);
        console.error("[worker-extract-entities] failed", {
          msg_id: m.msg_id, source_id: msg.source_id, attempt: m.read_ct, error: errMsg,
        });
        failures.push({ msg_id: m.msg_id, source_id: msg.source_id, error: errMsg });
        if (m.read_ct >= MAX_ATTEMPTS_PER_MSG) {
          await deadLetter({
            queue:          QUEUE,
            msgId:          m.msg_id,
            organizationId: msg.organization_id,
            runId:          undefined,
            message:        msg,
            error,
            attemptCount:   m.read_ct,
          });
        }
        failed++;
      }
    }

    return jsonResponse({ processed, failed, batch: messages.length, failures });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[worker-extract-entities] FATAL", err.message, err.stack);
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
});
