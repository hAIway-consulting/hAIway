// Provider-neutral tool registry for the chat agent. Each tool reads/acts on
// the org's integration data (org-scoped via ctx.orgId). Trello write actions
// are dry-run unless { confirm: true } and never delete — only move.

import { createServiceClient } from "@/lib/db/supabase-server";
import {
  listAutomations,
  listWorkflowRuns,
} from "@/lib/db/queries/workflows";
import { WORKFLOW_KEY } from "@/lib/orchestrator/run-complaint";
import { getTrelloConfig } from "@/lib/orchestrator/credentials";
import {
  listOpenCards,
  listOpenLists,
  createList,
  moveCard,
} from "@/lib/orchestrator/trello";
import type { AgentTool } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;

// Tools with write side effects — not available to `member` callers
// (Rollen-Matrix spec-cockpit.md §11). The full access/minRole metadata
// model lands with the write-confirmation flow; until then this set is
// the single source of truth for role filtering.
export const WRITE_TOOLS = new Set(["cleanup_stale_trello_cards"]);

/** Tools a caller with the given role may use (member → read-only). */
export function filterToolsForRole(
  tools: AgentTool[],
  role: "member" | "admin" | "owner" | undefined,
): AgentTool[] {
  if (role === "admin" || role === "owner") return tools;
  return tools.filter((t) => !WRITE_TOOLS.has(t.name));
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "get_automation_overview",
    description:
      "Liefert alle Automatisierungen der Organisation mit Status (aktiv/inaktiv) und KPIs " +
      "(Tickets gesamt, erfolgreich, fehlgeschlagen, Erfolgsquote). Nutze dies für Fragen wie " +
      "„welche Automatisierungen laufen“ oder „wie viele Reklamationen gab es“.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_input, ctx) => {
      const autos = await listAutomations(ctx.orgId);
      return autos.map((a) => ({
        name:          a.name,
        description:   a.description,
        active:        a.active,
        tickets_total: a.kpi.total,
        succeeded:     a.kpi.success,
        failed:        a.kpi.failed,
        success_rate:  a.kpi.total > 0 ? Math.round((a.kpi.success / a.kpi.total) * 100) : null,
        last_run_at:   a.kpi.last_run_at,
      }));
    },
  },
  {
    name: "list_complaint_cases",
    description:
      "Listet einzelne Reklamationsfälle (Shopware→Trello-Läufe) mit Kunde, Produkt, Status, " +
      "Datum und Trello-Karten-Link. Für Auswertungen aller Reklamationsfälle.",
    parameters: {
      type: "object",
      properties: {
        limit:  { type: "integer", description: "Maximale Anzahl (Default 50)." },
        status: { type: "string", enum: ["success", "failed", "running"], description: "Optionaler Status-Filter." },
      },
      additionalProperties: false,
    },
    handler: async (input, ctx) => {
      const limit = typeof input.limit === "number" ? input.limit : 50;
      const status = typeof input.status === "string" ? input.status : null;
      const runs = await listWorkflowRuns(ctx.orgId, 200);
      let cases = runs.filter((r) => r.workflow_key === WORKFLOW_KEY);
      if (status) cases = cases.filter((r) => r.status === status);
      cases = cases.slice(0, limit);
      return {
        count: cases.length,
        cases: cases.map((r) => {
          const src = r.source_ref as { customer_name?: string; product_name?: string } | null;
          return {
            status:    r.status,
            date:      r.started_at,
            customer:  src?.customer_name ?? null,
            product:   src?.product_name ?? null,
            card_url:  r.target_ref?.url ?? null,
            error:     r.error_message ?? null,
            simulated: r.trigger === "simulated",
          };
        }),
      };
    },
  },
  {
    name: "list_trello_cards",
    description:
      "Liest die offenen Karten des verbundenen Trello-Boards (Name, Liste, letzte Aktivität, " +
      "Inaktivitäts-Tage, Link). Optional nur Karten, die seit > stale_months Monaten inaktiv sind.",
    parameters: {
      type: "object",
      properties: {
        stale_months: { type: "number", description: "Nur Karten, die seit mehr als N Monaten inaktiv sind." },
      },
      additionalProperties: false,
    },
    handler: async (input, ctx) => {
      const cfg = await getTrelloConfig(ctx.orgId);
      const [cards, lists] = await Promise.all([listOpenCards(cfg), listOpenLists(cfg)]);
      const listName = new Map(lists.map((l) => [l.id, l.name]));
      const staleMonths = typeof input.stale_months === "number" ? input.stale_months : null;
      const cutoff = staleMonths != null ? Date.now() - staleMonths * DAYS_PER_MONTH * MS_PER_DAY : null;
      let result = cards.map((c) => ({
        name:          c.name,
        list:          listName.get(c.idList) ?? c.idList,
        last_activity: c.dateLastActivity,
        inactive_days: Math.round((Date.now() - new Date(c.dateLastActivity).getTime()) / MS_PER_DAY),
        url:           c.shortUrl,
      }));
      if (cutoff != null) result = result.filter((c) => new Date(c.last_activity).getTime() < cutoff);
      return { count: result.length, cards: result.slice(0, 100) };
    },
  },
  {
    name: "cleanup_stale_trello_cards",
    description:
      "Bereinigt das Trello-Board: legt eine Kategorie-Liste für seit > months Monaten inaktive " +
      "Karten an und verschiebt diese dorthin. WICHTIG: Ohne confirm=true wird NUR eine Vorschau " +
      "zurückgegeben (was verschoben würde). Rufe confirm=true erst NACH ausdrücklicher Bestätigung " +
      "des Nutzers. Es wird nur verschoben, nie gelöscht.",
    parameters: {
      type: "object",
      properties: {
        months:  { type: "number", description: "Inaktivitäts-Schwelle in Monaten (Default 6)." },
        confirm: { type: "boolean", description: "true = ausführen. Fehlt/false = nur Vorschau." },
      },
      additionalProperties: false,
    },
    handler: async (input, ctx) => {
      const months = typeof input.months === "number" ? input.months : 6;
      const confirm = input.confirm === true;
      const cfg = await getTrelloConfig(ctx.orgId);
      const targetName = `⏳ Inaktiv > ${months} Monate`;
      const [cards, lists] = await Promise.all([listOpenCards(cfg), listOpenLists(cfg)]);
      const existingTarget = lists.find((l) => l.name === targetName);
      const cutoff = Date.now() - months * DAYS_PER_MONTH * MS_PER_DAY;
      const stale = cards.filter(
        (c) => new Date(c.dateLastActivity).getTime() < cutoff && c.idList !== existingTarget?.id,
      );
      const preview = stale.map((c) => ({
        name:          c.name,
        url:           c.shortUrl,
        last_activity: c.dateLastActivity,
      }));

      if (!confirm) {
        return {
          preview:     true,
          target_list: targetName,
          would_move:  stale.length,
          cards:       preview,
          hint:
            stale.length === 0
              ? "Keine Karten älter als die Schwelle gefunden."
              : "Zeige dem Nutzer diese Liste und frage um Bestätigung, bevor du confirm=true aufrufst.",
        };
      }

      // Execute (reversible: only moves).
      const started = Date.now();
      const targetList = existingTarget ?? (await createList(cfg, targetName));
      let moved = 0;
      for (const c of stale) {
        await moveCard(cfg, c.id, targetList.id);
        moved++;
      }

      // Audit as a workflow_runs row (own workflow_key — doesn't affect complaint KPIs).
      try {
        const db = createServiceClient();
        await db.from("workflow_runs").insert({
          organization_id: ctx.orgId,
          workflow_key:    "trello_cleanup",
          status:          "success",
          trigger:         "manual",
          started_at:      new Date(started).toISOString(),
          finished_at:     new Date().toISOString(),
          duration_ms:     Date.now() - started,
          steps: [
            { key: "scan", label: "Trello-Karten scannen", status: "success", detail: `${cards.length} Karten geprüft` },
            { key: "categorize", label: `Kategorie „${targetName}" + verschieben`, status: "success", detail: `${moved} verschoben` },
          ],
          source_ref:  { months },
          target_ref:  { list: targetName, moved },
          created_by:  ctx.userId ?? null,
        });
      } catch {
        /* audit is best-effort */
      }

      return { applied: true, target_list: targetName, moved, cards: preview };
    },
  },
];
