// Wipes all org-scoped CONTENT from one organization. Never touches the org
// row itself, its members, or profiles — unless --drop-org is set, which
// removes the organization row entirely (memberships/config cascade with it).
// Config tables (organization_integrations, organization_features) are only
// wiped with --include-config.
//
// Safety model:
//   - default is a dry run (prints row counts, deletes nothing)
//   - --apply is required to delete
//   - --confirm <slug> must repeat the org slug exactly
//   - orgs with is_platform=true additionally require --allow-platform
//   - --drop-org refuses platform and sandbox orgs outright
//
// Run with:
//   node --env-file=apps/web/.env.local scripts/ops/wipe-org-content.mjs --org <slug> [--confirm <slug> --apply] [--include-config] [--allow-platform] [--drop-org]

import {
  CONTENT_TABLES_IN_DELETE_ORDER,
  CONFIG_TABLES_IN_DELETE_ORDER,
  STORAGE_BUCKET,
  createServiceClient,
  parseFlags,
  getOrgBySlug,
  countOrgRows,
  listOrgStorageObjects,
  fail,
} from "./_lib.mjs";

const flags = parseFlags();
const supabase = createServiceClient();

async function main() {
  if (!flags.org || typeof flags.org !== "string") {
    fail("--org <slug> is required");
  }

  const org = await getOrgBySlug(supabase, flags.org);
  if (!org) fail(`org "${flags.org}" not found`);

  if (org.is_platform && !flags["allow-platform"]) {
    fail(`org "${org.slug}" is the platform org — refusing without --allow-platform`);
  }

  if (flags["drop-org"]) {
    if (org.is_platform) fail(`--drop-org refused: "${org.slug}" is the platform org`);
    if (org.metadata?.is_claude_test_org) {
      fail(`--drop-org refused: "${org.slug}" is a sandbox — use cleanup-test-org.mjs instead`);
    }
  }

  const apply = flags.apply === true;
  if (apply && flags.confirm !== org.slug) {
    fail(`--apply requires --confirm ${org.slug} (got: ${flags.confirm ?? "nothing"})`);
  }

  const tables = [
    ...CONTENT_TABLES_IN_DELETE_ORDER,
    ...(flags["include-config"] ? CONFIG_TABLES_IN_DELETE_ORDER : []),
  ];

  console.log(`target org ${org.id} (${org.slug})${org.is_platform ? " [PLATFORM]" : ""}`);
  console.log(`mode: ${apply ? "APPLY — deleting rows" : "dry run — nothing will be deleted"}`);
  console.log(`config tables: ${flags["include-config"] ? "INCLUDED" : "kept (use --include-config to wipe)"}\n`);

  let total = 0;
  for (const table of tables) {
    if (!apply) {
      const result = await countOrgRows(supabase, table, org.id);
      if (result === null) continue;
      if (typeof result === "object") {
        console.warn(`  ! ${table}: ${result.error}`);
        continue;
      }
      if (result > 0) {
        console.log(`  would delete ${String(result).padStart(6)}  ${table}`);
        total += result;
      }
      continue;
    }

    const { count, error } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .eq("organization_id", org.id);
    if (error) {
      if (/column .*organization_id.* does not exist/i.test(error.message)) continue;
      console.warn(`  ! ${table}: ${error.message}`);
      continue;
    }
    if (count) {
      console.log(`  deleted ${String(count).padStart(6)}  ${table}`);
      total += count;
    }
  }

  // Storage: everything under <orgId>/ in the source-files bucket.
  const storagePaths = await listOrgStorageObjects(supabase, org.id);
  if (storagePaths.length > 0) {
    if (apply) {
      const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths);
      if (error) console.warn(`  ! storage: ${error.message}`);
      else console.log(`  deleted ${String(storagePaths.length).padStart(6)}  storage objects`);
    } else {
      console.log(`  would delete ${String(storagePaths.length).padStart(6)}  storage objects`);
    }
  }

  // Optional: remove the organization row itself (members/config cascade).
  if (flags["drop-org"]) {
    if (apply) {
      const { error } = await supabase.from("organizations").delete().eq("id", org.id);
      if (error) fail(`drop org: ${error.message}`);
      console.log(`  dropped org row ${org.id} (members/config cascaded)`);
    } else {
      console.log(`  would drop org row ${org.id} (members/config cascade)`);
    }
  }

  console.log(
    `\n${apply ? "done" : "dry run complete"}: ${total} rows, ${storagePaths.length} storage objects.` +
      (flags["drop-org"] ? "" : " org/members/profiles untouched.")
  );
  if (!apply) {
    console.log(`to execute: add --apply --confirm ${org.slug}`);
  }
}

main().catch((e) => fail(e?.message ?? e));
