// Creates a real customer organization via the onboard_organization_v2 RPC
// (plan features + pending integrations included). The owner must already
// exist as an auth user — create the account via the app first, then run this.
//
// Run with:
//   node --env-file=apps/web/.env.local scripts/ops/create-customer-org.mjs \
//     --slug mamalila --name "mamalila" --owner-email thomas@bernwald.net \
//     [--plan standard] [--features automations,foo] [--apply]

import { createServiceClient, parseFlags, getOrgBySlug, fail } from "./_lib.mjs";

const flags = parseFlags();
const supabase = createServiceClient();

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
  const slug = flags.slug;
  const name = flags.name;
  const ownerEmail = flags["owner-email"];
  const plan = typeof flags.plan === "string" ? flags.plan : "standard";
  const features =
    typeof flags.features === "string"
      ? flags.features.split(",").map((f) => f.trim()).filter(Boolean)
      : [];

  if (!slug || typeof slug !== "string") fail("--slug <slug> is required");
  if (!name || typeof name !== "string") fail("--name <name> is required");
  if (!ownerEmail || typeof ownerEmail !== "string") fail("--owner-email <email> is required");
  if (slug.startsWith("claude-test")) {
    fail(`slug "${slug}" looks like a sandbox — use create-sandbox-org.mjs instead`);
  }

  const existing = await getOrgBySlug(supabase, slug);
  if (existing) fail(`org "${slug}" already exists (id=${existing.id})`);

  const owner = await findUserByEmail(ownerEmail);
  if (!owner) {
    fail(`auth user "${ownerEmail}" not found — sign up via the app first, then re-run`);
  }

  console.log(`plan:     ${plan}`);
  console.log(`owner:    ${owner.email} (${owner.id})`);
  console.log(`features: ${features.length ? features.join(", ") : "(plan defaults only)"}`);

  if (flags.apply !== true) {
    console.log(`\ndry run — org "${slug}" was NOT created. Add --apply to execute.`);
    return;
  }

  const { data: orgId, error } = await supabase.rpc("onboard_organization_v2", {
    p_user_id: owner.id,
    p_org_name: name,
    p_org_slug: slug,
    p_plan_id: plan,
  });
  if (error) throw new Error(`onboard_organization_v2: ${error.message}`);
  console.log(`✓ org created: ${orgId} (${slug})`);

  for (const featureKey of features) {
    const { error: featErr } = await supabase
      .from("organization_features")
      .upsert(
        { organization_id: orgId, feature_key: featureKey, enabled: true },
        { onConflict: "organization_id,feature_key" }
      );
    if (featErr) console.warn(`  ! feature "${featureKey}": ${featErr.message}`);
    else console.log(`✓ feature enabled: ${featureKey}`);
  }

  console.log(`\ndone. review the org in the Berater-Cockpit (/admin/kunden).`);
}

main().catch((e) => fail(e?.message ?? e));
