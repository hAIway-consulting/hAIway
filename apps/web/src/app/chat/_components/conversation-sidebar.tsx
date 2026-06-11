"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createConversation, deleteConversation } from "../actions";
import type { ConversationListItem } from "../actions";
import { btn, styles } from "@/components/ui/table-classes";

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
}: {
  conversations: ConversationListItem[];
  activeId: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const groups = groupByDate(conversations);

  function handleNew() {
    startTransition(async () => {
      const id = await createConversation();
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

  return (
    <div className="flex flex-col h-full">
      <div
        className="shrink-0 px-4 py-4 border-b"
        style={{ borderColor: "var(--color-line-soft)" }}
      >
        <button
          type="button"
          onClick={handleNew}
          disabled={pending}
          className={btn.primary}
          style={{ ...styles.accent, width: "100%", opacity: pending ? 0.6 : 1 }}
        >
          + Neuer Chat
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {conversations.length === 0 && (
          <p className="text-xs px-2 py-4" style={styles.muted}>
            Noch keine Chats. Lege einen neuen an.
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
