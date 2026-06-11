"use server";

// Server actions for the cross-tenant automation library
// (docs/spec-admin-dashboard.md §3). Every action re-checks the STRICT
// platform gate — the soft /admin layout gate (org admins pass) is
// deliberately not trusted here (admin spec §7). All writes go through the
// service client; automation_templates has no client write policies.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { createServiceClient } from "@/lib/db/supabase-server";

const ROUTE = "/admin/bibliothek/automatisierungen";

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

function parseList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses the default_config textarea; null = invalid (not a JSON object). */
function parseConfig(raw: FormDataEntryValue | null): Record<string, unknown> | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function createTemplate(formData: FormData) {
  await requireAdmin();

  const key = String(formData.get("key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!key || !name) fail("Key und Name sind Pflichtfelder.");

  const defaultConfig = parseConfig(formData.get("default_config"));
  if (defaultConfig === null) fail("Default-Konfiguration ist kein gültiges JSON-Objekt.");

  const db = createServiceClient();
  const { error } = await db.from("automation_templates").insert({
    key,
    name,
    description: String(formData.get("description") ?? "").trim(),
    requires: parseList(formData.get("requires")),
    default_config: defaultConfig,
    industry_tag: String(formData.get("industry_tag") ?? "").trim() || null,
  });

  if (error) {
    fail(
      error.code === "23505"
        ? `Template mit Key „${key}“ existiert bereits.`
        : `Template anlegen fehlgeschlagen: ${error.message}`,
    );
  }
  done(`Template „${name}“ angelegt.`);
}

export async function updateTemplate(templateId: string, formData: FormData) {
  await requireAdmin();

  const key = String(formData.get("key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!key || !name) fail("Key und Name sind Pflichtfelder.");

  const defaultConfig = parseConfig(formData.get("default_config"));
  if (defaultConfig === null) fail("Default-Konfiguration ist kein gültiges JSON-Objekt.");

  const db = createServiceClient();
  const { error } = await db
    .from("automation_templates")
    .update({
      key,
      name,
      description: String(formData.get("description") ?? "").trim(),
      requires: parseList(formData.get("requires")),
      default_config: defaultConfig,
      industry_tag: String(formData.get("industry_tag") ?? "").trim() || null,
    })
    .eq("id", templateId);

  if (error) {
    fail(
      error.code === "23505"
        ? `Template mit Key „${key}“ existiert bereits.`
        : `Template speichern fehlgeschlagen: ${error.message}`,
    );
  }
  done(`Template „${name}“ gespeichert.`);
}

/**
 * Template → tenant instance (admin spec §3). The instance is created
 * STOPPED on purpose: activation and configuration stay with the consultant
 * (Berater bleibt im Lead) — instantiating alone changes nothing for the
 * customer.
 */
export async function instantiateTemplate(templateId: string, formData: FormData) {
  await requireAdmin();

  const orgId = String(formData.get("organization_id") ?? "").trim();
  if (!orgId) fail("Bitte zuerst einen Kunden auswählen.");

  const db = createServiceClient();
  const { data: template } = await db
    .from("automation_templates")
    .select("id, key, name, description, requires, default_config")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) fail("Template nicht gefunden.");

  const { error } = await db.from("automations").insert({
    organization_id: orgId,
    key: template.key,
    name: template.name,
    description: template.description,
    requires: template.requires,
    config: template.default_config,
    template_id: template.id,
    status: "stopped",
  });

  if (error) {
    fail(
      error.code === "23505"
        ? `Automatisierung „${template.key}“ existiert für diesen Kunden bereits.`
        : `Instanziieren fehlgeschlagen: ${error.message}`,
    );
  }
  done(`Instanz „${template.key}“ angelegt (gestoppt) — Aktivierung übernimmt der Berater.`);
}
