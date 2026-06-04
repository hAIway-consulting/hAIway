// Konkrete Tool-Definitionen (PR 1 — alle read-only).
//
// Jedes Tool wrappt eine BESTEHENDE Funktion der Daten-/Query-Schicht. Die
// gewrappten Funktionen lösen `orgId` selbst via requireOrgId() auf und nutzen
// createUserClient() (RLS) — daher ist der Zugriff org-isoliert, ohne dass das
// LLM je eine org-id setzen kann.

import { z } from "zod";
import {
  hybridSearch,
  searchOperationalEntities,
  listEntitiesByStatus,
  type ChunkSearchResult,
} from "@/lib/db/queries/search";
import { getCompanyById } from "@/lib/db/queries/companies";
import { getContactById } from "@/lib/db/queries/contacts";
import type { ToolDefinition } from "./types";

// Kompakte Quellen-Repräsentation fürs Modell (Text gekappt, damit der
// Loop-Kontext nicht explodiert).
function toSource(c: ChunkSearchResult) {
  return {
    id: c.source_id,
    title: c.source_title,
    type: c.source_type,
    text: (c.chunk_text ?? "").slice(0, 1200),
  };
}

const searchKnowledge: ToolDefinition = {
  key: "search_knowledge",
  description:
    "Durchsucht die Wissensbasis (Dokumente, Transkripte, CRM) per Hybrid-Suche. " +
    "Nutze dies für JEDE Faktenfrage, bevor du antwortest. Gibt Quellen-Snippets " +
    "zurück; bei 0 Treffern ist die Information nicht vorhanden.",
  category: "knowledge",
  featureKey: "chat",
  inputSchema: z.object({
    query: z.string().min(1).describe("Suchanfrage in natürlicher Sprache."),
    limit: z.number().int().min(1).max(20).default(10).describe("Max. Anzahl Treffer."),
  }),
  handler: async (ctx, input) => {
    const { query, limit } = input as { query: string; limit: number };
    const chunks = await hybridSearch(query, limit, ctx.userId);
    if (chunks.length === 0) {
      return { found: 0, note: "Keine Quellen gefunden — Information nicht vorhanden." };
    }
    return { found: chunks.length, sources: chunks.map(toSource) };
  },
};

const findEntities: ToolDefinition = {
  key: "find_entities",
  description:
    "Sucht in den operativen Tabellen (Firmen, Kontakte, Projekte) nach passenden " +
    "Einträgen und liefert deren IDs + Stammdaten. Nutze die IDs anschliessend für " +
    "get_company / get_contact.",
  category: "crm",
  featureKey: "chat",
  inputSchema: z.object({
    query: z.string().min(1).describe("Name oder Stichwort (Firma, Person, Projekt)."),
  }),
  handler: async (_ctx, input) => {
    const { query } = input as { query: string };
    const rows = await searchOperationalEntities(query, 50, "search");
    if (rows.length === 0) return { found: 0, entities: [] };
    return {
      found: rows.length,
      entities: rows.map((r) => ({
        id: r.source_id,
        type: r.source_type, // contact | company | project
        title: r.source_title,
        details: (r.chunk_text ?? "").slice(0, 800),
      })),
    };
  },
};

const listEntitiesByStatusTool: ToolDefinition = {
  key: "list_entities_by_status",
  description:
    "Listet Firmen/Kontakte/Projekte gefiltert nach Status (z.B. alle aktiven Kunden, " +
    "offene Projekte). VOLLSTÄNDIGE Liste — als abschliessend behandeln.",
  category: "crm",
  featureKey: "chat",
  inputSchema: z.object({
    types: z
      .array(z.enum(["contact", "company", "project"]))
      .min(1)
      .describe("Welche Entitätstypen einbezogen werden."),
    statuses: z
      .array(z.string().min(1))
      .min(1)
      .describe("Status-Werte, exakt wie in der DB (z.B. 'active', 'open')."),
  }),
  handler: async (_ctx, input) => {
    const { types, statuses } = input as {
      types: Array<"contact" | "company" | "project">;
      statuses: string[];
    };
    const rows = await listEntitiesByStatus(types, statuses);
    return {
      found: rows.length,
      entities: rows.map((r) => ({
        id: r.source_id,
        type: r.source_type,
        title: r.source_title,
        details: (r.chunk_text ?? "").slice(0, 800),
      })),
    };
  },
};

const getCompany: ToolDefinition = {
  key: "get_company",
  description: "Liefert die Stammdaten einer Firma anhand ihrer ID (aus find_entities).",
  category: "crm",
  featureKey: "companies",
  inputSchema: z.object({
    id: z.string().min(1).describe("Firmen-ID (UUID)."),
  }),
  handler: async (_ctx, input) => {
    const { id } = input as { id: string };
    const company = await getCompanyById(id);
    if (!company) return { found: false };
    return { found: true, company };
  },
};

const getContact: ToolDefinition = {
  key: "get_contact",
  description: "Liefert die Stammdaten eines Kontakts anhand seiner ID (aus find_entities).",
  category: "crm",
  featureKey: "contacts",
  inputSchema: z.object({
    id: z.string().min(1).describe("Kontakt-ID (UUID)."),
  }),
  handler: async (_ctx, input) => {
    const { id } = input as { id: string };
    const contact = await getContactById(id);
    if (!contact) return { found: false };
    return { found: true, contact };
  },
};

export const ALL_TOOLS: ToolDefinition[] = [
  searchKnowledge,
  findEntities,
  listEntitiesByStatusTool,
  getCompany,
  getContact,
];
