"use server";

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId, getMemberRole } from "@/lib/db/org-context";
import { isPlatformAdmin } from "@/lib/db/queries/organization";

/**
 * Schaltet ein Agenten-Tool pro Org an/aus (Berater im Lead).
 * Abwesenheit einer Zeile = aktiv; Deaktivieren legt enabled=false an.
 */
export async function setToolEnabled(formData: FormData) {
  const toolKey = formData.get("tool_key");
  const enabled = formData.get("enabled") === "true";
  if (typeof toolKey !== "string" || !toolKey) return;

  const [admin, role] = await Promise.all([
    isPlatformAdmin().catch(() => false),
    getMemberRole().catch(() => null),
  ]);
  if (!admin && role !== "admin" && role !== "owner") return;

  const orgId = await requireOrgId();
  const db = await createUserClient();
  const { error } = await db
    .from("organization_tools")
    .upsert(
      { organization_id: orgId, tool_key: toolKey, enabled },
      { onConflict: "organization_id,tool_key" },
    );
  if (error) throw error;

  revalidatePath("/admin/agent-tools");
}
