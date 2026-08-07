// Creates a per-customer dev sandbox org (claude-test-<customer>) plus its
// tester user. Idempotent: safe to re-run, rotates the tester password.
//
// Naming derives from --for:
//   slug   claude-test-<customer>
//   name   [CLAUDE-TEST] <customer>
//   tester claude-tester+<customer>@bernwald.net / $SANDBOX_TESTER_PASSWORD
//
// Run with:
//   node --env-file=apps/web/.env.local scripts/ops/create-sandbox-org.mjs --for mamalila [--plan standard] [--apply]

import { createServiceClient, parseFlags, getOrgBySlug, fail } from "./_lib.mjs";

const flags = parseFlags();
const supabase = createServiceClient();

async function main() {
  const customer = flags.for;
  if (!customer || typeof customer !== "string" || !/^[a-z0-9-]+$/.test(customer)) {
    fail("--for <customer-slug> is required (lowercase, digits, dashes)");
  }
  const plan = typeof flags.plan === "string" ? flags.plan : "standard";
  const slug = `claude-test-${customer}`;
  const name = `[CLAUDE-TEST] ${customer}`;
  // Password from the environment only — never a literal in the repo.
  const testerPassword = process.env.SANDBOX_TESTER_PASSWORD;
  if (!testerPassword) {
    fail(
      "SANDBOX_TESTER_PASSWORD is required — set it in apps/web/.env.local (never in the repo) and run with --env-file=apps/web/.env.local",
    );
  }
  const tester = {
    email: `claude-tester+${customer}@bernwald.net`,
    password: testerPassword,
    full_name: `[CLAUDE-TEST] Tester ${customer}`,
  };

  console.log(`sandbox:  ${slug} ("${name}", plan=${plan}, sandbox_for=${customer})`);
  console.log(`tester:   ${tester.email}`);

  if (flags.apply !== true) {
    console.log(`\ndry run — nothing created. Add --apply to execute.`);
    return;
  }

  // 1. Tester user (create or rotate password), mirrors scripts/dev-loop/setup-test-org.mjs.
  let user;
  {
    let page = 1;
    for (;;) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      user = data.users.find((u) => u.email?.toLowerCase() === tester.email.toLowerCase());
      if (user || data.users.length < 200) break;
      page += 1;
    }
  }
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: tester.email,
      password: tester.password,
      email_confirm: true,
      user_metadata: { full_name: tester.full_name },
    });
    if (error) throw error;
    user = data.user;
    console.log(`✓ user    ${user.id} created`);
  } else {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: tester.password,
      email_confirm: true,
    });
    if (error) throw error;
    console.log(`✓ user    ${user.id} password rotated`);
  }

  const { error: profileErr } = await supabase.from("profiles").upsert({
    id: user.id,
    email: tester.email,
    full_name: tester.full_name,
    metadata: { is_claude_test_user: true },
  });
  if (profileErr) throw profileErr;
  console.log(`✓ profile`);

  // 2. Org via the standard onboarding RPC (idempotent: skip if slug exists).
  let org = await getOrgBySlug(supabase, slug);
  if (!org) {
    const { data: orgId, error } = await supabase.rpc("onboard_organization_v2", {
      p_user_id: user.id,
      p_org_name: name,
      p_org_slug: slug,
      p_plan_id: plan,
    });
    if (error) throw new Error(`onboard_organization_v2: ${error.message}`);
    org = await getOrgBySlug(supabase, slug);
    console.log(`✓ org     ${orgId} created`);
  } else {
    console.log(`✓ org     ${org.id} exists`);
  }

  // 3. Sandbox markers — the cleanup guard requires metadata.is_claude_test_org.
  const { error: metaErr } = await supabase
    .from("organizations")
    .update({
      metadata: {
        ...(org.metadata ?? {}),
        is_claude_test_org: true,
        sandbox_for: customer,
      },
    })
    .eq("id", org.id);
  if (metaErr) throw metaErr;
  console.log(`✓ metadata  is_claude_test_org=true, sandbox_for=${customer}`);

  // 4. Membership (RPC creates it on first run; ensure on re-runs).
  const { data: member } = await supabase
    .from("organization_members")
    .select("id, role")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    const { error } = await supabase.from("organization_members").insert({
      organization_id: org.id,
      user_id: user.id,
      role: "admin",
      is_default: true,
    });
    if (error) throw error;
    console.log(`✓ member  admin (default)`);
  } else {
    console.log(`✓ member  exists (role=${member.role})`);
  }

  console.log(`\nready. login: ${tester.email} (Passwort aus SANDBOX_TESTER_PASSWORD)`);
  console.log(`org id: ${org.id} — add it to the sandbox matrix in CLAUDE.md.`);
}

main().catch((e) => fail(e?.message ?? e));
