// Seeds a customer sandbox org with realistic inbound mails. The seeds are
// written as raw_events (Bronze) and enqueued onto the `normalize` queue —
// the REAL pipeline runs, including the automation trigger dispatch. No
// side channel.
//
// Safety: refuses any org whose slug does not start with "claude-test"
// (seeds never touch customer or platform orgs).
//
// Run with:
//   node --env-file=apps/web/.env.local scripts/customers/seed-sandbox.mts \
//     --customer mamalila --org claude-test-mamalila [--apply]

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROVIDER_ID = "inbound_mail_webhook";
const ENTITY_TYPE = "inbound_mail";

const flags: Record<string, string | boolean> = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[arg.slice(2)] = next;
      i++;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
}

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (use --env-file)");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface SeedMail {
  external_id: string;
  subject: string;
  from: string;
  body: string;
}

async function main(): Promise<void> {
  const customer = typeof flags.customer === "string" ? flags.customer : null;
  const orgSlug = typeof flags.org === "string" ? flags.org : customer ? `claude-test-${customer}` : null;
  if (!customer || !orgSlug) fail("--customer <slug> is required (--org optional)");

  if (!orgSlug.startsWith("claude-test")) {
    fail(`org "${orgSlug}" is not a sandbox — seeds only go into claude-test-* orgs`);
  }

  const seedPath = join(REPO_ROOT, "customers", customer, "seed", "inbound-mails.json");
  if (!existsSync(seedPath)) fail(`${seedPath} not found`);
  const mails = (JSON.parse(readFileSync(seedPath, "utf8")) as (SeedMail & { $comment?: string })[])
    .filter((m) => m.external_id);

  const db = createServiceClient();

  const { data: org, error } = await db
    .from("organizations")
    .select("id, slug, metadata")
    .eq("slug", orgSlug)
    .maybeSingle<{ id: string; slug: string; metadata: Record<string, unknown> }>();
  if (error) throw error;
  if (!org) fail(`org "${orgSlug}" not found — create it first (scripts/ops/create-sandbox-org.mjs)`);
  if (!org.metadata?.is_claude_test_org) {
    fail(`org "${orgSlug}" is missing metadata.is_claude_test_org — refusing`);
  }

  console.log(`target org ${org.id} (${org.slug}) — ${mails.length} seed mail(s)`);
  if (flags.apply !== true) {
    for (const mail of mails) console.log(`  would seed ${mail.external_id}: ${mail.subject}`);
    console.log(`\ndry run complete. Add --apply to write.`);
    return;
  }

  // One integration_run groups this seed batch in the audit trail.
  const { data: runId, error: runErr } = await db.rpc("start_integration_run", {
    p_org_id: org.id,
    p_provider_id: PROVIDER_ID,
    p_trigger: "manual",
  });
  if (runErr) throw new Error(`start_integration_run: ${runErr.message}`);

  let ok = 0;
  for (const mail of mails) {
    const payload = { subject: mail.subject, from: mail.from, body: mail.body };
    const payloadHash = sha256(JSON.stringify(payload));

    const { error: rawErr } = await db.from("raw_events").insert({
      organization_id: org.id,
      provider_id: PROVIDER_ID,
      run_id: runId,
      external_id: mail.external_id,
      entity_type: ENTITY_TYPE,
      payload,
      payload_hash: payloadHash,
    });
    if (rawErr && !/duplicate key/i.test(rawErr.message)) throw rawErr;

    const { error: enqErr } = await db.rpc("pgmq_send", {
      p_queue: "normalize",
      p_msg: {
        organization_id: org.id,
        provider_id: PROVIDER_ID,
        run_id: runId,
        external_id: mail.external_id,
        entity_type: ENTITY_TYPE,
        payload_hash: payloadHash,
      },
    });
    if (enqErr) throw enqErr;

    console.log(`  ✓ ${mail.external_id}: ${mail.subject}`);
    ok++;
  }

  const { error: finErr } = await db.rpc("finish_integration_run", {
    p_run_id: runId,
    p_status: "success",
    p_records_in: mails.length,
    p_records_ok: ok,
    p_records_failed: mails.length - ok,
  });
  if (finErr) console.warn(`finish_integration_run: ${finErr.message}`);

  console.log(`\ndone. ${ok} mail(s) queued through the normalize pipeline.`);
  console.log(`runs will appear once worker-normalize + worker-automation tick (cron, ~30-120s).`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
