// inbound-mail-webhook
//
// Signed HTTP inbox. Mail-forwarding providers (e.g. Postmark, Resend,
// Cloudflare Email Workers) POST a normalized mail payload here. We verify
// the HMAC against the tenant's shared_secret, drop the event into the
// Bronze layer, and fan out into the normalize queue so the rest of the
// pipeline behaves identically to mail pulled by an IMAP poller.
//
// URL:   POST /functions/v1/inbound-mail-webhook?organization_id=<uuid>
// Header: X-Signature: sha256=<hex(HMAC-SHA256(shared_secret, rawBody))>
// Body (JSON):
//   { message_id, from, to, subject, text, html?, received_at,
//     attachments?: [{ filename, content_type, url? | content_base64? }] }

import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import { enqueue } from "../_shared/queue.ts";

const PROVIDER_ID = "inbound_mail_webhook";

interface IntegrationRow {
  status:      string;
  credentials: { shared_secret?: string; from_allowlist?: string[] };
}

async function loadIntegration(orgId: string): Promise<IntegrationRow | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("organization_integrations")
    .select("status, credentials")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .maybeSingle<IntegrationRow>();
  if (error) throw error;
  return data;
}

async function verifySignature(rawBody: string, secret: string, headerValue: string): Promise<boolean> {
  // accept "sha256=<hex>" or bare "<hex>" for portability across providers
  const expectedHex = headerValue.startsWith("sha256=")
    ? headerValue.slice("sha256=".length)
    : headerValue;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const actualHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time-ish comparison
  if (actualHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) {
    diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}

async function hashPayload(payload: unknown): Promise<string> {
  const stable = JSON.stringify(payload);
  const buf    = new TextEncoder().encode(stable);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const url   = new URL(req.url);
  const orgId = url.searchParams.get("organization_id");
  if (!orgId) return errorResponse("organization_id required", 400);

  const sigHeader = req.headers.get("x-signature");
  if (!sigHeader) return errorResponse("X-Signature header required", 401);

  const rawBody = await req.text();

  let integration: IntegrationRow | null;
  try { integration = await loadIntegration(orgId); }
  catch (err) { return errorResponse(err instanceof Error ? err.message : String(err), 500); }

  if (!integration || integration.status !== "active") {
    return errorResponse("integration not active for org", 404);
  }
  const secret = integration.credentials.shared_secret;
  if (!secret) return errorResponse("shared_secret not configured", 500);

  const ok = await verifySignature(rawBody, secret, sigHeader);
  if (!ok) return errorResponse("signature mismatch", 401);

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch { return errorResponse("Invalid JSON body", 400); }

  // Optional sender allowlist (cheap spam gate before we burn agent budget)
  const allow = integration.credentials.from_allowlist;
  if (Array.isArray(allow) && allow.length > 0) {
    const from = String(payload.from ?? "");
    const ok = allow.some((entry) => from.toLowerCase().includes(entry.toLowerCase()));
    if (!ok) return errorResponse("sender not in allowlist", 403);
  }

  const externalId = String(payload.message_id ?? `${orgId}-${Date.now()}-${crypto.randomUUID()}`);
  const payloadHash = await hashPayload(payload);

  const supabase = getServiceClient();
  const { error: insertErr } = await supabase.from("raw_events").insert({
    organization_id: orgId,
    provider_id:     PROVIDER_ID,
    run_id:          null,
    external_id:     externalId,
    entity_type:     "inbound_mail",
    payload,
    payload_hash:    payloadHash,
  });
  // 23505 = duplicate. Webhooks retry; idempotency is required.
  if (insertErr && insertErr.code !== "23505") {
    return errorResponse(insertErr.message, 500);
  }

  if (!insertErr) {
    try {
      await enqueue("normalize", {
        organization_id: orgId,
        provider_id:     PROVIDER_ID,
        run_id:          null,
        external_id:     externalId,
        entity_type:     "inbound_mail",
        payload_hash:    payloadHash,
      });
    } catch (err) {
      console.error("[inbound-mail-webhook] enqueue normalize failed", err);
    }
  }

  return jsonResponse({ accepted: true, external_id: externalId, duplicate: !!insertErr });
});
