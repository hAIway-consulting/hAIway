"use server";

// Server actions for the cross-tenant skill library
// (docs/spec-admin-dashboard.md §4). STRICT platform gate on every action;
// library rows (organization_id IS NULL) are written via service role only —
// the skills RLS insert policy covers tenant rows exclusively.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { createServiceClient } from "@/lib/db/supabase-server";

const ROUTE = "/admin/bibliothek/skills";

async function requireAdmin() {
  const isAdmin = await isPlatformAdmin().catch(() => false);
  if (!isAdmin) throw new Error("Unauthorized");
}

function fail(message: string): never {
  redirect(`${ROUTE}?error=${encodeURIComponent(message)}`);
}

function done(message: string): never {
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?ok=${encodeURIComponent(message)}`);
}

export async function createLibrarySkill(formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const promptTemplate = String(formData.get("prompt_template") ?? "").trim();
  if (!name) fail("Name ist ein Pflichtfeld.");
  if (!promptTemplate) fail("Prompt-Template ist ein Pflichtfeld.");

  const toolRefs = String(formData.get("tool_refs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const db = createServiceClient();
  const { error } = await db.from("skills").insert({
    organization_id: null,
    name,
    description: String(formData.get("description") ?? "").trim(),
    industry_scope: String(formData.get("industry_scope") ?? "").trim() || null,
    prompt_template: promptTemplate,
    tool_refs: toolRefs,
    status: "draft",
  });

  if (error) fail(`Skill anlegen fehlgeschlagen: ${error.message}`);
  done(`Bibliotheks-Skill „${name}“ als Entwurf angelegt.`);
}

/**
 * Rollout (admin spec §4): copies a library skill tenant-scoped with status
 * 'draft'. The assignment alone activates NOTHING for the customer — the
 * consultant reviews and releases it in the Berater-Dashboard (Berater
 * bleibt im Lead).
 */
export async function assignSkillToOrg(skillId: string, formData: FormData) {
  await requireAdmin();

  const orgId = String(formData.get("organization_id") ?? "").trim();
  if (!orgId) fail("Bitte zuerst einen Kunden auswählen.");

  const db = createServiceClient();
  const { data: skill } = await db
    .from("skills")
    .select("id, name, description, industry_scope, prompt_template, tool_refs, code_ref, version")
    .eq("id", skillId)
    .is("organization_id", null)
    .maybeSingle();
  if (!skill) fail("Bibliotheks-Skill nicht gefunden.");

  // No DB unique constraint on (org, name) — guard against double rollout.
  const { data: existing } = await db
    .from("skills")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", skill.name)
    .limit(1);
  if (existing && existing.length > 0) {
    fail(`Skill „${skill.name}“ ist diesem Kunden bereits zugewiesen.`);
  }

  const { error } = await db.from("skills").insert({
    organization_id: orgId,
    name: skill.name,
    description: skill.description,
    industry_scope: skill.industry_scope,
    prompt_template: skill.prompt_template,
    tool_refs: skill.tool_refs,
    code_ref: skill.code_ref,
    version: skill.version,
    status: "draft",
  });

  if (error) fail(`Zuweisen fehlgeschlagen: ${error.message}`);
  done(`Skill „${skill.name}“ als Entwurf zugewiesen — Freigabe übernimmt der Berater.`);
}
