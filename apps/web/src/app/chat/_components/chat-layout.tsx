"use client";

import { useState } from "react";
import ConversationSidebar from "./conversation-sidebar";
import ChatView from "./chat-view";
import type {
  ConversationListItem,
  StoredMessage,
} from "../actions";
import type { PendingConfirmation } from "../agent-actions";
import type { ModelId } from "@/lib/ai/chat";

type ModelOption = { id: ModelId; label: string; available: boolean };

export type ChatVariant = "default" | "workspace";

/**
 * Chat-Layout. Im "workspace"-Variant (End-User auf der HAIway-Workspace-Home)
 * fällt die Konversations-Sidebar weg — die "Letzte Chats"-Liste lebt bereits
 * auf der Home, ein dauerhaftes Sidebar-Panel doppelt das nur und nimmt Fokus
 * vom eigentlichen Gespräch. Berater + HAIway-Persona bekommen weiterhin die
 * volle Sidebar für Audit-/QA-Sicht.
 */
export default function ChatLayout(props: {
  activeId: string;
  conversation: ConversationListItem;
  messages: StoredMessage[];
  conversations: ConversationListItem[];
  models: ModelOption[];
  isAdmin?: boolean;
  variant?: ChatVariant;
  agentAvailable?: boolean;
  pendingConfirmation?: PendingConfirmation | null;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const variant = props.variant ?? "default";

  if (variant === "workspace") {
    return (
      <main className="flex flex-col min-w-0 h-[calc(100dvh-var(--header-h))]">
        <ChatView
          conversationId={props.activeId}
          conversation={props.conversation}
          initialMessages={props.messages}
          models={props.models}
          isAdmin={props.isAdmin ?? false}
          onOpenDrawer={() => {}}
          variant="workspace"
          agentAvailable={props.agentAvailable ?? false}
          pendingConfirmation={props.pendingConfirmation ?? null}
        />
      </main>
    );
  }

  return (
    <div className="flex h-[100dvh] md:h-full md:min-h-[100dvh]">
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex md:w-72 lg:w-80 shrink-0 flex-col border-r"
        style={{
          background: "var(--color-panel)",
          borderColor: "var(--color-line-soft)",
        }}
      >
        <ConversationSidebar
          conversations={props.conversations}
          activeId={props.activeId}
        />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-72 flex flex-col border-r animate-slide-in-left"
            style={{
              background: "var(--color-panel)",
              borderColor: "var(--color-line-soft)",
            }}
          >
            <ConversationSidebar
              conversations={props.conversations}
              activeId={props.activeId}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </>
      )}

      {/* Main chat */}
      <main className="flex-1 flex flex-col min-w-0">
        <ChatView
          conversationId={props.activeId}
          conversation={props.conversation}
          initialMessages={props.messages}
          models={props.models}
          isAdmin={props.isAdmin ?? false}
          onOpenDrawer={() => setDrawerOpen(true)}
          variant="default"
          agentAvailable={props.agentAvailable ?? false}
          pendingConfirmation={props.pendingConfirmation ?? null}
        />
      </main>
    </div>
  );
}
