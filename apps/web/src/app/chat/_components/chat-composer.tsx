"use client";

import { useRef, useState } from "react";

// Web Speech API — analog zur HeroAsk auf der Workspace-Home, damit
// Komponieren überall gleich aussieht und sich gleich anfühlt.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
};

function getSpeechCtor(): { new (): SpeechRecognitionLike } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Composer-Box für die Chat-Detail-Seite — gleicher visueller Code wie die
 * HeroAsk auf der Workspace-Home: rounded-2xl, mehrzeilige Textarea,
 * Mikrofon-Button, Send-Button. Der Owner-Component reicht das Senden über
 * `onSubmit(text)` ein und steuert pending/disabled-State von außen.
 */
export type ComposerMode = "chat" | "agent";

/**
 * Segmented Chat/Agent toggle (spec-cockpit.md §12.1). When the conversation
 * already has messages the mode is locked — tapping the other mode hands off
 * to `onSwitchMode` (new conversation, §12.4: no mixed conversations).
 */
export function ModeToggle({
  mode,
  locked,
  disabled,
  onSelect,
}: {
  mode: ComposerMode;
  locked: boolean;
  disabled?: boolean;
  onSelect: (mode: ComposerMode) => void;
}) {
  const options: { id: ComposerMode; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "agent", label: "Agent" },
  ];
  return (
    <div
      className="inline-flex items-center rounded-xl p-0.5"
      style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-line)" }}
      role="group"
      aria-label="Modus wählen"
    >
      {options.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={
              locked && !active
                ? "Moduswechsel startet eine neue Konversation"
                : o.id === "agent"
                  ? "Agent: nutzt Werkzeuge auf euren Daten"
                  : "Chat: Antworten aus euren Quellen"
            }
            onClick={() => onSelect(o.id)}
            className="min-h-[44px] px-3.5 rounded-[10px] text-[13px] font-semibold transition-all disabled:opacity-50"
            style={{
              background: active ? "var(--color-accent)" : "transparent",
              color: active ? "var(--color-accent-text)" : "var(--color-muted)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChatComposer({
  pending,
  onSubmit,
  placeholder = "Frage stellen — Enter zum Senden",
  mode,
  modeLocked = false,
  agentAvailable = false,
  onModeSelect,
}: {
  pending: boolean;
  onSubmit: (text: string) => void | Promise<void>;
  placeholder?: string;
  /** current conversation mode; toggle hidden when undefined or agent unavailable */
  mode?: ComposerMode;
  modeLocked?: boolean;
  agentAvailable?: boolean;
  onModeSelect?: (mode: ComposerMode) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [value, setValue] = useState("");
  const [recording, setRecording] = useState(false);
  const [unsupportedHint, setUnsupportedHint] = useState(false);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setValue("");
    void onSubmit(trimmed);
  }

  function startDictation() {
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      setUnsupportedHint(true);
      window.setTimeout(() => setUnsupportedHint(false), 4000);
      return;
    }
    const rec = new Ctor();
    rec.lang = "de-DE";
    rec.continuous = false;
    rec.interimResults = true;
    let finalTranscript = "";
    const baseValue = value;

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i] as ArrayLike<{ transcript: string }> & { isFinal?: boolean };
        const transcript = result[0]?.transcript ?? "";
        if ((result as { isFinal?: boolean }).isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      const merged = (baseValue ? baseValue.trimEnd() + " " : "") + finalTranscript + interim;
      setValue(merged);
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
      textareaRef.current?.focus();
    };

    recognitionRef.current = rec;
    setRecording(true);
    rec.start();
  }

  function stopDictation() {
    recognitionRef.current?.stop();
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div
        className="rounded-2xl flex flex-col gap-2 p-3 transition-shadow"
        style={{
          background: "var(--color-panel)",
          border: `1px solid ${recording ? "var(--color-accent)" : "var(--color-line)"}`,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <textarea
          ref={textareaRef}
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={pending}
          className="w-full resize-none bg-transparent outline-none text-[15px] leading-relaxed px-2 pt-1 disabled:opacity-60"
          style={{ color: "var(--color-text)", caretColor: "var(--color-accent)" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2 pl-2 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {mode && agentAvailable && onModeSelect && (
              <ModeToggle
                mode={mode}
                locked={modeLocked}
                disabled={pending}
                onSelect={onModeSelect}
              />
            )}
            <span className="text-[11px] truncate" style={{ color: unsupportedHint ? "var(--color-warning)" : "var(--color-placeholder)" }}>
              {unsupportedHint
                ? "Diktat funktioniert nur in Chrome, Edge und Safari."
                : recording
                ? "Höre zu — sprich einfach drauflos…"
                : "Enter zum Senden · Shift+Enter für neue Zeile"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={recording ? stopDictation : startDictation}
              aria-label={recording ? "Diktat stoppen" : "Diktat starten"}
              className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-all"
              style={{
                background: recording ? "var(--color-accent)" : "var(--color-bg-elevated)",
                color: recording ? "var(--color-accent-text)" : "var(--color-muted)",
                border: `1px solid ${recording ? "var(--color-accent)" : "var(--color-line)"}`,
              }}
            >
              {recording ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="7" y="7" width="10" height="10" rx="1.5" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !value.trim()}
              className="min-h-[40px] px-4 rounded-xl text-[13px] font-semibold transition-all gradient-accent disabled:opacity-40"
              style={{ color: "var(--color-accent-text)", cursor: pending || !value.trim() ? "not-allowed" : "pointer" }}
            >
              {pending ? "Sende…" : "Senden →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
