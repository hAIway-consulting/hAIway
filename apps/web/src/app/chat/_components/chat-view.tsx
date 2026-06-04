"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sendMessage, sendAgentMessage } from "../actions";
import type { ConversationListItem, StoredMessage } from "../actions";
import type { ChatResponse, ModelId } from "@/lib/ai/chat";
import { SUPPORTED_MODELS, DEFAULT_MODEL_STRING } from "@/lib/ai/models";
import { card, badge, btn, input, styles } from "@/components/ui/table-classes";
import RetrievalDebug from "./retrieval-debug";
import { ChatComposer } from "./chat-composer";

type ModelOption = { id: ModelId; label: string; available: boolean };
type ChatViewVariant = "default" | "workspace";
type ChatMode = "rag" | "agent";

type AgentStep = { tool: string; ok: boolean; latencyMs: number };

type LocalSource = {
  source_title?: string;
  source_type?: string;
  chunk_text?: string;
  chunk_index?: number;
  rank?: number;
  retrieved_via?: string;
};

type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: LocalSource[];
  model?: string | null;
  steps?: AgentStep[];
  pending?: boolean;
};

function toLocal(m: StoredMessage): LocalMessage {
  return {
    id: m.id,
    role: m.role === "system" ? "assistant" : (m.role as "user" | "assistant"),
    content: m.content,
    sources: Array.isArray(m.sources) ? (m.sources as LocalSource[]) : [],
    model: m.model,
  };
}

// Render `[Q1]`-style citation markers as small chips that scroll to the source.
function renderWithCitations(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[Q(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <sup
        key={`cite-${idx++}`}
        className="inline-flex items-center justify-center mx-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-pointer"
        style={styles.accentSoft}
        title={`Quelle ${m[1]}`}
      >
        Q{m[1]}
      </sup>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function ChatView({
  conversationId,
  conversation,
  initialMessages,
  models,
  defaultAgentModel,
  isAdmin,
  onOpenDrawer,
  variant = "default",
}: {
  conversationId: string;
  conversation: ConversationListItem;
  initialMessages: StoredMessage[];
  models: ModelOption[];
  defaultAgentModel?: string;
  isAdmin: boolean;
  onOpenDrawer: () => void;
  variant?: ChatViewVariant;
}) {
  const isWorkspace = variant === "workspace";
  const router = useRouter();
  const [messages, setMessages] = useState<LocalMessage[]>(
    initialMessages.map(toLocal),
  );
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>(
    (conversation.model as ModelId | null) ??
      models.find((m) => m.available)?.id ??
      "claude",
  );
  // Modus + Agent-Modell. Der RAG-Pfad bleibt Default; "agent" fährt den
  // Tool-Calling-Loop über das provider-agnostische Gateway-Modell.
  const [mode, setMode] = useState<ChatMode>("rag");
  const [agentModel, setAgentModel] = useState<string>(
    defaultAgentModel || DEFAULT_MODEL_STRING,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  // Reset state when navigating between conversations
  useEffect(() => {
    setMessages(initialMessages.map(toLocal));
    setQuestion("");
    setPending(false);
  }, [conversationId, initialMessages]);

  async function send(q: string) {
    if (!q || pending) return;

    const tempId = `temp-${Date.now()}`;
    setMessages((p) => [
      ...p,
      { id: tempId, role: "user", content: q, sources: [] },
      { id: `${tempId}-a`, role: "assistant", content: "", sources: [], pending: true },
    ]);
    setPending(true);

    try {
      if (mode === "agent") {
        const response = await sendAgentMessage(conversationId, q, agentModel);
        setMessages((p) =>
          p.map((m) =>
            m.id === `${tempId}-a`
              ? {
                  ...m,
                  content: response.text,
                  sources: response.sources as LocalSource[],
                  pending: false,
                  model: response.model,
                  steps: response.steps,
                }
              : m,
          ),
        );
        router.refresh();
        return;
      }

      const response: ChatResponse = await sendMessage(conversationId, q, selectedModel);
      const text =
        response.type === "answer"
          ? response.text
          : response.items.length === 0
            ? "Dazu habe ich keine Informationen in deinen Quellen."
            : "(LLM nicht verfuegbar — relevante Abschnitte werden angezeigt.)";
      const sources =
        response.type === "answer"
          ? response.sources
          : response.items;

      setMessages((p) =>
        p.map((m) =>
          m.id === `${tempId}-a`
            ? {
                ...m,
                content: text,
                sources,
                pending: false,
                model: response.type === "answer" ? response.model : undefined,
              }
            : m,
        ),
      );
      router.refresh(); // re-fetches sidebar (title) + canonical messages
    } catch {
      setMessages((p) =>
        p.map((m) =>
          m.id === `${tempId}-a`
            ? {
                ...m,
                content: "Fehler beim Senden. Bitte erneut versuchen.",
                pending: false,
              }
            : m,
        ),
      );
    } finally {
      setPending(false);
    }
  }

  const modeBar = (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      <div
        className="inline-flex rounded-full p-0.5"
        style={{ background: "var(--color-bg-elevated)" }}
      >
        {(["rag", "agent"] as const).map((mo) => (
          <button
            key={mo}
            type="button"
            onClick={() => setMode(mo)}
            className="px-3 py-1.5 rounded-full text-xs font-medium min-h-[36px]"
            style={{
              background: mode === mo ? "var(--color-accent)" : "transparent",
              color: mode === mo ? "var(--color-accent-text)" : "var(--color-muted)",
            }}
          >
            {mo === "rag" ? "RAG" : "Agent"}
          </button>
        ))}
      </div>
      {mode === "agent" && (
        <>
          <select
            value={agentModel}
            onChange={(e) => setAgentModel(e.target.value)}
            className="text-xs rounded-lg px-2 min-h-[36px]"
            style={{
              background: "var(--color-bg-elevated)",
              color: "var(--color-text)",
              border: "1px solid var(--color-line-soft)",
            }}
            aria-label="Agent-Modell"
          >
            {SUPPORTED_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="text-[11px]" style={styles.muted}>
            Tool-Loop
          </span>
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {isWorkspace ? (
        <div className="shrink-0 px-4 md:px-8 pt-6 pb-4 flex items-center gap-3 max-w-3xl mx-auto w-full">
          <Link
            href="/"
            className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg shrink-0"
            style={{ color: "var(--color-muted)" }}
            aria-label="Zurück zur Übersicht"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </Link>
          <h1
            className="flex-1 min-w-0 truncate text-base md:text-lg font-semibold"
            style={styles.title}
          >
            {conversation.title}
          </h1>
        </div>
      ) : (
        <div
          className="shrink-0 px-4 md:px-6 py-3 border-b flex items-center gap-3"
          style={{
            borderColor: "var(--color-line-soft)",
            background: "var(--color-panel)",
          }}
        >
          <button
            type="button"
            onClick={onOpenDrawer}
            className="md:hidden inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg"
            style={{ color: "var(--color-text)" }}
            aria-label="Chats anzeigen"
          >
            <span className="block w-5 h-0.5 bg-current relative before:absolute before:-top-1.5 before:left-0 before:right-0 before:h-0.5 before:bg-current after:absolute after:top-1.5 after:left-0 after:right-0 after:h-0.5 after:bg-current" />
          </button>

          <div className="flex-1 min-w-0">
            <h1
              className="text-base md:text-lg font-semibold truncate"
              style={styles.title}
            >
              {conversation.title}
            </h1>
          </div>

          {models.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5">
              {models.filter((m) => m.available).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModel(m.id)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all min-h-[36px]"
                  style={{
                    background:
                      selectedModel === m.id
                        ? "var(--color-accent)"
                        : "var(--color-bg-elevated)",
                    color:
                      selectedModel === m.id
                        ? "var(--color-accent-text)"
                        : "var(--color-muted)",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className={
          isWorkspace
            ? "flex-1 overflow-y-auto px-4 md:px-8 py-2 flex flex-col gap-4 w-full max-w-3xl mx-auto"
            : "flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-4"
        }
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center py-12 animate-scale-in">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-xl"
              style={styles.accentSoft}
            >
              ?
            </div>
            <p
              className="text-base font-medium"
              style={{ color: "var(--color-text)" }}
            >
              Stell eine Frage
            </p>
            <p className="text-sm max-w-sm" style={styles.muted}>
              Antworten kommen ausschliesslich aus deinen Quellen — mit Hybrid-Suche
              (Volltext + Semantik) und Quellenangaben.
            </p>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end animate-slide-up">
                <div
                  className="rounded-2xl rounded-br-md px-4 py-2.5 max-w-[85%] md:max-w-[70%] text-sm"
                  style={styles.accent}
                >
                  {msg.content}
                </div>
              </div>
            );
          }

          if (msg.pending) {
            return (
              <div key={msg.id} className="flex items-center gap-2 animate-fade-in">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)", animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)", animationDelay: "300ms" }} />
                </div>
                <span className="text-xs" style={styles.muted}>
                  Suche und Antwort laufen …
                </span>
              </div>
            );
          }

          const uniqueSources = Array.from(
            new Set(msg.sources.map((s) => s.source_title).filter(Boolean) as string[]),
          );

          return (
            <div key={msg.id} className="max-w-[90%] md:max-w-[80%] animate-slide-up">
              <div className={card.flat} style={styles.panel}>
                <p
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ color: "var(--color-text)" }}
                >
                  {renderWithCitations(msg.content)}
                </p>
                {msg.steps && msg.steps.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px]" style={styles.muted}>
                      Schritte:
                    </span>
                    {msg.steps.map((s, i) => (
                      <span
                        key={`${msg.id}-step-${i}`}
                        className={badge.pill}
                        style={{
                          background: "var(--color-bg-elevated)",
                          color: s.ok ? "var(--color-success)" : "var(--color-danger)",
                        }}
                        title={`${s.latencyMs} ms`}
                      >
                        {s.ok ? "✓" : "✗"} {s.tool}
                      </span>
                    ))}
                  </div>
                )}
                {(msg.model || uniqueSources.length > 0) && (
                  <div
                    className="mt-3 pt-3 flex flex-wrap items-center gap-1.5"
                    style={{ borderTop: "1px solid var(--color-line-soft)" }}
                  >
                    {msg.model && (
                      <span
                        className={badge.pill}
                        style={{
                          background: "var(--color-bg-elevated)",
                          color: "var(--color-muted)",
                        }}
                      >
                        {msg.model === "claude" ? "Claude" : msg.model}
                      </span>
                    )}
                    {uniqueSources.length > 0 && (
                      <>
                        <span className="text-[11px]" style={styles.muted}>
                          Quellen:
                        </span>
                        {uniqueSources.map((t, i) => (
                          <span
                            key={`${msg.id}-${i}`}
                            className={badge.pill}
                            style={styles.accentSoft}
                          >
                            Q{i + 1} · {t}
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              {isAdmin && msg.sources.length > 0 && (
                <RetrievalDebug sources={msg.sources} />
              )}
            </div>
          );
        })}
      </div>

      {/* Input */}
      {isWorkspace ? (
        <div className="shrink-0 px-4 md:px-8 py-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
          {modeBar}
          <ChatComposer pending={pending} onSubmit={(text) => send(text)} />
        </div>
      ) : (
        <div
          className="shrink-0 px-4 md:px-6 py-3 border-t pb-[calc(12px+env(safe-area-inset-bottom))] md:pb-3"
          style={{
            borderColor: "var(--color-line-soft)",
            background: "var(--color-panel)",
          }}
        >
          {modeBar}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = question.trim();
              if (!q) return;
              setQuestion("");
              void send(q);
            }}
            className="flex gap-2"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Frage stellen …"
              disabled={pending}
              className={input.base}
              style={{
                ...styles.input,
                flex: 1,
                borderColor: "var(--color-line-soft)",
              }}
            />
            <button
              type="submit"
              disabled={pending || !question.trim()}
              className={btn.primary}
              style={{
                ...styles.accent,
                opacity: pending || !question.trim() ? 0.5 : 1,
              }}
            >
              Senden
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
