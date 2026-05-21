// Pipedrive REST v1 client.
//
// Auth abstraction: today the only mode is `api_token` (Personal API Token
// stored in organization_integrations.credentials.api_token). The OAuth-marketplace
// path will land later as a second branch in getPipedriveCreds — callers
// stay unchanged.
//
// Rate-limit budget: Pipedrive's plan-default is ~100 req/min per token.
// We allocate 80/min with refill ≈ 1.33/sec via the shared rate-limit
// helper to leave headroom for user-driven UI calls.

import { getServiceClient } from "./supabase.ts";

const DEFAULT_BASE_URL = "https://api.pipedrive.com/api/v1";

export interface PipedriveCreds {
  apiToken: string;
  baseUrl:  string;
  companyDomain?: string | null;
}

interface IntegrationRow {
  credentials: { api_token?: string };
  config:      { base_url?: string; company_domain?: string };
}

export class PipedriveAuthError extends Error {
  constructor(message: string) { super(message); this.name = "PipedriveAuthError"; }
}

export async function getPipedriveCredsForOrg(orgId: string): Promise<PipedriveCreds> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("organization_integrations")
    .select("credentials, config")
    .eq("organization_id", orgId)
    .eq("provider_id", "pipedrive")
    .maybeSingle<IntegrationRow>();
  if (error) throw error;
  if (!data) throw new PipedriveAuthError("pipedrive integration not found");
  const token = data.credentials?.api_token;
  if (!token) throw new PipedriveAuthError("pipedrive api_token missing");
  return {
    apiToken: token,
    baseUrl:  data.config?.base_url ?? DEFAULT_BASE_URL,
    companyDomain: data.config?.company_domain ?? null,
  };
}

interface RawResponseMeta {
  more_items_in_collection?: boolean;
  next_start?:               number;
}

interface PipedriveListResponse<T> {
  success: boolean;
  data:    T[] | null;
  additional_data?: { pagination?: RawResponseMeta };
  error?:  string;
  error_info?: string;
}

interface PipedriveSingleResponse<T> {
  success: boolean;
  data:    T | null;
  error?:  string;
  error_info?: string;
}

// Sleep helper for 429 backoff.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pipedriveRequest<TResp>(
  creds:   PipedriveCreds,
  method:  "GET" | "POST" | "PUT" | "DELETE",
  path:    string,
  query?:  Record<string, string | number | undefined>,
  body?:   unknown,
): Promise<TResp> {
  const url = new URL(`${creds.baseUrl}${path}`);
  url.searchParams.set("api_token", creds.apiToken);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  // Up to 3 attempts on 429. After that, surface the error to runSync's
  // retry layer (which will dead-letter the run on third hard fail).
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 || res.status === 403) {
      const text = await res.text();
      throw new PipedriveAuthError(`pipedrive ${res.status}: ${text}`);
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "5");
      await sleep((retryAfter || 5) * 1000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`pipedrive ${method} ${path} → ${res.status}: ${text}`);
    }
    return await res.json() as TResp;
  }
  throw new Error(`pipedrive ${method} ${path}: rate-limited after retries`);
}

// Iterate a /list endpoint, yielding pages of items. Pipedrive paginates
// via `start` + `limit` and reports `more_items_in_collection`. Default
// page size is 500 (their max).
export async function* paginate<T>(
  creds:    PipedriveCreds,
  path:     string,
  extra?:   Record<string, string | number | undefined>,
  limit = 500,
): AsyncGenerator<T[], void, unknown> {
  let start = 0;
  for (let i = 0; i < 200; i++) {
    const body = await pipedriveRequest<PipedriveListResponse<T>>(
      creds, "GET", path, { start, limit, ...(extra ?? {}) },
    );
    const rows = body.data ?? [];
    if (rows.length > 0) yield rows;
    const more = body.additional_data?.pagination?.more_items_in_collection;
    const next = body.additional_data?.pagination?.next_start;
    if (!more || typeof next !== "number" || next <= start) return;
    start = next;
  }
}

// Convenience: flatten an async generator into one array.
async function collect<T>(gen: AsyncGenerator<T[], void, unknown>): Promise<T[]> {
  const all: T[] = [];
  for await (const page of gen) all.push(...page);
  return all;
}

// ─── Typed entity helpers ────────────────────────────────────────────────

// Pipedrive payloads are large and field-rich; we keep types loose and
// store the full payload in raw, picking only the columns we surface.

export type PipedriveEntity = Record<string, unknown> & { id: number };

export async function listOrganizations(
  creds: PipedriveCreds, sinceIso?: string,
): Promise<PipedriveEntity[]> {
  if (sinceIso) {
    return collect(paginate(creds, "/recents/", { since_timestamp: sinceIso, items: "organization" }));
  }
  return collect(paginate(creds, "/organizations"));
}

export async function listPersons(
  creds: PipedriveCreds, sinceIso?: string,
): Promise<PipedriveEntity[]> {
  if (sinceIso) {
    return collect(paginate(creds, "/recents/", { since_timestamp: sinceIso, items: "person" }));
  }
  return collect(paginate(creds, "/persons"));
}

export async function listDeals(
  creds: PipedriveCreds, sinceIso?: string,
): Promise<PipedriveEntity[]> {
  if (sinceIso) {
    return collect(paginate(creds, "/recents/", { since_timestamp: sinceIso, items: "deal" }));
  }
  return collect(paginate(creds, "/deals", { status: "all_not_deleted" }));
}

export async function listActivities(
  creds: PipedriveCreds, sinceIso?: string,
): Promise<PipedriveEntity[]> {
  if (sinceIso) {
    return collect(paginate(creds, "/recents/", { since_timestamp: sinceIso, items: "activity" }));
  }
  return collect(paginate(creds, "/activities"));
}

export async function listPipelines(creds: PipedriveCreds): Promise<PipedriveEntity[]> {
  const res = await pipedriveRequest<PipedriveListResponse<PipedriveEntity>>(creds, "GET", "/pipelines");
  return res.data ?? [];
}

export async function listStages(creds: PipedriveCreds): Promise<PipedriveEntity[]> {
  const res = await pipedriveRequest<PipedriveListResponse<PipedriveEntity>>(creds, "GET", "/stages");
  return res.data ?? [];
}

// ─── Write helpers (used by Phase 3 — exported now so worker-icp-classify
//     and worker-sales-nudges can share the same client surface) ───────────

export async function updateOrganization(
  creds: PipedriveCreds, externalId: string, fields: Record<string, unknown>,
): Promise<PipedriveEntity | null> {
  const res = await pipedriveRequest<PipedriveSingleResponse<PipedriveEntity>>(
    creds, "PUT", `/organizations/${externalId}`, undefined, fields,
  );
  return res.data;
}

export interface CreateActivityInput {
  deal_id?:    number;
  person_id?:  number;
  org_id?:     number;
  user_id?:    number;
  type:        string;
  subject:     string;
  due_date?:   string; // YYYY-MM-DD
  due_time?:   string; // HH:MM
  note?:       string;
}

export async function createActivity(
  creds: PipedriveCreds, input: CreateActivityInput,
): Promise<PipedriveEntity | null> {
  const res = await pipedriveRequest<PipedriveSingleResponse<PipedriveEntity>>(
    creds, "POST", "/activities", undefined, input,
  );
  return res.data;
}

export interface OrganizationField extends PipedriveEntity {
  key:        string;
  name:       string;
  field_type: string;
  options?:   { id: number; label: string }[];
}

export async function listOrganizationFields(creds: PipedriveCreds): Promise<OrganizationField[]> {
  const res = await pipedriveRequest<PipedriveListResponse<OrganizationField>>(
    creds, "GET", "/organizationFields",
  );
  return res.data ?? [];
}

export async function createOrganizationField(
  creds:  PipedriveCreds,
  input: { name: string; field_type: string; options?: { label: string }[] },
): Promise<OrganizationField | null> {
  const res = await pipedriveRequest<PipedriveSingleResponse<OrganizationField>>(
    creds, "POST", "/organizationFields", undefined, input,
  );
  return res.data;
}

// Smoke-test helper used by the connect server action to verify the token
// before persisting. /users/me returns the calling user when the token is
// valid; otherwise 401.
export async function whoAmI(creds: PipedriveCreds): Promise<PipedriveEntity | null> {
  const res = await pipedriveRequest<PipedriveSingleResponse<PipedriveEntity>>(
    creds, "GET", "/users/me",
  );
  return res.data;
}
