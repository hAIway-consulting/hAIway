"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrgId } from "@/lib/db/org-context";
import { createServiceClient } from "@/lib/db/supabase-server";

const SETUP_ROUTE = "/admin/integrationen/shopware/setup";

// Redirect back to the wizard with an error, prefilling the non-secret fields
// so the user does not have to retype the URL / client id. The secret is
// never round-tripped through the URL.
function backToSetup(params: { base_url: string; client_id: string; error: string }): never {
  const q = new URLSearchParams({
    error:     params.error,
    base_url:  params.base_url,
    client_id: params.client_id,
  });
  redirect(`${SETUP_ROUTE}?${q.toString()}`);
}

// Verifies the integration credentials directly against the shop. Mirrors the
// auth handshake in supabase/functions/_shared/shopware.ts#fetchToken — that
// Deno edge module cannot be imported here, so we re-implement the minimal
// token + sample-read against the Admin API.
async function testShopwareConnection(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const tokenRes = await fetch(`${baseUrl}/api/oauth/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body:    JSON.stringify({
      grant_type:    "client_credentials",
      client_id:     clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Auth fehlgeschlagen (${tokenRes.status}): ${body.slice(0, 200)}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error("Keine access_token in der Shopware-Antwort.");
  }

  // Sample read to confirm the integration has Admin-API scope.
  const verRes = await fetch(`${baseUrl}/api/_info/version`, {
    headers: { "Authorization": `Bearer ${tokenJson.access_token}`, "Accept": "application/json" },
    cache:   "no-store",
  });
  if (!verRes.ok) {
    const body = await verRes.text();
    throw new Error(`Test-Read fehlgeschlagen (${verRes.status}): ${body.slice(0, 200)}`);
  }
}

export async function saveShopwareCredentials(formData: FormData): Promise<void> {
  const orgId = await requireOrgId();

  const baseUrlRaw   = String(formData.get("base_url") ?? "").trim();
  const clientId     = String(formData.get("client_id") ?? "").trim();
  const clientSecret = String(formData.get("client_secret") ?? "").trim();

  if (!baseUrlRaw || !clientId || !clientSecret) {
    backToSetup({
      base_url:  baseUrlRaw,
      client_id: clientId,
      error:     "Bitte Shop-URL, Access Key ID und Secret Access Key ausfüllen.",
    });
  }

  let baseUrl: string;
  try {
    const u = new URL(baseUrlRaw);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    baseUrl = baseUrlRaw.replace(/\/+$/, ""); // strip trailing slash(es)
  } catch {
    return backToSetup({
      base_url:  baseUrlRaw,
      client_id: clientId,
      error:     "Shop-URL ist keine gültige URL (z. B. https://shop.example.com).",
    });
  }

  // Validate the credentials against the live shop before persisting them.
  let testError: string | null = null;
  try {
    await testShopwareConnection(baseUrl, clientId, clientSecret);
  } catch (err) {
    testError = err instanceof Error ? err.message : String(err);
  }
  if (testError) {
    backToSetup({
      base_url:  baseUrlRaw,
      client_id: clientId,
      error:     `Verbindung fehlgeschlagen: ${testError}`,
    });
  }

  const db = createServiceClient();
  const { error } = await db.from("organization_integrations").upsert(
    {
      organization_id: orgId,
      provider_id:     "shopware",
      status:          "active",
      credential_mode: "customer",
      credentials:     { base_url: baseUrl, client_id: clientId, client_secret: clientSecret },
      error_message:   null,
    },
    { onConflict: "organization_id,provider_id" },
  );
  if (error) throw error;

  revalidatePath("/admin/integrationen");
  redirect("/admin/integrationen?connected=shopware");
}
