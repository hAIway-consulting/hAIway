// Frontend-Metadaten je Tool-Kategorie (Akzentfarbe + Label).
// Analog zu integrationen/provider-meta.ts — Akzent-Hex ist Daten, das
// Card-Chrome läuft über Tokens.

export type ToolCategory = "knowledge" | "crm" | "connector" | "artifact";

export const CATEGORY_META: Record<ToolCategory, { label: string; color: string }> = {
  knowledge: { label: "Wissen", color: "#189eff" },
  crm: { label: "CRM", color: "#19c37d" },
  connector: { label: "Connector", color: "#d97757" },
  artifact: { label: "Artefakt", color: "#7c5cff" },
};

export function categoryMeta(category: string): { label: string; color: string } {
  return CATEGORY_META[category as ToolCategory] ?? { label: category, color: "#7d8da1" };
}
