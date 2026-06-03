"use client";

import { useState, useTransition } from "react";
import { saveAiSettings } from "./actions";
import { btn, input, styles } from "@/components/ui/table-classes";

type Tone = "formal" | "casual" | "neutral";
type Lang = "de" | "en";
type AgentProvider = "" | "anthropic" | "openai-compatible";

const MAX_PROMPT = 4000;

export default function AiSettingsForm(props: {
  initialPrompt: string;
  initialTone: Tone;
  initialLanguage: Lang;
  initialAgentProvider: AgentProvider;
  initialAgentModel: string;
  initialAgentBaseUrl: string;
}) {
  const [prompt, setPrompt] = useState(props.initialPrompt);
  const [tone, setTone] = useState<Tone>(props.initialTone);
  const [language, setLanguage] = useState<Lang>(props.initialLanguage);
  const [agentProvider, setAgentProvider] = useState<AgentProvider>(props.initialAgentProvider);
  const [agentModel, setAgentModel] = useState(props.initialAgentModel);
  const [agentBaseUrl, setAgentBaseUrl] = useState(props.initialAgentBaseUrl);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleSave() {
    startTransition(async () => {
      await saveAiSettings({
        system_prompt: prompt.slice(0, MAX_PROMPT),
        tone,
        language,
        agent_provider: agentProvider,
        agent_model: agentModel,
        agent_base_url: agentBaseUrl,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label className={input.label} style={{ color: "var(--color-text)" }}>
          System-Prompt fuer die Organisation
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={10}
          maxLength={MAX_PROMPT}
          placeholder="z.B. Du bist der KI-Assistent von Acme GmbH. Antworte immer in Bullet-Points. Bei Vertriebsfragen verweise zusaetzlich auf den Account-Manager. ..."
          className={input.textarea}
          style={styles.input}
        />
        <p className={input.hint} style={styles.muted}>
          {prompt.length} / {MAX_PROMPT} Zeichen. Wird vor den Plattform-Basisregeln eingefuegt.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label className={input.label} style={{ color: "var(--color-text)" }}>
            Tonalitaet
          </label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value as Tone)}
            className={input.base}
            style={styles.input}
          >
            <option value="neutral">Neutral</option>
            <option value="formal">Sachlich-Formell</option>
            <option value="casual">Locker</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className={input.label} style={{ color: "var(--color-text)" }}>
            Sprache
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Lang)}
            className={input.base}
            style={styles.input}
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* Agentic model (tool-calling) — pluggable provider incl. local */}
      <div className="flex flex-col gap-3 rounded-xl p-4" style={styles.panel}>
        <div>
          <label className={input.label} style={{ color: "var(--color-text)" }}>
            Agent-Modell (Tool-Calling)
          </label>
          <p className={input.hint} style={styles.muted}>
            Steuert den Agenten im Chat (Auswertungen, Integrations-Daten, Trello-Aktionen). Leer =
            Plattform-Standard. Für ein lokal gehostetes Modell „OpenAI-kompatibel“ wählen und die
            Base-URL setzen.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Provider
            </label>
            <select
              value={agentProvider}
              onChange={(e) => setAgentProvider(e.target.value as AgentProvider)}
              className={input.base}
              style={styles.input}
            >
              <option value="">Plattform-Standard</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai-compatible">OpenAI-kompatibel / lokal</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Modell-Name
            </label>
            <input
              type="text"
              value={agentModel}
              onChange={(e) => setAgentModel(e.target.value)}
              placeholder="z.B. claude-sonnet-4-6 oder llama3.1"
              className={input.base}
              style={styles.input}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className={input.label} style={{ color: "var(--color-text)" }}>
            Base-URL (nur für lokale / OpenAI-kompatible Endpoints)
          </label>
          <input
            type="text"
            value={agentBaseUrl}
            onChange={(e) => setAgentBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            className={input.base}
            style={styles.input}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className={btn.primary}
          style={{ ...styles.accent, opacity: pending ? 0.6 : 1 }}
        >
          {pending ? "Speichere …" : "Speichern"}
        </button>
        {saved && (
          <span className="text-sm" style={{ color: "var(--color-accent)" }}>
            Gespeichert.
          </span>
        )}
      </div>
    </div>
  );
}
