// Tool-Registry — Sammlung + per-Org-Filterung.
//
// getEnabledTools() liefert das Toolset, das ein Org-Agent tatsächlich sehen
// darf: gefiltert über die per-Org-Toggles (`organization_tools`, default an)
// und über Feature-Gates (`org_has_feature`).

import { createUserClient } from "@/lib/db/supabase-server";
import { hasFeature } from "@/lib/features/flags";
import { ALL_TOOLS } from "./definitions";
import type { ToolDefinition } from "./types";

export { ALL_TOOLS } from "./definitions";

export async function getEnabledTools(orgId: string): Promise<ToolDefinition[]> {
  const db = await createUserClient();

  // 1. Per-Org-Toggles laden. Abwesenheit = an.
  const { data: toggles } = await db
    .from("organization_tools")
    .select("tool_key, enabled")
    .eq("organization_id", orgId);

  const disabled = new Set(
    (toggles ?? [])
      .filter((t: { tool_key: string; enabled: boolean }) => t.enabled === false)
      .map((t: { tool_key: string }) => t.tool_key),
  );

  // 2. Feature-Gates prüfen (einmal pro distinct featureKey cachen).
  const featureCache = new Map<string, boolean>();
  const checkFeature = async (key?: string): Promise<boolean> => {
    if (!key) return true;
    if (featureCache.has(key)) return featureCache.get(key)!;
    const ok = await hasFeature(key);
    featureCache.set(key, ok);
    return ok;
  };

  const out: ToolDefinition[] = [];
  for (const t of ALL_TOOLS) {
    if (disabled.has(t.key)) continue;
    if (!(await checkFeature(t.featureKey))) continue;
    out.push(t);
  }
  return out;
}
