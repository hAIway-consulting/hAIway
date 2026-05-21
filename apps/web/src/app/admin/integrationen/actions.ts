"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { isPlatformAdmin } from "@/lib/db/queries/organization";

export async function replayJobFailureAction(formData: FormData) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) redirect("/");

  const failureId = formData.get("failure_id");
  if (typeof failureId !== "string" || !failureId) return;

  const supabase = createServiceClient();
  const { error } = await supabase.rpc("replay_job_failure", { p_failure_id: failureId });
  if (error) throw error;

  revalidatePath("/admin/integrationen");
}

// ─── PIPEDRIVE ──────────────────────────────────────────────────────────

const PD_API_BASE = "https://api.pipedrive.com/api/v1";

export async function connectPipedrive(formData: FormData): Promise<void> {
  const orgId = await requireOrgId();
  const rawToken = formData.get("api_token");
  const rawDomain = formData.get("company_domain");
  const apiToken = typeof rawToken === "string" ? rawToken.trim() : "";
  const companyDomain = typeof rawDomain === "string" ? rawDomain.trim() : "";

  if (!apiToken) {
    redirect(`/admin/integrationen?pd_error=${encodeURIComponent("API-Token fehlt")}`);
  }

  // Probe the token: /users/me returns 200 on a valid token, 401 otherwise.
  let probeError: string | null = null;
  try {
    const url = new URL(`${PD_API_BASE}/users/me`);
    url.searchParams.set("api_token", apiToken);
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) probeError = `Token ungültig (${res.status})`;
  } catch (err) {
    probeError = err instanceof Error ? err.message : String(err);
  }

  if (probeError) {
    redirect(`/admin/integrationen?pd_error=${encodeURIComponent(probeError)}`);
  }

  const db = createServiceClient();
  const { error } = await db
    .from("organization_integrations")
    .upsert(
      {
        organization_id: orgId,
        provider_id: "pipedrive",
        status: "active",
        error_message: null,
        credential_mode: "customer",
        credentials: { api_token: apiToken },
        config: companyDomain ? { company_domain: companyDomain } : {},
      },
      { onConflict: "organization_id,provider_id" },
    );
  if (error) throw error;

  revalidatePath("/admin/integrationen");
  redirect(`/admin/integrationen?pd_connected=1`);
}

export async function syncPipedriveNow(): Promise<void> {
  const orgId = await requireOrgId();
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/connector-pipedrive`;

  let errorMessage: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ action: "sync", organization_id: orgId, trigger: "manual" }),
    });
    if (res.status === 409) {
      errorMessage = "Sync läuft bereits.";
    } else if (!res.ok) {
      const body = await res.text();
      errorMessage = `Sync fehlgeschlagen (${res.status}): ${body.slice(0, 200)}`;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  revalidatePath("/admin/integrationen");
  revalidatePath("/admin/vertriebssteuerung");

  if (errorMessage) {
    redirect(`/admin/integrationen?pd_error=${encodeURIComponent(errorMessage)}`);
  } else {
    redirect(`/admin/integrationen?pd_connected=${encodeURIComponent("Pipedrive synchronisiert")}`);
  }
}

export async function disconnectPipedrive(): Promise<void> {
  const orgId = await requireOrgId();
  const db = createServiceClient();
  const { error } = await db
    .from("organization_integrations")
    .update({ status: "disabled", credentials: {}, error_message: null })
    .eq("organization_id", orgId)
    .eq("provider_id", "pipedrive");
  if (error) throw error;
  revalidatePath("/admin/integrationen");
}
