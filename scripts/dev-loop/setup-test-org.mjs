// Idempotent setup for a Claude-test sandbox org + tester user.
//
//   node --env-file=apps/web/.env.local scripts/dev-loop/setup-test-org.mjs
//     → core sandbox: org claude-test, tester claude-tester@bernwald.net
//
//   node --env-file=apps/web/.env.local scripts/dev-loop/setup-test-org.mjs --customer mamalila
//     → customer sandbox: org claude-test-mamalila,
//       tester claude-tester+mamalila@bernwald.net
//
// Creates the org itself if missing (onboard_organization_v2 RPC), stamps
// metadata.is_claude_test_org (required by the cleanup guard) and ensures
// profile + membership. Reads SUPABASE_SERVICE_ROLE_KEY from the env file.
//
// After a customer setup, sync config + seeds:
//   node --env-file=apps/web/.env.local scripts/customers/sync-customer.mts --customer <slug> --org claude-test-<slug> --apply
//   node --env-file=apps/web/.env.local scripts/customers/seed-sandbox.mts --customer <slug> --apply

import { createClient } from "@supabase/supabase-js";

const customerArgIndex = process.argv.indexOf("--customer");
const CUSTOMER =
  customerArgIndex !== -1 ? process.argv[customerArgIndex + 1] : null;
if (customerArgIndex !== -1 && (!CUSTOMER || CUSTOMER.startsWith("--"))) {
  console.error("--customer requires a slug (lowercase, digits, dashes)");
  process.exit(1);
}
if (CUSTOMER && !/^[a-z0-9-]+$/.test(CUSTOMER)) {
  console.error(`invalid customer slug "${CUSTOMER}"`);
  process.exit(1);
}

const ORG_SLUG = CUSTOMER ? `claude-test-${CUSTOMER}` : "claude-test";
const ORG_NAME = CUSTOMER ? `[CLAUDE-TEST] ${CUSTOMER}` : "[CLAUDE-TEST] Sandbox";
const ORG_PLAN = "standard";
const TESTER = {
  email: CUSTOMER
    ? `claude-tester+${CUSTOMER}@bernwald.net`
    : "claude-tester@bernwald.net",
  password: "Test1234!",
  full_name: CUSTOMER ? `[CLAUDE-TEST] Tester ${CUSTOMER}` : "[CLAUDE-TEST] Tester",
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function main() {
  // 1. Tester user (create or rotate password).
  let user = await findUserByEmail(TESTER.email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: TESTER.email,
      password: TESTER.password,
      email_confirm: true,
      user_metadata: { full_name: TESTER.full_name },
    });
    if (error) throw error;
    user = data.user;
    console.log(`✓ user  ${user.id}  created`);
  } else {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: TESTER.password,
      email_confirm: true,
    });
    if (error) throw error;
    console.log(`✓ user  ${user.id}  rotated password`);
  }

  const { error: profileErr } = await supabase.from("profiles").upsert({
    id: user.id,
    email: TESTER.email,
    full_name: TESTER.full_name,
    metadata: { is_claude_test_user: true },
  });
  if (profileErr) throw profileErr;
  console.log(`✓ profile`);

  // 2. Org — create via the standard onboarding RPC if missing.
  let { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("id, slug, name, metadata")
    .eq("slug", ORG_SLUG)
    .maybeSingle();
  if (orgErr) throw orgErr;

  if (!org) {
    const { data: orgId, error } = await supabase.rpc("onboard_organization_v2", {
      p_user_id: user.id,
      p_org_name: ORG_NAME,
      p_org_slug: ORG_SLUG,
      p_plan_id: ORG_PLAN,
    });
    if (error) throw new Error(`onboard_organization_v2: ${error.message}`);
    const refetch = await supabase
      .from("organizations")
      .select("id, slug, name, metadata")
      .eq("id", orgId)
      .single();
    if (refetch.error) throw refetch.error;
    org = refetch.data;
    console.log(`✓ org   ${org.id}  created (${ORG_SLUG})`);
  } else {
    console.log(`✓ org   ${org.id}  exists (${org.slug})`);
  }

  // 3. Sandbox markers — cleanup-test-org.mjs refuses orgs without them.
  const { error: metaErr } = await supabase
    .from("organizations")
    .update({
      metadata: {
        ...(org.metadata ?? {}),
        is_claude_test_org: true,
        ...(CUSTOMER ? { sandbox_for: CUSTOMER } : {}),
      },
    })
    .eq("id", org.id);
  if (metaErr) throw metaErr;
  console.log(`✓ metadata  is_claude_test_org=true${CUSTOMER ? `, sandbox_for=${CUSTOMER}` : ""}`);

  // 4. Membership (created by the RPC on first run; ensure on re-runs).
  const { data: existing } = await supabase
    .from("organization_members")
    .select("id, role, is_default")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase.from("organization_members").insert({
      organization_id: org.id,
      user_id: user.id,
      role: "admin",
      is_default: true,
    });
    if (error) throw error;
    console.log(`✓ member  admin (default)`);
  } else {
    console.log(`✓ member  exists (role=${existing.role}, default=${existing.is_default})`);
  }

  console.log(`\nReady. Login: ${TESTER.email} / ${TESTER.password}`);
  if (CUSTOMER) {
    console.log(`Next: sync config + seeds —`);
    console.log(`  node --env-file=apps/web/.env.local scripts/customers/sync-customer.mts --customer ${CUSTOMER} --org ${ORG_SLUG} --apply`);
    console.log(`  node --env-file=apps/web/.env.local scripts/customers/seed-sandbox.mts --customer ${CUSTOMER} --apply`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
