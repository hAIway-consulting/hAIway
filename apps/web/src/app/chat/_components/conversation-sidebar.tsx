"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createConversation, deleteConversation } from "../actions";
import type { ConversationListItem, ConversationMode } from "../actions";
import { btn, styles } from "@/components/ui/table-classes";

type HistoryFilter = "alle" | ConversationMode;

type Group = { label: string; items: ConversationListItem[] };

function groupByDate(items: ConversationListItem[]): Group[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  const buckets: Record<string, ConversationListItem[]> = {
    Heute: [], Gestern: [], "Letzte 7 Tage": [], Aelter: [],
  };
  for (const c of items) {
    const d = new Date(c.last_message_at);
    if (d >= today) buckets["Heute"].push(c);
    else if (d >= yesterday) buckets["Gestern"].push(c);
    else if (d >= weekAgo) buckets["Letzte 7 Tage"].push(c);
    else buckets["Aelter"].push(c);
  }
  return Object.entries(buckets)
    .filter(([, v]) => v.length > 0)
    .map(([label, items]) => ({ label, items }));
}

export default function ConversationSidebar({
  conversations,
  activeId,
  onNavigate,
  agentAvailable = false,
}: {
  conversations: ConversationListItem[];
  activeId: string;
  onNavigate?: () => void;
  /** agent_mode flag + provider availability — enables the Agent tab's new button */
  agentAvailable?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // History tabs (spec §2 Konversationsverlauf): like Claude's surface
  // switcher — filter the history by mode; "Neu" creates in the active mode.
  const [filter, setFilter] = useState<HistoryFilter>("alle");
  const hasAgentConversations = conversations.some((c) => c.mode === "agent");
  const showAgentTab = agentAvailable || hasAgentConversations;
  const filtered =
    filter === "alle" ? conversations : conversations.filter((c) => (c.mode ?? "chat") === filter);
  const groups = groupByDate(filtered);
  const newMode: ConversationMode = filter === "agent" ? "agent" : "chat";
  const newDisabled = pending || (newMode === "agent" && !agentAvailable);

  function handleNew() {
    if (newDisabled) return;
    startTransition(async () => {
      const id = await createConversation(newMode);
      onNavigate?.();
      router.push(`/chat/${id}`);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Diesen Chat wirklich loeschen?")) return;
    startTransition(async () => {
      await deleteConversation(id);
      router.refresh();
    });
  }

  const tabs: { id: HistoryFilter; label: string }[] = [
    { id: "alle", label: "Alle" },
    { id: "chat", label: "Chat" },
    ...(showAgentTab ? [{ id: "agent" as const, label: "Agent" }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <div
        className="shrink-0 px-3 pt-3 pb-4 border-b flex flex-col gap-3"
        style={{ borderColor: "var(--color-line-soft)" }}
      >
        <div
          className="flex rounded-xl p-0.5"
          style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-line)" }}
          role="tablist"
          aria-label="Verlauf filtern"
        >
          {tabs.map((t) => {
            const active = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(t.id)}
                className="flex-1 min-h-[44px] rounded-[10px] text-[13px] font-semibold transition-all"
                style={{
                  background: active ? "var(--color-accent)" : "transparent",
                  color: active ? "var(--color-accent-text)" : "var(--color-muted)",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleNew}
          disabled={newDisabled}
          className={btn.primary}
          style={{ ...styles.accent, width: "100%", opacity: newDisabled ? 0.6 : 1 }}
          title={
            newMode === "agent" && !agentAvailable
              ? "Agenten-Modus ist für eure Organisation nicht aktiviert"
              : undefined
          }
        >
          {newMode === "agent" ? "+ Neuer Agent" : "+ Neuer Chat"}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {filtered.length === 0 && (
          <p className="text-xs px-2 py-4" style={styles.muted}>
            {filter === "agent"
              ? "Noch keine Agent-Konversationen."
              : filter === "chat"
              ? "Noch keine Chats. Lege einen neuen an."
              : "Noch keine Konversationen. Lege eine neue an."}
          </p>
        )}

        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            <p
              className="text-[10px] uppercase tracking-wide font-semibold px-2 mb-1"
              style={styles.muted}
            >
              {g.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {g.items.map((c) => {
                const active = c.id === activeId;
                return (
                  <li key={c.id} className="group relative">
                    <Link
                      href={`/chat/${c.id}`}
                      onClick={onNavigate}
                      className="flex items-center px-2 py-2 rounded-lg text-sm min-h-[44px] transition-colors"
                      style={{
                        background: active
                          ? "var(--color-accent-soft)"
                          : "transparent",
                        color: active
                          ? "var(--color-accent)"
                          : "var(--color-text)",
                      }}
                    >
                      <span className="truncate flex-1">{c.title}</span>
                      {c.mode === "agent" && (
                        <span
                          className="ml-1.5 shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                          style={{
                            background: "var(--color-accent-soft)",
                            color: "var(--color-accent)",
                          }}
                        >
                          Agent
                        </span>
                      )}
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center w-7 h-7 rounded-md text-xs"
                      style={{ color: "var(--color-muted)" }}
                      aria-label="Loeschen"
                    >
                      x
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
