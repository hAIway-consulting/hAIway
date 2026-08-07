import Link from "next/link";
import { getAssistant, listPhoneNumbers } from "@/lib/db/queries/phone-assistant";
import { PHONE_NUMBER_STATUS_LABELS } from "@/lib/constants/phone-assistant";
import { card, badge, page, styles } from "@/components/ui/table-classes";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export default async function PhoneNumbersPage() {
  const [assistant, numbers] = await Promise.all([
    getAssistant(),
    listPhoneNumbers(),
  ]);

  return (
    <div className={page.wrapper}>
      <Link
        href="/telefon-assistent"
        className="text-xs font-medium inline-block animate-fade-in"
        style={{ color: "var(--color-accent)" }}
      >
        &larr; Telefonassistent
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-fade-in">
        <h1 className="text-xl md:text-2xl font-semibold" style={styles.title}>
          Telefonnummern
        </h1>
      </div>

      {!assistant && (
        <div className={`${card.base} text-center py-8 animate-slide-up`} style={styles.panel}>
          <p className="text-sm" style={styles.muted}>
            Bitte richten Sie zuerst den Telefonassistenten ein.
          </p>
          <Link
            href="/telefon-assistent/einstellungen"
            className="text-xs font-medium mt-2 inline-block"
            style={{ color: "var(--color-accent)" }}
          >
            Zu den Einstellungen
          </Link>
        </div>
      )}

      {assistant && numbers.length === 0 && (
        <div className={`${card.base} text-center py-8 animate-slide-up`} style={styles.panel}>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text)" }}>
            Keine Nummern konfiguriert
          </p>
          <p className="text-xs" style={styles.muted}>
            Fuer diese Organisation ist noch keine Rufnummer hinterlegt.
            Rufnummern werden von hAIway eingerichtet und erscheinen
            anschliessend automatisch in dieser Liste.
          </p>
        </div>
      )}

      {numbers.length > 0 && (
        <div className="flex flex-col gap-2 animate-slide-up">
          {numbers.map((num) => {
            const statusInfo =
              PHONE_NUMBER_STATUS_LABELS[num.status] ?? {
                label: num.status,
                color: "var(--color-muted)",
              };
            return (
              <div key={num.id} className={card.base} style={styles.panel}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                      {num.phone_number}
                    </p>
                    {num.display_name && (
                      <p className="text-xs" style={styles.muted}>
                        {num.display_name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={badge.base}
                      style={{ background: `${statusInfo.color}15`, color: statusInfo.color }}
                    >
                      {statusInfo.label}
                    </span>
                    <span className="text-xs" style={styles.muted}>
                      seit {formatDate(num.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
