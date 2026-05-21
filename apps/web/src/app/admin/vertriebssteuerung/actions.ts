"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, getUser } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";

type Industry = "commerce" | "hls" | "bauwesen" | "other";
const VALID: Industry[] = ["commerce", "hls", "bauwesen", "other"];

export async function setIcpOverride(formData: FormData): Promise<void> {
  const orgId = await requireOrgId();
  const externalId = formData.get("pipedrive_org_external_id");
  const industry = formData.get("industry");
  if (typeof externalId !== "string" || !externalId) return;
  if (typeof industry !== "string" || !VALID.includes(industry as Industry)) return;

  const db = createServiceClient();
  const { error } = await db
    .from("deal_icp_classifications")
    .upsert(
      {
        organization_id:           orgId,
        pipedrive_org_external_id: externalId,
        industry,
        confidence:                1,
        reasoning:                 "Manuelle Berater-Korrektur",
        llm_model:                 null,
        manual_override:           true,
        classified_at:             new Date().toISOString(),
        updated_at:                new Date().toISOString(),
      },
      { onConflict: "organization_id,pipedrive_org_external_id" },
    );
  if (error) throw error;

  revalidatePath("/admin/vertriebssteuerung");
  revalidatePath("/mein-vertrieb");
}

export async function dismissNudge(formData: FormData): Promise<void> {
  const orgId = await requireOrgId();
  const user = await getUser();
  const dealExternalId = formData.get("deal_external_id");
  const source = formData.get("source");
  if (typeof dealExternalId !== "string" || !dealExternalId) return;
  if (source !== "off_icp" && source !== "stale_deal") return;

  const db = createServiceClient();
  await db
    .from("nudge_dismissals")
    .upsert(
      {
        organization_id:  orgId,
        user_id:          user?.id ?? null,
        source,
        deal_external_id: dealExternalId,
        dismissed_at:     new Date().toISOString(),
      },
      { onConflict: "organization_id,source,deal_external_id" },
    );
  revalidatePath("/mein-vertrieb");
  revalidatePath("/admin/vertriebssteuerung");
}
