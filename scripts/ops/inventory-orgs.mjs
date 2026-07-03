// Read-only inventory of all organizations: members, per-table row counts,
// storage objects. Run this BEFORE any wipe and review the output.
//
// Run with: node --env-file=apps/web/.env.local scripts/ops/inventory-orgs.mjs [--json]

import {
  CONTENT_TABLES_IN_DELETE_ORDER,
  CONFIG_TABLES_IN_DELETE_ORDER,
  createServiceClient,
  parseFlags,
  countOrgRows,
  listOrgStorageObjects,
  fail,
} from "./_lib.mjs";

const flags = parseFlags();
const supabase = createServiceClient();

const ALL_TABLES = [...CONTENT_TABLES_IN_DELETE_ORDER, ...CONFIG_TABLES_IN_DELETE_ORDER];

async function main() {
  const { data: orgs, error: orgErr } = await supabase
    .from("organizations")
    .select("id, slug, name, status, plan_id, is_platform, metadata, created_at")
    .order("created_at", { ascending: true });
  if (orgErr) throw orgErr;

  const { data: members, error: memErr } = await supabase
    .from("organization_members")
    .select("organization_id, user_id, role, is_default, profiles(email, full_name, metadata)");
  if (memErr) throw memErr;

  const report = { generated_at: new Date().toISOString(), orgs: [] };

  for (const org of orgs) {
    const orgMembers = (members ?? [])
      .filter((m) => m.organization_id === org.id)
      .map((m) => ({
        email: m.profiles?.email ?? m.user_id,
        role: m.role,
        is_default: m.is_default,
        is_claude_test_user: Boolean(m.profiles?.metadata?.is_claude_test_user),
      }));

    const tables = {};
    for (const table of ALL_TABLES) {
      const result = await countOrgRows(supabase, table, org.id);
      if (result === null) continue; // no organization_id column
      if (typeof result === "object") {
        tables[table] = `ERROR: ${result.error}`;
      } else if (result > 0) {
        tables[table] = result;
      }
    }

    let storageObjects = [];
    try {
      storageObjects = await listOrgStorageObjects(supabase, org.id);
    } catch (e) {
      storageObjects = [`ERROR: ${e.message}`];
    }

    report.orgs.push({
      id: org.id,
      slug: org.slug,
      name: org.name,
      status: org.status,
      plan_id: org.plan_id,
      is_platform: org.is_platform,
      is_claude_test_org: Boolean(org.metadata?.is_claude_test_org),
      sandbox_for: org.metadata?.sandbox_for ?? null,
      created_at: org.created_at,
      members: orgMembers,
      row_counts: tables,
      storage_object_count: storageObjects.length,
    });
  }

  // Orphaned auth users (no org membership) — candidates for review.
  const memberUserIds = new Set((members ?? []).map((m) => m.user_id));
  const orphans = [];
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      if (!memberUserIds.has(u.id)) orphans.push({ id: u.id, email: u.email });
    }
    if (data.users.length < 200) break;
    page += 1;
  }
  report.orphan_users = orphans;

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const org of report.orgs) {
    const badges = [
      org.is_platform ? "PLATFORM" : null,
      org.is_claude_test_org ? "SANDBOX" : null,
      org.sandbox_for ? `for:${org.sandbox_for}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`\n═══ ${org.slug} ${badges ? `[${badges}]` : ""}`);
    console.log(`    id=${org.id}  plan=${org.plan_id}  status=${org.status}  created=${org.created_at?.slice(0, 10)}`);
    for (const m of org.members) {
      console.log(`    member  ${m.email}  ${m.role}${m.is_default ? " (default)" : ""}${m.is_claude_test_user ? "  [test-user]" : ""}`);
    }
    const entries = Object.entries(org.row_counts);
    if (entries.length === 0) {
      console.log(`    (no content rows)`);
    } else {
      for (const [table, count] of entries) console.log(`    ${String(count).padStart(8)}  ${table}`);
    }
    console.log(`    ${String(org.storage_object_count).padStart(8)}  storage objects (${org.id}/)`);
  }

  if (report.orphan_users.length > 0) {
    console.log(`\n═══ auth users without any org membership:`);
    for (const u of report.orphan_users) console.log(`    ${u.id}  ${u.email}`);
  }
  console.log(`\ndone. read-only — nothing was modified.`);
}

main().catch((e) => fail(e?.message ?? e));
