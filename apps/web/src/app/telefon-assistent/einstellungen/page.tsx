import Link from "next/link";
import { getAssistant, getCalendarIntegration } from "@/lib/db/queries/phone-assistant";
import { VOICE_OPTIONS, LANGUAGE_MODES } from "@/lib/constants/phone-assistant";
import { createOrUpdateAssistant, toggleAssistantStatus, provisionVapiAssistant, syncVapiConfig } from "../actions";
import { TestCallButton } from "@/components/phone/test-call-button";
import { card, btn, input, page, styles } from "@/components/ui/table-classes";
import { SubmitButton } from "@/components/ui/submit-button";
import { VapiActionButton } from "@/components/phone/vapi-action-button";

export default async function AssistantSettingsPage() {
  const assistant = await getAssistant();
  const calendar = await getCalendarIntegration();
  const isCalendarConnected = calendar?.status === "active" && !!calendar?.has_refresh_token;

  return (
    <div className={page.narrow}>
      <Link
        href="/telefon-assistent"
        className="text-xs font-medium inline-block animate-fade-in"
        style={{ color: "var(--color-accent)" }}
      >
        &larr; Telefonassistent
      </Link>

      <div className="flex items-center justify-between animate-fade-in">
        <h1 className="text-xl md:text-2xl font-semibold" style={styles.title}>
          Einstellungen
        </h1>
        {assistant && (
          <form action={toggleAssistantStatus}>
            <button
              type="submit"
              className={btn.secondary}
              style={
                assistant.status === "active"
                  ? styles.warning
                  : styles.accentSoft
              }
            >
              {assistant.status === "active" ? "Pausieren" : "Aktivieren"}
            </button>
          </form>
        )}
      </div>

      <form action={createOrUpdateAssistant} className="flex flex-col gap-6 animate-slide-up">
        {/* Basic */}
        <div className={`${card.base} flex flex-col gap-4`} style={styles.panel}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Allgemein
          </h2>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Name
            </label>
            <input
              name="name"
              defaultValue={assistant?.name ?? "Telefonassistent"}
              className={input.base}
              style={styles.input}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              System-Prompt
            </label>
            <textarea
              name="system_prompt"
              rows={4}
              defaultValue={assistant?.system_prompt ?? ""}
              placeholder="Anweisungen fuer den Assistenten..."
              className={input.textarea}
              style={styles.input}
            />
            <p className={input.hint} style={styles.muted}>
              Definiert das Verhalten des Assistenten. Wird zusammen mit RAG-Kontext an das LLM gesendet.
            </p>
          </div>
        </div>

        {/* Greetings */}
        <div className={`${card.base} flex flex-col gap-4`} style={styles.panel}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Begruessung
          </h2>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Begruessung (Deutsch)
            </label>
            <input
              name="greeting_de"
              defaultValue={assistant?.greeting_de ?? ""}
              placeholder="Hallo, willkommen! Wie kann ich Ihnen helfen?"
              className={input.base}
              style={styles.input}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Begruessung (Englisch)
            </label>
            <input
              name="greeting_en"
              defaultValue={assistant?.greeting_en ?? ""}
              placeholder="Hello, welcome! How can I help you?"
              className={input.base}
              style={styles.input}
            />
          </div>
        </div>

        {/* Voice & Language */}
        <div className={`${card.base} flex flex-col gap-4`} style={styles.panel}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Stimme & Sprache
          </h2>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Sprachmodus
            </label>
            <select
              name="language_mode"
              defaultValue={assistant?.language_mode ?? "auto"}
              className={input.base}
              style={styles.input}
            >
              {LANGUAGE_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Stimme (Deutsch)
              </label>
              <select
                name="voice_id_de"
                defaultValue={assistant?.voice_id_de ?? "alloy"}
                className={input.base}
                style={styles.input}
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Stimme (Englisch)
              </label>
              <select
                name="voice_id_en"
                defaultValue={assistant?.voice_id_en ?? "alloy"}
                className={input.base}
                style={styles.input}
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* RAG Config */}
        <div className={`${card.base} flex flex-col gap-4`} style={styles.panel}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            RAG-Konfiguration
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Max. Chunks pro Antwort
              </label>
              <input
                name="max_chunks"
                type="number"
                min="1"
                max="20"
                defaultValue={assistant?.max_chunks ?? 5}
                className={input.base}
                style={styles.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Boost-Faktor
              </label>
              <input
                name="boost_factor"
                type="number"
                min="1"
                max="5"
                step="0.1"
                defaultValue={assistant?.boost_factor ?? 1.5}
                className={input.base}
                style={styles.input}
              />
              <p className={input.hint} style={styles.muted}>
                Hoehere Werte bevorzugen verknuepfte Quellen staerker.
              </p>
            </div>
          </div>
        </div>

        {/* Call Limits */}
        <div className={`${card.base} flex flex-col gap-4`} style={styles.panel}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Anruf-Limits
          </h2>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Max. Anrufdauer (Sekunden)
            </label>
            <input
              name="max_call_duration_seconds"
              type="number"
              min="60"
              max="3600"
              defaultValue={assistant?.max_call_duration_seconds ?? 600}
              className={input.base}
              style={styles.input}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Geschaeftszeiten Start
              </label>
              <input
                name="business_hours_start"
                type="time"
                defaultValue={assistant?.business_hours_start ?? ""}
                className={input.base}
                style={styles.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Geschaeftszeiten Ende
              </label>
              <input
                name="business_hours_end"
                type="time"
                defaultValue={assistant?.business_hours_end ?? ""}
                className={input.base}
                style={styles.input}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Zeitzone
            </label>
            <input
              name="business_hours_tz"
              defaultValue={assistant?.business_hours_tz ?? "Europe/Berlin"}
              className={input.base}
              style={styles.input}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Nachricht ausserhalb Geschaeftszeiten
            </label>
            <textarea
              name="after_hours_message"
              rows={2}
              defaultValue={assistant?.after_hours_message ?? ""}
              placeholder="Unser Telefonassistent ist derzeit nicht erreichbar..."
              className={input.textarea}
              style={styles.input}
            />
          </div>
        </div>

        {/* Notifications */}
        <div className={`${card.base} flex flex-col gap-4`} style={styles.panel}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Benachrichtigungen
          </h2>
          <p className={input.hint} style={styles.muted}>
            Erhalten Sie nach jedem Anruf eine Zusammenfassung mit Aktionspunkten per E-Mail.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Benachrichtigungsmodus
            </label>
            <select
              name="notification_mode"
              defaultValue={assistant?.notification_mode ?? "none"}
              className={input.base}
              style={styles.input}
            >
              <option value="none">Aus</option>
              <option value="email">E-Mail nach jedem Anruf</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              E-Mail-Adresse
            </label>
            <input
              name="notification_email"
              type="email"
              defaultValue={assistant?.notification_email ?? ""}
              placeholder="benachrichtigung@firma.de"
              className={input.base}
              style={styles.input}
            />
            <p className={input.hint} style={styles.muted}>
              An diese Adresse werden Anruf-Zusammenfassungen gesendet.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <SubmitButton label="Speichern" pendingLabel="Wird gespeichert..." />
        </div>
      </form>

      {/* Vapi Integration */}
      {assistant && (
        <div className={`${card.base} flex flex-col gap-4 animate-slide-up`} style={styles.panel}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Vapi-Integration
          </h2>

          {assistant.provider_assistant_id ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: "var(--color-success)" }} />
                <span className="text-xs font-medium" style={{ color: "var(--color-success)" }}>
                  Bei Vapi registriert
                </span>
              </div>
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                Provider-ID: {assistant.provider_assistant_id}
              </p>
              <VapiActionButton
                action={syncVapiConfig}
                label="Config synchronisieren"
                pendingLabel="Synchronisiere..."
              />
              <div
                className="border-t pt-4 mt-2"
                style={{ borderColor: "var(--color-line)" }}
              >
                <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                  Testen Sie den Assistenten mit einem Browsertelefonat. Der Anruf durchlaeuft die vollstaendige Pipeline (Vapi → RAG → Kalender).
                </p>
                <TestCallButton />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                Der Assistent muss bei Vapi registriert werden, damit eingehende Anrufe
                an die RAG-Pipeline weitergeleitet werden.
              </p>
              <VapiActionButton
                action={provisionVapiAssistant}
                label="Bei Vapi registrieren"
                pendingLabel="Wird registriert..."
              />
            </>
          )}
        </div>
      )}

      {/* Calendar Integration */}
      <div className={`${card.base} flex flex-col gap-4 animate-slide-up`} style={styles.panel}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Kalender-Integration
        </h2>

        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: isCalendarConnected ? "var(--color-success)" : "var(--color-muted)" }}
          />
          <span
            className="text-xs font-medium"
            style={{ color: isCalendarConnected ? "var(--color-success)" : "var(--color-muted)" }}
          >
            {isCalendarConnected ? "Google Kalender verbunden" : "Nicht verbunden"}
          </span>
        </div>

        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          {isCalendarConnected
            ? "Anrufer koennen ueber den Telefonassistenten Termine vereinbaren."
            : "Verbinde deinen Google Kalender, damit Anrufer Termine vereinbaren koennen."}
        </p>

        <Link
          href="/telefon-assistent/kalender"
          className={btn.secondary}
          style={styles.accentSoft}
        >
          {isCalendarConnected ? "Kalender verwalten" : "Kalender verbinden"}
        </Link>
      </div>
    </div>
  );
}
