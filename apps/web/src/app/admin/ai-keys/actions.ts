"use server";

// Platform key management (docs/spec-admin-dashboard.md §5). STRICT platform
// gate on every action. ai_provider_keys is deny-all RLS — all access via the
// service client. Raw keys exist only inside these actions: they are
// encrypted (AES-256-GCM) before any write and NEVER echoed back; the UI
// only ever sees key_hint.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { createServiceClient } from "@/lib/db/supabase-server";
import { encryptProviderKey, keyHint } from "@/lib/ai/provider-keys";

const ROUTE = "/admin/ai-keys";

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

/** Parses the constraints textarea; null = invalid (not a JSON object). */
function parseConstraints(raw: FormDataEntryValue | null): Record<string, unknown> | null {
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

/** Encrypt outside of fail() so the NEXT_REDIRECT throw is never swallowed. */
async function encryptOrNull(rawKey: string): Promise<string | null> {
  try {
    return await encryptProviderKey(rawKey);
  } catch {
    return null;
  }
}

export async function createPlatformKey(formData: FormData) {
  await requireAdmin();

  const provider = String(formData.get("provider") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const rawKey = String(formData.get("raw_key") ?? "").trim();
  if (!provider || !rawKey) fail("Provider und Key sind Pflichtfelder.");

  const constraints = parseConstraints(formData.get("constraints"));
  if (constraints === null) fail("Constraints sind kein gültiges JSON-Objekt.");

  const encrypted = await encryptOrNull(rawKey);
  if (!encrypted) fail("Verschlüsselung fehlgeschlagen — ist AI_KEYS_ENCRYPTION_SECRET gesetzt?");

  const db = createServiceClient();
  const { error } = await db.from("ai_provider_keys").insert({
    organization_id: null,
    provider,
    name: name || `Plattform-Key ${provider}`,
    encrypted_key: encrypted,
    key_hint: keyHint(rawKey),
    constraints,
    status: "active",
  });

  if (error) {
    fail(
      error.code === "23505"
        ? `Für „${provider}“ existiert bereits ein aktiver Plattform-Key — bitte rotieren oder zuerst deaktivieren.`
        : `Key anlegen fehlgeschlagen: ${error.message}`,
    );
  }
  done(`Plattform-Key für „${provider}“ angelegt.`);
}

export async function disableKey(keyId: string) {
  await requireAdmin();

  const db = createServiceClient();
  const { error } = await db
    .from("ai_provider_keys")
    .update({ status: "disabled" })
    .eq("id", keyId)
    .is("organization_id", null);

  if (error) fail(`Deaktivieren fehlgeschlagen: ${error.message}`);
  done("Key deaktiviert.");
}

/**
 * Rotation (admin spec §5): the old key is disabled FIRST (rotated_at = now),
 * then the new active row is inserted — in this order the partial unique
 * index (one active key per scope+provider) can never block the insert.
 */
export async function rotatePlatformKey(keyId: string, formData: FormData) {
  await requireAdmin();

  const newRawKey = String(formData.get("raw_key") ?? "").trim();
  if (!newRawKey) fail("Neuer Key fehlt.");

  const db = createServiceClient();
  const { data: oldKey } = await db
    .from("ai_provider_keys")
    .select("id, provider, name, constraints, status")
    .eq("id", keyId)
    .is("organization_id", null)
    .maybeSingle();
  if (!oldKey) fail("Key nicht gefunden.");
  if (oldKey.status !== "active") fail("Nur aktive Keys können rotiert werden.");

  const encrypted = await encryptOrNull(newRawKey);
  if (!encrypted) fail("Verschlüsselung fehlgeschlagen — ist AI_KEYS_ENCRYPTION_SECRET gesetzt?");

  const { error: disableError } = await db
    .from("ai_provider_keys")
    .update({ status: "disabled", rotated_at: new Date().toISOString() })
    .eq("id", keyId);
  if (disableError) fail(`Rotation fehlgeschlagen: ${disableError.message}`);

  const { error: insertError } = await db.from("ai_provider_keys").insert({
    organization_id: null,
    provider: oldKey.provider,
    name: oldKey.name,
    encrypted_key: encrypted,
    key_hint: keyHint(newRawKey),
    constraints: oldKey.constraints,
    status: "active",
  });
  if (insertError) {
    fail(
      `Rotation fehlgeschlagen — der alte Key wurde bereits deaktiviert, der neue konnte nicht angelegt werden: ${insertError.message}`,
    );
  }
  done(`Key für „${oldKey.provider}“ rotiert — alter Key deaktiviert.`);
}
