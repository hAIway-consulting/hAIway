"use client";

import { useRef, useState, useTransition } from "react";
import { startChat } from "./actions";
import { ModeToggle, type ComposerMode } from "@/app/chat/_components/chat-composer";

// Web Speech API — Browser-Diktat. Chrome / Edge / Safari unterstützen es;
// Firefox nicht. Wir feature-detecten und blenden den Mikro-Button aus,
// wenn die API fehlt, statt einen toten Knopf zu zeigen.
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
 * Hero-Frage-Feld auf der Workspace-Home. Submitted an die Server-Action
 * `startChat`, die eine neue Konversation anlegt und auf /chat/{id} redirected.
 *
 * UX:
 * - Auto-Focus, Enter sendet, Shift+Enter neue Zeile
 * - Mikrofon-Button für Diktat (Web Speech API, deutsch)
 * - Pending-State während Server-Action läuft
 */
export function HeroAsk({
  placeholder,
  agentAvailable = false,
}: {
  placeholder: string;
  /** agent_mode flag + provider availability — shows the Chat/Agent toggle */
  agentAvailable?: boolean;
}) {
  const [mode, setMode] = useState<ComposerMode>("chat");
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState("");
  const [recording, setRecording] = useState(false);
  // Feature-Detection: kein Effect, kein Hydration-Mismatch — der Button
  // rendert immer, deaktiviert sich aber selbst, wenn die API beim Klick
  // nicht da ist. Browser, die die API nicht unterstützen (Firefox), zeigen
  // einen kurzen Hinweis statt einen toten Knopf.
  const [unsupportedHint, setUnsupportedHint] = useState(false);

  function submit() {
    if (!value.trim() || pending) return;
    startTransition(() => {
      formRef.current?.requestSubmit();
    });
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
    rec.onerror = () => {
      setRecording(false);
    };
    rec.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
      // focus zurück ins Textfeld, damit der User direkt weiterschreiben kann
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
    <form
      ref={formRef}
      action={startChat}
      className="w-full max-w-2xl"
    >
      <div
        className="rounded-2xl flex flex-col gap-2 p-3 transition-shadow"
        style={{
          background: "var(--color-panel)",
          border: `1px solid ${recording ? "var(--color-accent)" : "var(--color-line)"}`,
          boxShadow: "var(--shadow-md)",
        }}
      >
        <textarea
          ref={textareaRef}
          name="question"
          autoFocus
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent outline-none text-[15px] md:text-base leading-relaxed px-2 pt-2"
          style={{ color: "var(--color-text)", caretColor: "var(--color-accent)" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <input type="hidden" name="mode" value={mode} />
        <div className="flex items-center justify-between gap-2 pl-2 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {agentAvailable && (
              <ModeToggle mode={mode} locked={false} disabled={pending} onSelect={setMode} />
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
                  // Stop-Icon (gefüllter Kreis im Kreis)
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="7" y="7" width="10" height="10" rx="1.5" />
                  </svg>
                ) : (
                  // Mikrofon-Icon
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
              )}
            </button>
            <button
              type="submit"
              disabled={pending || !value.trim()}
              className="min-h-[40px] px-4 rounded-xl text-[13px] font-semibold transition-all gradient-accent disabled:opacity-40"
              style={{
                color: "var(--color-accent-text)",
                cursor: pending || !value.trim() ? "not-allowed" : "pointer",
              }}
            >
              {pending ? "Sende…" : "Fragen →"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
