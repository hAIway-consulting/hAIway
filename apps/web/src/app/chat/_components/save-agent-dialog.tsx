"use client";

// Save-agent dialog (spec-cockpit.md §9): summarizes the current agent
// conversation into an editable draft and persists it ONLY after the user
// reviewed it — review instead of blackbox. Never saves without showing
// the draft first.

import { useEffect, useState } from "react";
import Link from "next/link";
import { proposeSavedAgent, saveSavedAgent } from "../agent-actions";
import { input as inputCls, styles } from "@/components/ui/table-classes";

const NAME_MAX = 80;
const PROMPT_MAX = 4000;

type Phase = "loading" | "edit" | "saving" | "done" | "error";

export default function SaveAgentDialog({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [visibility, setVisibility] = useState<"private" | "org">("private");
  const [error, setError] = useState<string | null>(null);

  // Fetch the editable draft on mount — the summarizer runs server-side.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const draft = await proposeSavedAgent(conversationId);
        if (cancelled) return;
        setName(draft.name);
        setDescription(draft.description);
        setPrompt(draft.prompt);
        setPhase("edit");
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Die Zusammenfassung ist fehlgeschlagen. Bitte versuche es erneut.",
        );
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const canSave =
    phase === "edit" && name.trim().length > 0 && prompt.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setPhase("saving");
    setError(null);
    try {
      await saveSavedAgent({
        name: name.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        visibility,
        sourceConversationId: conversationId,
      });
      setPhase("done");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Der Agent konnte nicht gespeichert werden. Bitte versuche es erneut.",
      );
      setPhase("edit");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== "saving") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Diesen Agenten speichern"
    >
      <div
        className="w-full max-w-lg max-h-[90dvh] rounded-t-2xl md:rounded-2xl overflow-hidden animate-scale-in flex flex-col"
        style={{
          background: "var(--color-panel)",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        {/* Header */}
        <div
          className="px-5 md:px-6 py-4 shrink-0 flex items-center justify-between gap-3"
          style={{ borderBottom: "1px solid var(--color-line-soft)" }}
        >
          <h2 className="text-base font-semibold" style={styles.title}>
            Diesen Agenten speichern
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "saving"}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg -mr-2"
            style={{ color: "var(--color-muted)" }}
            aria-label="Dialog schließen"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 md:px-6 py-5">
          {phase === "loading" && (
            <div className="flex items-center gap-3 py-8 justify-center">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)", animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)", animationDelay: "300ms" }} />
              </div>
              <span className="text-sm" style={styles.muted}>
                Agent wird zusammengefasst …
              </span>
            </div>
          )}

          {phase === "error" && (
            <div
              className="rounded-xl p-4 text-sm"
              style={styles.danger}
              role="alert"
            >
              {error}
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}
                aria-hidden
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                Agent gespeichert.
              </p>
              <p className="text-sm" style={styles.muted}>
                Du findest ihn ab jetzt auf der Übersichtsseite — ein Klick startet ihn.
              </p>
              <Link
                href="/"
                className="inline-flex items-center justify-center px-5 min-h-[44px] rounded-xl text-sm font-medium"
                style={styles.accent}
              >
                Zur Übersicht
              </Link>
            </div>
          )}

          {(phase === "edit" || phase === "saving") && (
            <div className="flex flex-col gap-4">
              {error && (
                <div className="rounded-xl p-3 text-sm" style={styles.danger} role="alert">
                  {error}
                </div>
              )}

              <p className="text-sm" style={styles.muted}>
                Prüfe und bearbeite die Zusammenfassung, bevor du speicherst.
              </p>

              <label className="flex flex-col gap-1.5">
                <span className={inputCls.label} style={{ color: "var(--color-text)" }}>
                  Name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={NAME_MAX}
                  disabled={phase === "saving"}
                  className={inputCls.base}
                  style={styles.input}
                  placeholder="z. B. Angebot entwerfen"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={inputCls.label} style={{ color: "var(--color-text)" }}>
                  Beschreibung
                </span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={200}
                  disabled={phase === "saving"}
                  className={inputCls.base}
                  style={styles.input}
                  placeholder="Was erledigt dieser Agent?"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={inputCls.label} style={{ color: "var(--color-text)" }}>
                    Prompt
                  </span>
                  <span className="text-xs tabular-nums" style={styles.muted}>
                    {prompt.length} / {PROMPT_MAX}
                  </span>
                </span>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
                  maxLength={PROMPT_MAX}
                  rows={8}
                  disabled={phase === "saving"}
                  className={inputCls.textarea}
                  style={styles.input}
                  placeholder="Arbeitsauftrag für den Agenten …"
                />
              </label>

              <fieldset className="flex flex-col gap-1.5">
                <legend className={inputCls.label} style={{ color: "var(--color-text)" }}>
                  Sichtbarkeit
                </legend>
                {(
                  [
                    { value: "private", label: "Privat", hint: "Nur du siehst diesen Agenten." },
                    { value: "org", label: "Team", hint: "Alle in deiner Organisation können ihn starten." },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-3 px-3 min-h-[48px] rounded-xl cursor-pointer"
                    style={{
                      border:
                        visibility === opt.value
                          ? "1px solid var(--color-accent)"
                          : "1px solid var(--color-line)",
                      background:
                        visibility === opt.value
                          ? "var(--color-accent-soft)"
                          : "var(--color-panel-strong)",
                    }}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={opt.value}
                      checked={visibility === opt.value}
                      onChange={() => setVisibility(opt.value)}
                      disabled={phase === "saving"}
                      className="w-4 h-4 shrink-0"
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <span className="flex flex-col py-2">
                      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                        {opt.label}
                      </span>
                      <span className="text-xs" style={styles.muted}>
                        {opt.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
          )}
        </div>

        {/* Footer */}
        {(phase === "edit" || phase === "saving" || phase === "error") && (
          <div
            className="px-5 md:px-6 py-4 shrink-0 flex justify-end gap-2 pb-[calc(16px+env(safe-area-inset-bottom))] md:pb-4"
            style={{ borderTop: "1px solid var(--color-line-soft)" }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={phase === "saving"}
              className="inline-flex items-center justify-center px-5 min-h-[44px] rounded-xl text-sm font-medium"
              style={{ color: "var(--color-muted)" }}
            >
              Abbrechen
            </button>
            {phase !== "error" && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!canSave}
                className="inline-flex items-center justify-center px-5 min-h-[44px] rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40"
                style={styles.accent}
              >
                {phase === "saving" ? "Speichern …" : "Speichern"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
