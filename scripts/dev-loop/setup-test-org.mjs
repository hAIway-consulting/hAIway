// Idempotent setup for the Claude-test sandbox org + tester user.
// Run with:  node --env-file=apps/web/.env.local scripts/dev-loop/setup-test-org.mjs
//
// Reads SUPABASE_SERVICE_ROLE_KEY from the env file. Uses admin auth API to
// create or rotate the tester credential and ensures profile + membership rows.

import { createClient } from "@supabase/supabase-js";

const ORG_SLUG = "claude-test";

// Credentials come from the environment only — a password that is valid in a
// real Supabase project does not belong in source.
const TESTER = {
  email: process.env.TEST_LOGIN_CLAUDE_TESTER_EMAIL,
  password: process.env.TEST_LOGIN_CLAUDE_TESTER_PASSWORD,
  full_name: "[CLAUDE-TEST] Tester",
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}
if (!TESTER.email || !TESTER.password) {
  console.error(
    "Missing TEST_LOGIN_CLAUDE_TESTER_EMAIL / TEST_LOGIN_CLAUDE_TESTER_PASSWORD in env.",
  );
  console.error(
    "Run with: node --env-file=apps/web/.env.local scripts/dev-loop/setup-test-org.mjs",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("id, slug, name")
    .eq("slug", ORG_SLUG)
    .single();
  if (orgErr) throw new Error(`org "${ORG_SLUG}" missing — create it first: ${orgErr.message}`);
  console.log(`✓ org   ${org.id}  ${org.slug}  ${org.name}`);

  let user;
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    user = data.users.find((u) => u.email === TESTER.email);
    if (user || data.users.length < 200) break;
    page += 1;
  }

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

  // CRM sandbox (tolerant: skipped until the crm_workspace migrations are
  // pushed). Enables the feature flag and wires the twenty provider to the
  // inline mock (base_url mock://twenty) so e2e/crm.spec.ts can run without
  // a Twenty instance or edge runtime.
  const { error: flagErr } = await supabase.from("organization_features").upsert(
    { organization_id: org.id, feature_key: "crm_workspace", enabled: true },
    { onConflict: "organization_id,feature_key" },
  );
  if (flagErr) {
    console.log(`- crm   skipped (${flagErr.message}) — run db push for the crm migrations first`);
  } else {
    const { error: integErr } = await supabase.from("organization_integrations").upsert(
      {
        organization_id: org.id,
        provider_id: "twenty",
        status: "active",
        credential_mode: "customer",
        credentials: { api_key: "mock-api-key" },
        config: {
          base_url: "mock://twenty",
          available_roles: [
            { id: "mock-role-admin", label: "Admin" },
            { id: "mock-role-member", label: "Member" },
          ],
          role_map: {
            member: { twenty_role_id: "mock-role-member", label: "Member" },
            admin: { twenty_role_id: "mock-role-admin", label: "Admin" },
          },
        },
        error_message: null,
      },
      { onConflict: "organization_id,provider_id" },
    );
    if (integErr) {
      console.log(`- crm   flag ok, integration skipped (${integErr.message})`);
    } else {
      console.log(`✓ crm   feature flag + mock twenty integration`);
    }
  }

  console.log(
    `\nReady. Login: ${TESTER.email} (Passwort aus TEST_LOGIN_CLAUDE_TESTER_PASSWORD)`,
  );
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
