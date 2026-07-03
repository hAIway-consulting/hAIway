// Resets a claude-test sandbox org to the bare skeleton (org + tester user
// + profile + membership). Wipes all derived/feature data so each iteration
// starts from a clean slate.
//
//   node --env-file=apps/web/.env.local scripts/dev-loop/cleanup-test-org.mjs
//     → core sandbox claude-test
//   node --env-file=apps/web/.env.local scripts/dev-loop/cleanup-test-org.mjs --customer mamalila
//     → customer sandbox claude-test-mamalila
//
// Guard is a POSITIVE allowlist: the slug must start with "claude-test" AND
// the org must carry metadata.is_claude_test_org. Everything else (platform
// org, customer orgs) is refused — use scripts/ops for those, deliberately.

import { createClient } from "@supabase/supabase-js";

const customerArgIndex = process.argv.indexOf("--customer");
const CUSTOMER =
  customerArgIndex !== -1 ? process.argv[customerArgIndex + 1] : null;
if (customerArgIndex !== -1 && (!CUSTOMER || CUSTOMER.startsWith("--"))) {
  console.error("--customer requires a slug");
  process.exit(1);
}

const TEST_ORG_SLUG = CUSTOMER ? `claude-test-${CUSTOMER}` : "claude-test";

// Order matters: child rows before parent rows. Tables not present in this
// list are either irrelevant (e.g. plan_tier_features = global) or covered by
// ON DELETE CASCADE from one of the listed parents (e.g. process_*_steps,
// automation_step_runs via automation_runs).
const TENANT_TABLES_IN_DELETE_ORDER = [
  "chat_message_reviews",
  "chat_messages",
  "chat_conversations",
  "content_chunks",
  "source_links",
  "source_folder_access",
  "source_folders",
  "permission_group_members",
  "permission_groups",
  "sources",
  "entity_tags",
  "tags",
  "contacts",
  "companies",
  "projects",
  "activity_links",
  "activities",
  "process_instances",
  "process_templates",
  "kpi_events",
  "kpi_baselines",
  "connector_sync_log",
  "entity_mappings",
  "entities_calendar_events",
  "calendar_integrations",
  "phone_numbers",
  "phone_assistants",
  "call_logs",
  // automation engine
  "automation_step_runs",
  "automation_runs",
  "organization_automations",
  // pipeline
  "raw_events",
  "integration_runs",
  "job_failures",
  "rate_limit_buckets",
  "app_launch_events",
  // config
  "organization_integrations",
  "organization_features",
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Positive allowlist — refuse anything that is not a claude-test sandbox.
  if (!TEST_ORG_SLUG.startsWith("claude-test")) {
    throw new Error(`refusing "${TEST_ORG_SLUG}" — only claude-test* sandboxes`);
  }

  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, slug, metadata")
    .eq("slug", TEST_ORG_SLUG)
    .single();
  if (error) throw new Error(`org "${TEST_ORG_SLUG}" missing: ${error.message}`);
  if (!org.metadata?.is_claude_test_org) {
    throw new Error(`refusing to wipe org "${TEST_ORG_SLUG}" — metadata.is_claude_test_org missing`);
  }
  console.log(`target org ${org.id} (${org.slug})`);

  for (const table of TENANT_TABLES_IN_DELETE_ORDER) {
    const { count, error: delErr } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .eq("organization_id", org.id);
    if (delErr) {
      // Tables with no organization_id column are fine to skip silently.
      if (/column .*organization_id.* does not exist/i.test(delErr.message)) continue;
      console.warn(`  ! ${table}: ${delErr.message}`);
      continue;
    }
    if (count) console.log(`  - ${table}: ${count}`);
  }

  console.log("done. org/user/profile/membership left in place.");
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
