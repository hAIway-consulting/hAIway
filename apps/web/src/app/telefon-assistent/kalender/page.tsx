import Link from "next/link";
import { getCalendarIntegration } from "@/lib/db/queries/phone-assistant";
import { getGoogleOAuthUrl, saveCalendarSettings, disconnectCalendar } from "../actions";
import { card, btn, input, page, styles } from "@/components/ui/table-classes";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function CalendarPage() {
  const calendar = await getCalendarIntegration();
  const isConnected = calendar?.status === "active" && calendar.has_refresh_token;
  const settings = calendar?.settings ?? {
    default_duration_minutes: 30,
    buffer_minutes: 15,
    working_hours_start: "09:00",
    working_hours_end: "17:00",
    timezone: "Europe/Berlin",
  };

  let oauthUrl = "";
  try {
    oauthUrl = await getGoogleOAuthUrl();
  } catch {
    // GOOGLE_CLIENT_ID not set
  }

  return (
    <div className={page.narrow}>
      <Link
        href="/telefon-assistent/einstellungen"
        className="text-xs font-medium inline-block animate-fade-in"
        style={{ color: "var(--color-accent)" }}
      >
        &larr; Einstellungen
      </Link>

      <h1
        className="text-xl md:text-2xl font-semibold animate-fade-in"
        style={styles.title}
      >
        Kalender-Integration
      </h1>

      {/* Connection Status */}
      <div className={`${card.base} flex flex-col gap-4 animate-slide-up`} style={styles.panel}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Google Kalender
        </h2>

        {isConnected ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: "var(--color-success)" }} />
              <span className="text-xs font-medium" style={{ color: "var(--color-success)" }}>
                Verbunden
              </span>
            </div>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              Kalender-ID: {calendar?.calendar_id ?? "primary"}
            </p>
            <form action={disconnectCalendar}>
              <button type="submit" className={btn.danger} style={styles.danger}>
                Verbindung trennen
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              Verbinde deinen Google Kalender, damit der Telefonassistent Termine fuer Anrufer
              vereinbaren kann.
            </p>
            {oauthUrl ? (
              <a href={oauthUrl} className={btn.primary} style={styles.accent}>
                Mit Google Kalender verbinden
              </a>
            ) : (
              <p className="text-xs" style={{ color: "var(--color-danger)" }}>
                Google OAuth ist nicht konfiguriert. Bitte GOOGLE_CLIENT_ID und
                GOOGLE_CLIENT_SECRET in den Umgebungsvariablen hinterlegen.
              </p>
            )}
          </>
        )}
      </div>

      {/* Calendar Settings */}
      <form action={saveCalendarSettings} className="flex flex-col gap-6 animate-slide-up">
        <div className={`${card.base} flex flex-col gap-4`} style={styles.panel}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Termineinstellungen
          </h2>

          <div className="flex flex-col gap-1.5">
            <label className={input.label} style={{ color: "var(--color-text)" }}>
              Kalender-ID
            </label>
            <input
              name="calendar_id"
              defaultValue={calendar?.calendar_id ?? "primary"}
              placeholder="primary"
              className={input.base}
              style={styles.input}
            />
            <p className={input.hint} style={styles.muted}>
              &quot;primary&quot; fuer den Hauptkalender oder eine spezifische Kalender-E-Mail.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Standard-Termindauer (Min.)
              </label>
              <select
                name="default_duration_minutes"
                defaultValue={settings.default_duration_minutes}
                className={input.base}
                style={styles.input}
              >
                <option value="15">15 Minuten</option>
                <option value="30">30 Minuten</option>
                <option value="45">45 Minuten</option>
                <option value="60">60 Minuten</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Puffer zwischen Terminen (Min.)
              </label>
              <select
                name="buffer_minutes"
                defaultValue={settings.buffer_minutes}
                className={input.base}
                style={styles.input}
              >
                <option value="0">Kein Puffer</option>
                <option value="5">5 Minuten</option>
                <option value="10">10 Minuten</option>
                <option value="15">15 Minuten</option>
                <option value="30">30 Minuten</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Arbeitszeiten Start
              </label>
              <input
                name="working_hours_start"
                type="time"
                defaultValue={settings.working_hours_start}
                className={input.base}
                style={styles.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={input.label} style={{ color: "var(--color-text)" }}>
                Arbeitszeiten Ende
              </label>
              <input
                name="working_hours_end"
                type="time"
                defaultValue={settings.working_hours_end}
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
              name="timezone"
              defaultValue={settings.timezone}
              className={input.base}
              style={styles.input}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <SubmitButton label="Speichern" pendingLabel="Wird gespeichert..." />
        </div>
      </form>
    </div>
  );
}
