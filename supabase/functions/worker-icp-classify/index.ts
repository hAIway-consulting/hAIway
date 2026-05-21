// worker-icp-classify
//
// Phase 2 + 3 of the Pipedrive sales-steering build.
//
// 1. Pick Pipedrive organizations that have no current classification (or one
//    older than 30 days) and where manual_override is false.
// 2. Call an LLM via Vercel AI Gateway with name + domain → JSON
//    {industry, confidence, reasoning}. Upsert into deal_icp_classifications.
// 3. Write-back: if the org's Pipedrive integration has a custom_field_key
//    + icp_option_ids mapping in config, PATCH the matching option onto the
//    Pipedrive Organization. Idempotent — skips when the field already
//    holds the target value.
//
// Triggered via pg_cron `worker-icp-classify-hourly`. Manual invocation
// (POST with {organization_id, force?: true}) reruns regardless of age.

import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import {
  getPipedriveCredsForOrg,
  updateOrganization,
  listOrganizationFields,
  createOrganizationField,
  PipedriveAuthError,
} from "../_shared/pipedrive.ts";

const BATCH_SIZE = 25;
const CLASSIFICATION_TTL_DAYS = 30;
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const FIELD_LABEL_PREFIX = "hAIway ICP";
const OPTION_LABELS: Record<Industry, string> = {
  commerce:     "E-Commerce",
  hls:          "HLS",
  bauwesen:     "Bauwesen",
  other:        "Other",
};

type Industry = "commerce" | "hls" | "bauwesen" | "other";

interface CandidateRow {
  external_id:   string;
  name:          string | null;
  domain:        string | null;
}

interface PipedriveIntegrationRow {
  organization_id: string;
  config: {
    custom_field_key?: string;
    icp_option_ids?:   Partial<Record<Industry, number>>;
  } | null;
}

interface ClassificationResult {
  industry:   Industry;
  confidence: number;
  reasoning:  string;
}

async function callGateway(input: { name: string; domain: string | null }): Promise<ClassificationResult> {
  const token = Deno.env.get("AI_GATEWAY_API_KEY") ?? Deno.env.get("VERCEL_OIDC_TOKEN");
  if (!token) throw new Error("AI_GATEWAY_API_KEY missing");

  const system =
    "You classify B2B sales accounts by industry. Pick exactly one of: " +
    "'commerce' (online retailers, e-commerce shops, Shopify/Shopware/WooCommerce merchants), " +
    "'hls' (Heizung, Lüftung, Sanitär — heating, ventilation, plumbing trades), " +
    "'bauwesen' (architecture, construction management, civil engineering, planning offices), " +
    "or 'other'. Respond ONLY with valid JSON " +
    "{\"industry\":\"commerce|hls|bauwesen|other\",\"confidence\":0..1,\"reasoning\":\"short german sentence\"}.";

  const userMsg = `Company: ${input.name}\nDomain: ${input.domain ?? "(unknown)"}`;

  const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model:       DEFAULT_MODEL,
      temperature: 0,
      max_tokens:  200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user",   content: userMsg },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI Gateway ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("AI Gateway returned empty content");
  let parsed: ClassificationResult;
  try {
    parsed = JSON.parse(raw) as ClassificationResult;
  } catch {
    throw new Error(`AI Gateway returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (!(["commerce","hls","bauwesen","other"] as Industry[]).includes(parsed.industry)) {
    parsed.industry = "other";
  }
  parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
  parsed.reasoning  = String(parsed.reasoning ?? "");
  return parsed;
}

// Ensure the ICP custom field exists in Pipedrive. Returns the field key
// + option id mapping. Cached in organization_integrations.config so we
// only call Pipedrive once per tenant.
async function ensureCustomField(orgId: string): Promise<{ key: string; optionIds: Record<Industry, number> } | null> {
  const supabase = getServiceClient();

  const { data: row } = await supabase
    .from("organization_integrations")
    .select("config")
    .eq("organization_id", orgId)
    .eq("provider_id", "pipedrive")
    .maybeSingle<{ config: PipedriveIntegrationRow["config"] }>();

  const existingKey = row?.config?.custom_field_key;
  const existingMap = row?.config?.icp_option_ids;
  if (existingKey && existingMap && (Object.keys(OPTION_LABELS) as Industry[]).every((i) => existingMap[i])) {
    return { key: existingKey, optionIds: existingMap as Record<Industry, number> };
  }

  let creds;
  try {
    creds = await getPipedriveCredsForOrg(orgId);
  } catch {
    return null;
  }

  const fields = await listOrganizationFields(creds);
  let field = fields.find((f) => typeof f.name === "string" && f.name.startsWith(FIELD_LABEL_PREFIX));
  if (!field) {
    const created = await createOrganizationField(creds, {
      name: FIELD_LABEL_PREFIX,
      field_type: "enum",
      options: (Object.keys(OPTION_LABELS) as Industry[]).map((i) => ({ label: OPTION_LABELS[i] })),
    });
    if (!created) return null;
    field = created;
  }

  const optionIds: Partial<Record<Industry, number>> = {};
  const opts = field.options ?? [];
  for (const ind of Object.keys(OPTION_LABELS) as Industry[]) {
    const match = opts.find((o) => o.label === OPTION_LABELS[ind]);
    if (match && typeof match.id === "number") optionIds[ind] = match.id;
  }
  if (Object.keys(optionIds).length < 4) {
    console.warn("[worker-icp-classify] not all options resolved", optionIds);
    return null;
  }

  const merged = {
    ...((row?.config ?? {}) as Record<string, unknown>),
    custom_field_key: field.key,
    icp_option_ids:   optionIds,
  };
  await supabase
    .from("organization_integrations")
    .update({ config: merged })
    .eq("organization_id", orgId)
    .eq("provider_id", "pipedrive");

  return { key: field.key, optionIds: optionIds as Record<Industry, number> };
}

async function writeBack(
  orgId:           string,
  pdOrgExternalId: string,
  industry:        Industry,
  field:           { key: string; optionIds: Record<Industry, number> },
): Promise<void> {
  // Check current value first to keep this idempotent.
  const supabase = getServiceClient();
  const { data: pd } = await supabase
    .from("entities_pipedrive_organizations")
    .select("raw")
    .eq("organization_id", orgId)
    .eq("external_id", pdOrgExternalId)
    .maybeSingle<{ raw: Record<string, unknown> }>();
  const current = pd?.raw?.[field.key];
  if (typeof current === "number" && current === field.optionIds[industry]) return;
  if (typeof current === "string" && current === String(field.optionIds[industry])) return;

  try {
    const creds = await getPipedriveCredsForOrg(orgId);
    await updateOrganization(creds, pdOrgExternalId, { [field.key]: field.optionIds[industry] });
  } catch (err) {
    // Don't fail the run because of write-back; the classification is the
    // primary outcome. Log + move on.
    console.warn("[worker-icp-classify] write-back failed", pdOrgExternalId, err);
  }
}

async function processOrg(orgId: string, force: boolean): Promise<{ classified: number; skipped: number }> {
  const supabase = getServiceClient();
  const cutoff = new Date(Date.now() - CLASSIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Candidates: orgs not yet classified or whose classification is stale +
  // not manually overridden. We use a left-join via a SQL function to keep
  // pagination simple; here we read all candidate orgs and filter in memory
  // because Pipedrive accounts per tenant are usually well under 10k.
  const { data: orgsData, error: orgsErr } = await supabase
    .from("entities_pipedrive_organizations")
    .select("external_id, name, domain")
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (orgsErr) throw orgsErr;

  const orgs = (orgsData ?? []) as CandidateRow[];
  if (orgs.length === 0) return { classified: 0, skipped: 0 };

  const { data: classData } = await supabase
    .from("deal_icp_classifications")
    .select("pipedrive_org_external_id, manual_override, classified_at")
    .eq("organization_id", orgId);

  const byExternal = new Map<string, { manual: boolean; classifiedAt: string }>();
  for (const c of (classData ?? []) as Array<{ pipedrive_org_external_id: string; manual_override: boolean; classified_at: string }>) {
    byExternal.set(c.pipedrive_org_external_id, { manual: c.manual_override, classifiedAt: c.classified_at });
  }

  const candidates = orgs.filter((o) => {
    if (!o.name) return false;
    const existing = byExternal.get(o.external_id);
    if (!existing) return true;
    if (existing.manual) return false;
    if (force) return true;
    return existing.classifiedAt < cutoff;
  }).slice(0, BATCH_SIZE);

  if (candidates.length === 0) return { classified: 0, skipped: orgs.length };

  const field = await ensureCustomField(orgId);

  let classified = 0;
  for (const cand of candidates) {
    try {
      const result = await callGateway({ name: cand.name ?? "", domain: cand.domain });
      const { error: upsertErr } = await supabase
        .from("deal_icp_classifications")
        .upsert({
          organization_id:           orgId,
          pipedrive_org_external_id: cand.external_id,
          industry:                  result.industry,
          confidence:                result.confidence,
          reasoning:                 result.reasoning,
          llm_model:                 DEFAULT_MODEL,
          manual_override:           false,
          classified_at:             new Date().toISOString(),
          updated_at:                new Date().toISOString(),
        }, { onConflict: "organization_id,pipedrive_org_external_id" });
      if (upsertErr) throw upsertErr;
      classified++;

      if (field) {
        await writeBack(orgId, cand.external_id, result.industry, field);
      }
    } catch (err) {
      console.error("[worker-icp-classify] failed", cand.external_id, err);
    }
  }

  return { classified, skipped: orgs.length - classified };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  let body: { organization_id?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* no body = fan out */ }

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

  const results: Array<{ organization_id: string; classified?: number; skipped?: number; error?: string }> = [];
  for (const orgId of orgIds) {
    try {
      const out = await processOrg(orgId, Boolean(body.force));
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
