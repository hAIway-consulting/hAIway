// Syncs automation templates (customers/_templates) and a customer's config
// (customers/<slug>/customer.json) into the database. The repo is the source
// of truth; the DB is the runtime truth.
//
// Versioning: definitions are content-hashed (sha256 over a stable
// stringify). A changed hash inserts a NEW automation_template_versions row
// and bumps current_version — existing versions are never rewritten, so
// runs stay auditable against the exact definition they executed.
//
// Requires Node >= 23.6 (built-in TypeScript type stripping) — it imports
// the Zod schemas from @haiway/contracts directly, so worker and sync
// validate against the same source.
//
// Run with:
//   node --env-file=apps/web/.env.local scripts/customers/sync-customer.mts \
//     --customer mamalila [--org claude-test-mamalila] [--apply] [--validate-only]
//
// Default is a dry run (prints the diff). --validate-only skips all DB access.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { automationDefinitionSchema } from "@haiway/contracts/automations";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATES_DIR = join(REPO_ROOT, "customers", "_templates");
const CUSTOMERS_DIR = join(REPO_ROOT, "customers");

// ─── args ────────────────────────────────────────────────────────────────

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

const validateOnly = flags["validate-only"] === true;
const apply = flags.apply === true;
const customerSlug = typeof flags.customer === "string" ? flags.customer : null;

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

// ─── stable hash (sorted keys, matches _shared/worker.ts semantics) ──────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ─── template loading ────────────────────────────────────────────────────

interface LoadedTemplate {
  id: string;
  meta: {
    name: string;
    description: string;
    required_providers: string[];
    feature_key: string | null;
  };
  definition: Record<string, unknown>;
  hash: string;
}

// Recursively strips $comment keys and inlines "@prompts/<file>" strings.
function prepare(node: unknown, templateDir: string): unknown {
  if (typeof node === "string") {
    if (node.startsWith("@prompts/")) {
      const promptPath = join(templateDir, "prompts", node.slice("@prompts/".length));
      if (!existsSync(promptPath)) throw new Error(`prompt file missing: ${promptPath}`);
      return readFileSync(promptPath, "utf8").trim();
    }
    return node;
  }
  if (Array.isArray(node)) return node.map((item) => prepare(item, templateDir));
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$comment" || key === "$meta") continue;
      out[key] = prepare(value, templateDir);
    }
    return out;
  }
  return node;
}

function loadTemplates(): LoadedTemplate[] {
  const templates: LoadedTemplate[] = [];
  for (const id of readdirSync(TEMPLATES_DIR)) {
    const templateDir = join(TEMPLATES_DIR, id);
    const defPath = join(templateDir, "definition.json");
    if (!existsSync(defPath)) continue;

    const raw = JSON.parse(readFileSync(defPath, "utf8")) as Record<string, unknown>;
    const metaRaw = (raw.$meta ?? {}) as Record<string, unknown>;
    if (!metaRaw.name) fail(`${id}/definition.json: $meta.name missing`);

    const cleaned = prepare(raw, templateDir);
    const parsed = automationDefinitionSchema.safeParse(cleaned);
    if (!parsed.success) {
      fail(`${id}/definition.json invalid:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
    }

    const definition = parsed.data as unknown as Record<string, unknown>;
    templates.push({
      id,
      meta: {
        name: String(metaRaw.name),
        description: String(metaRaw.description ?? ""),
        required_providers: Array.isArray(metaRaw.required_providers)
          ? metaRaw.required_providers.map(String)
          : [],
        feature_key: metaRaw.feature_key ? String(metaRaw.feature_key) : null,
      },
      definition,
      hash: sha256(stableStringify(definition)),
    });
  }
  return templates;
}

// ─── customer config ─────────────────────────────────────────────────────

interface CustomerConfig {
  slug: string;
  features: string[];
  automations: Record<string, { params?: Record<string, unknown> }>;
}

function loadCustomer(slug: string): CustomerConfig {
  const path = join(CUSTOMERS_DIR, slug, "customer.json");
  if (!existsSync(path)) fail(`customers/${slug}/customer.json not found`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return {
    slug: String(raw.slug ?? slug),
    features: Array.isArray(raw.features) ? raw.features.map(String) : [],
    automations: (raw.automations ?? {}) as CustomerConfig["automations"],
  };
}

// Per-org prompt overrides: customers/<slug>/prompts/<template_id>/<step_key>.md
// land in organization_automations.params.prompts.<step_key>.
function loadPromptOverrides(slug: string, templateId: string): Record<string, string> {
  const dir = join(CUSTOMERS_DIR, slug, "prompts", templateId);
  if (!existsSync(dir)) return {};
  const overrides: Record<string, string> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    overrides[file.replace(/\.md$/, "")] = readFileSync(join(dir, file), "utf8").trim();
  }
  return overrides;
}

// ─── db sync ─────────────────────────────────────────────────────────────

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

async function syncTemplate(db: SupabaseClient, tpl: LoadedTemplate): Promise<void> {
  const { data: existing, error } = await db
    .from("automation_templates")
    .select("id, current_version")
    .eq("id", tpl.id)
    .maybeSingle<{ id: string; current_version: number }>();
  if (error) throw error;

  if (!existing) {
    console.log(`  + template ${tpl.id} @ v1 (${tpl.hash.slice(0, 12)})`);
    if (!apply) return;
    const { error: insErr } = await db.from("automation_templates").insert({
      id: tpl.id,
      name: tpl.meta.name,
      description: tpl.meta.description,
      current_version: 1,
      required_providers: tpl.meta.required_providers,
      feature_key: tpl.meta.feature_key,
    });
    if (insErr) throw insErr;
    const { error: verErr } = await db.from("automation_template_versions").insert({
      template_id: tpl.id,
      version: 1,
      definition: tpl.definition,
      definition_hash: tpl.hash,
    });
    if (verErr) throw verErr;
    return;
  }

  const { data: currentVer, error: verSelErr } = await db
    .from("automation_template_versions")
    .select("definition_hash")
    .eq("template_id", tpl.id)
    .eq("version", existing.current_version)
    .maybeSingle<{ definition_hash: string }>();
  if (verSelErr) throw verSelErr;

  if (currentVer?.definition_hash === tpl.hash) {
    console.log(`  = template ${tpl.id} @ v${existing.current_version} unchanged`);
    return;
  }

  const nextVersion = existing.current_version + 1;
  console.log(`  ^ template ${tpl.id}: v${existing.current_version} -> v${nextVersion} (${tpl.hash.slice(0, 12)})`);
  if (!apply) return;

  const { error: verInsErr } = await db.from("automation_template_versions").insert({
    template_id: tpl.id,
    version: nextVersion,
    definition: tpl.definition,
    definition_hash: tpl.hash,
  });
  if (verInsErr) throw verInsErr;

  const { error: updErr } = await db
    .from("automation_templates")
    .update({
      name: tpl.meta.name,
      description: tpl.meta.description,
      required_providers: tpl.meta.required_providers,
      feature_key: tpl.meta.feature_key,
      current_version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tpl.id);
  if (updErr) throw updErr;
}

async function syncOrg(
  db: SupabaseClient,
  customer: CustomerConfig,
  orgSlug: string,
  templates: LoadedTemplate[],
): Promise<void> {
  const { data: org, error } = await db
    .from("organizations")
    .select("id, slug")
    .eq("slug", orgSlug)
    .maybeSingle<{ id: string; slug: string }>();
  if (error) throw error;
  if (!org) fail(`org "${orgSlug}" not found — create it first (scripts/ops)`);

  console.log(`\norg ${org.id} (${org.slug}):`);

  for (const featureKey of customer.features) {
    console.log(`  ~ feature ${featureKey} -> enabled`);
    if (!apply) continue;
    const { error: featErr } = await db
      .from("organization_features")
      .upsert(
        { organization_id: org.id, feature_key: featureKey, enabled: true },
        { onConflict: "organization_id,feature_key" },
      );
    if (featErr) throw featErr;
  }

  for (const [templateId, cfg] of Object.entries(customer.automations)) {
    if (!templates.some((t) => t.id === templateId)) {
      fail(`customer.json references unknown template "${templateId}"`);
    }
    const promptOverrides = loadPromptOverrides(customer.slug, templateId);
    const params: Record<string, unknown> = { ...(cfg.params ?? {}) };
    if (Object.keys(promptOverrides).length > 0) {
      params.prompts = { ...(params.prompts as object ?? {}), ...promptOverrides };
    }

    const { data: existing, error: oaErr } = await db
      .from("organization_automations")
      .select("id, status")
      .eq("organization_id", org.id)
      .eq("template_id", templateId)
      .maybeSingle<{ id: string; status: string }>();
    if (oaErr) throw oaErr;

    if (!existing) {
      console.log(`  + automation ${templateId} (draft) params=${JSON.stringify(params)}`);
      if (!apply) continue;
      const { error: insErr } = await db.from("organization_automations").insert({
        organization_id: org.id,
        template_id: templateId,
        status: "draft",
        params,
      });
      if (insErr) throw insErr;
    } else {
      // Never touch status from the repo — activation is a Cockpit decision.
      console.log(`  ~ automation ${templateId} (status stays ${existing.status}) params updated`);
      if (!apply) continue;
      const { error: updErr } = await db
        .from("organization_automations")
        .update({ params, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (updErr) throw updErr;
    }
  }
}

// ─── main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const templates = loadTemplates();
  console.log(`validated ${templates.length} template(s): ${templates.map((t) => t.id).join(", ")}`);

  if (validateOnly) {
    if (customerSlug) {
      const customer = loadCustomer(customerSlug);
      for (const templateId of Object.keys(customer.automations)) {
        if (!templates.some((t) => t.id === templateId)) {
          fail(`customer.json references unknown template "${templateId}"`);
        }
      }
      console.log(`validated customers/${customerSlug}/customer.json`);
    }
    console.log("validate-only: no DB access.");
    return;
  }

  const db = createServiceClient();

  console.log(`\ntemplates (${apply ? "APPLY" : "dry run"}):`);
  for (const tpl of templates) {
    await syncTemplate(db, tpl);
  }

  if (customerSlug) {
    const customer = loadCustomer(customerSlug);
    const orgSlug = typeof flags.org === "string" ? flags.org : customer.slug;
    await syncOrg(db, customer, orgSlug, templates);
  }

  if (!apply) console.log(`\ndry run complete. Add --apply to write.`);
  else console.log(`\ndone.`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
