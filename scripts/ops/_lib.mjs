// Shared helpers for the ops scripts (inventory / wipe / org creation).
// All scripts run with: node --env-file=apps/web/.env.local scripts/ops/<script>.mjs

import { createClient } from "@supabase/supabase-js";

// Org-scoped content tables in FK-safe delete order (child rows before parents).
// Superset of scripts/dev-loop/cleanup-test-org.mjs plus the pipeline tables.
// Tables without an organization_id column are skipped gracefully by callers.
//
// Ordering constraints that actually matter:
//   chat_message_reviews -> chat_messages -> chat_conversations
//   ai_usage_events.ref_id points at chat_messages / agent_runs without an FK,
//     so it goes first — the pointers must not outlive their targets.
//   agent_runs.conversation_id -> chat_conversations, .saved_agent_id ->
//     saved_agents; saved_agents.source_conversation_id -> chat_conversations.
//   content_chunks / source_links -> sources
//   source_folder_access -> source_folders / permission_groups
//   contacts -> companies
//   process_instance_steps / process_template_steps have no organization_id;
//     they are removed via ON DELETE CASCADE from their parents below.
export const CONTENT_TABLES_IN_DELETE_ORDER = [
  // chat + AI bookkeeping (children first)
  "chat_message_reviews",
  "ai_usage_events",
  "agent_runs",
  "saved_agents",
  "chat_messages",
  "chat_conversations",
  // knowledge base
  "content_chunks",
  "source_links",
  "source_folder_access",
  "source_folders",
  "permission_group_members",
  "permission_groups",
  "sources",
  // operative data
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
  "call_logs",
  // per-member app access (e.g. CRM grants)
  "member_app_permissions",
  // pipeline tables (Bronze + run bookkeeping)
  "raw_events",
  "integration_runs",
  "job_failures",
  "rate_limit_buckets",
  "app_launch_events",
];

// Config/infrastructure tables are only wiped when explicitly requested
// (--include-config): for the platform org these hold real integration
// credentials, encrypted model keys and live phone/calendar wiring.
// ai_provider_keys.organization_id is NULLABLE (NULL = platform-wide key); the
// callers filter by .eq("organization_id", orgId), so platform keys are never
// touched by an org wipe.
export const CONFIG_TABLES_IN_DELETE_ORDER = [
  "ai_provider_keys",
  "calendar_integrations",
  "phone_numbers",
  "phone_assistants",
  "organization_integrations",
  "organization_features",
];

export const STORAGE_BUCKET = "source-files";

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
    console.error("Run with: node --env-file=apps/web/.env.local scripts/ops/<script>.mjs");
    process.exit(1);
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Tiny flag parser: --key value | --key=value | --flag (boolean true).
export function parseFlags(argv = process.argv.slice(2)) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[arg.slice(2)] = next;
        i++;
      } else {
        flags[arg.slice(2)] = true;
      }
    }
  }
  return flags;
}

export async function getOrgBySlug(supabase, slug) {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, slug, name, status, plan_id, is_platform, metadata, created_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`lookup org "${slug}": ${error.message}`);
  return data;
}

export async function countOrgRows(supabase, table, orgId) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId);
  if (error) {
    if (/column .*organization_id.* does not exist/i.test(error.message)) return null;
    return { error: error.message };
  }
  return count ?? 0;
}

// Lists all storage objects under the org's prefix (paginated).
export async function listOrgStorageObjects(supabase, orgId) {
  const paths = [];
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(orgId, { limit: pageSize, offset });
    if (error) throw new Error(`storage list ${orgId}/: ${error.message}`);
    for (const obj of data ?? []) {
      if (obj.id) paths.push(`${orgId}/${obj.name}`);
    }
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }
  return paths;
}

export function fail(message) {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}
