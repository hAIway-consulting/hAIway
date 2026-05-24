// worker-imap-poll
//
// Skeleton for IMAP-based mail ingest. Pulls UNSEEN messages from a
// tenant-configured mailbox and lands each as a raw_event with
// entity_type = "inbound_mail" — same shape inbound-mail-webhook produces.
//
// STATUS: skeleton. The IMAP transport itself is not yet wired up because
// Deno has no first-party IMAP client and we want to evaluate a few
// candidates (deno_imap, jsr:@workingdevshero/deno-imap) before locking
// one in. The function returns 501 today so smoke tests fail fast instead
// of silently doing nothing.
//
// Body: { organization_id?, action?: "poll" | "test-connection" }

import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";

const PROVIDER_ID = "imap_inbox";

interface ImapConfig {
  host:     string;
  port:     number;
  username: string;
  password: string;
  tls?:     boolean;
  mailbox?: string;
}

async function getConfig(orgId: string): Promise<ImapConfig> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("organization_integrations")
    .select("credentials")
    .eq("organization_id", orgId)
    .eq("provider_id", PROVIDER_ID)
    .eq("status", "active")
    .maybeSingle<{ credentials: Partial<ImapConfig> }>();
  if (error) throw error;
  const c = data?.credentials;
  if (!c?.host || !c.username || !c.password) {
    throw new Error("imap_inbox integration not configured for this org");
  }
  return {
    host:     c.host,
    port:     c.port ?? 993,
    username: c.username,
    password: c.password,
    tls:      c.tls ?? true,
    mailbox:  c.mailbox ?? "INBOX",
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: { organization_id?: string; action?: string };
  try { body = await req.json(); } catch { body = {}; }

  if (!body.organization_id) return errorResponse("organization_id required", 400);

  try {
    // Resolve config so misconfiguration surfaces with a real error even
    // while the transport layer is stubbed.
    const cfg = await getConfig(body.organization_id);

    // TODO(connector-imap): wire deno_imap, fetch UNSEEN, parse RFC822,
    // map to raw_events with entity_type='inbound_mail', enqueue normalize.
    // Keep the public shape identical to inbound-mail-webhook so the
    // downstream pipeline does not need to branch.
    return jsonResponse({
      not_implemented: true,
      reason:          "IMAP transport not yet wired; use inbound_mail_webhook for now",
      host:            cfg.host,
      mailbox:         cfg.mailbox,
    }, 501);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 500);
  }
});
