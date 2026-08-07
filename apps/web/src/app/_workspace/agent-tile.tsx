"use client";

import { useTransition } from "react";
import { startSavedAgent } from "./actions";
import type { SavedAgentAccent, SavedAgentIcon } from "@/lib/db/queries/saved-agents";

/** Tile projection of a `saved_agents` row — the prompt stays server-side. */
export type AgentTileData = {
  id: string;
  name: string;
  description: string;
  accent: SavedAgentAccent;
  icon: SavedAgentIcon;
};

const accentVar: Record<SavedAgentAccent, { soft: string; solid: string }> = {
  teal:   { soft: "color-mix(in srgb, var(--color-accent) 14%, transparent)", solid: "var(--color-accent)" },
  amber:  { soft: "color-mix(in srgb, var(--color-warning) 14%, transparent)", solid: "var(--color-warning)" },
  violet: { soft: "color-mix(in srgb, #8b5cf6 14%, transparent)",              solid: "#8b5cf6" },
  rose:   { soft: "color-mix(in srgb, #f43f5e 14%, transparent)",              solid: "#f43f5e" },
  sky:    { soft: "color-mix(in srgb, var(--color-info) 14%, transparent)",    solid: "var(--color-info)" },
};

function AgentIcon({ icon, color }: { icon: SavedAgentIcon; color: string }) {
  const props = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (icon) {
    case "draft":
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="13" y2="17" />
        </svg>
      );
    case "briefing":
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="9" y1="14" x2="9" y2="18" />
          <line x1="15" y1="14" x2="15" y2="18" />
        </svg>
      );
    case "mail":
      return (
        <svg {...props}>
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      );
    case "summary":
      return (
        <svg {...props}>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          <line x1="8" y1="9" x2="16" y2="9" />
          <line x1="8" y1="13" x2="13" y2="13" />
        </svg>
      );
  }
}

export function AgentTile({ agent }: { agent: AgentTileData }) {
  const [pending, startTransition] = useTransition();
  const colors = accentVar[agent.accent];

  return (
    <form
      action={startSavedAgent}
      onSubmit={() => startTransition(() => {})}
      className="contents"
    >
      <input type="hidden" name="agentId" value={agent.id} />
      <button
        type="submit"
        disabled={pending}
        className="group flex flex-col items-start gap-3 text-left p-5 rounded-2xl transition-all hover:-translate-y-0.5 disabled:opacity-50"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-line)",
          boxShadow: "var(--shadow-sm)",
          minHeight: 140,
          cursor: pending ? "wait" : "pointer",
        }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: colors.soft }}
        >
          <AgentIcon icon={agent.icon} color={colors.solid} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold leading-tight" style={{ color: "var(--color-text)" }}>
            {agent.name}
          </span>
          <span className="text-[12px] leading-snug" style={{ color: "var(--color-muted)" }}>
            {agent.description}
          </span>
        </div>
        <span
          className="mt-auto text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: colors.solid }}
        >
          {pending ? "Starte…" : "Starten →"}
        </span>
      </button>
    </form>
  );
}
