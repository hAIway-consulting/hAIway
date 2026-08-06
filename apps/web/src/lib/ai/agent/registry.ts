// Provider-neutral tool registry for the chat agent. Each tool reads/acts on
// the org's integration data (org-scoped via ctx.orgId). Write tools run in
// preview mode from the model loop (exec.ts forces confirm=false); execution
// only happens via the UI confirmation flow ({ confirm: true } injected by
// confirmAgentAction) and never deletes — only moves.

import { getTrelloConfig } from "@/lib/orchestrator/credentials";
import {
  listOpenCards,
  listOpenLists,
  createList,
  moveCard,
} from "@/lib/orchestrator/trello";
import type { AgentTool, MemberRole } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;

// Role ordering for minRole checks (Rollen-Matrix spec-cockpit.md §11).
const ROLE_RANK: Record<MemberRole, number> = { member: 0, admin: 1, owner: 2 };

/** true when `role` satisfies a tool's optional minimum role. */
export function roleSatisfies(
  role: MemberRole | undefined,
  minRole?: "member" | "admin",
): boolean {
  if (!minRole) return true;
  return ROLE_RANK[role ?? "member"] >= ROLE_RANK[minRole];
}

/**
 * Tools a caller with the given role may use (spec §11/§12.2): `member` gets
 * read-only tools; each tool's optional minRole is enforced on top. Unknown/
 * missing role is treated as `member` (least privilege).
 */
export function filterToolsForRole(
  tools: AgentTool[],
  role: MemberRole | undefined,
): AgentTool[] {
  const effective: MemberRole = role ?? "member";
  return tools.filter((t) => {
    if (t.access === "write" && effective === "member") return false;
    return roleSatisfies(effective, t.minRole);
  });
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "list_trello_cards",
    access: "read",
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
      "Karten an und verschiebt diese dorthin. Der Aufruf liefert immer nur eine VORSCHAU (was " +
      "verschoben würde) — die Ausführung bestätigt der Nutzer anschließend direkt im UI. " +
      "Es wird nur verschoben, nie gelöscht.",
    parameters: {
      type: "object",
      properties: {
        months: { type: "number", description: "Inaktivitäts-Schwelle in Monaten (Default 6)." },
      },
      additionalProperties: false,
    },
    access:  "write",
    minRole: "admin",
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

      // Execute (reversible: only moves). The tool call itself is already
      // logged in agent_runs.tool_calls — no extra audit row needed.
      const targetList = existingTarget ?? (await createList(cfg, targetName));
      let moved = 0;
      for (const c of stale) {
        await moveCard(cfg, c.id, targetList.id);
        moved++;
      }

      return { applied: true, target_list: targetName, moved, cards: preview };
    },
  },
];
