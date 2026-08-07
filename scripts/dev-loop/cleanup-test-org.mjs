// Resets the claude-test sandbox org to the bare skeleton (org + tester user
// + profile + membership). Wipes all derived/feature data so each iteration
// starts from a clean slate.
//
// Run with: node --env-file=apps/web/.env.local scripts/dev-loop/cleanup-test-org.mjs

import { createClient } from "@supabase/supabase-js";

const TEST_ORG_SLUG = "claude-test";

// Order matters: child rows before parent rows. Tables not present in this
// list are either irrelevant (e.g. plan_tier_features = global) or covered by
// ON DELETE CASCADE from one of the listed parents.
// ai_usage_events.ref_id points at chat_messages / agent_runs without an FK, so
// it is deleted before them. agent_runs and saved_agents both reference
// chat_conversations and must precede it.
const TENANT_TABLES_IN_DELETE_ORDER = [
  "chat_message_reviews",
  "ai_usage_events",
  "agent_runs",
  "saved_agents",
  "chat_messages",
  "chat_conversations",
  "content_chunks",
  "source_links",
  "source_folder_access",
  "source_folders",
  "permission_group_members",
  "permission_groups",
  "sources",
  "contacts",
  "companies",
  "projects",
  "activity_links",
  "activities",
  "kpi_events",
  "connector_sync_log",
  "calendar_integrations",
  "phone_numbers",
  "phone_assistants",
  "call_logs",
  "member_app_permissions",
  "raw_events",
  "integration_runs",
  "job_failures",
  "app_launch_events",
  "ai_provider_keys",
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
