import { redirect } from "next/navigation";
import { getUser } from "@/lib/db/supabase-server";
import { hasFeature } from "@/lib/features/flags";
import { getCrmAccess } from "@/lib/features/crm";
import { CrmLaunchButton } from "./launch-button";

export const dynamic = "force-dynamic";

// Launch page for the Twenty CRM workspace. Deliberately NOT an iframe:
// Twenty blocks framing via CSP, and per strategy we do not rebuild CRM UI —
// this page is the hAIway-branded gateway (status, access, later KPIs).
export default async function CrmPage() {
  const user = await getUser();
  if (!user) redirect("/auth/anmelden");
  if (!(await hasFeature("crm_workspace"))) redirect("/");

  const access = await getCrmAccess();

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-[var(--content-max-w)] mx-auto flex flex-col gap-6 pb-[env(safe-area-inset-bottom)]">
      <header className="flex flex-col gap-1">
        <span
          className="text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--color-placeholder)" }}
        >
          Arbeiten · CRM
        </span>
        <h1
          className="text-2xl md:text-3xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
        >
          CRM
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Kontakte, Unternehmen und Deals — im Twenty-Arbeitsbereich von hAIway.
        </p>
      </header>

      {!access ? (
        <Card>
          <h2 className="text-base font-semibold mb-2" style={{ color: "var(--color-text)" }}>
            Kein CRM-Zugriff
          </h2>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Für dein Konto ist noch kein CRM-Zugang freigeschaltet. Wende dich an deine
            Beraterin / deinen Berater — der Zugang wird zentral im Admin-Bereich vergeben.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <AccessBadge access={access} />
            <span className="text-[12px]" style={{ color: "var(--color-muted)" }}>
              Stufe: {access.level}
            </span>
          </div>
          {access.syncStatus === "pending" && access.inviteStatus === "invited" && (
            <p className="text-[13px] mb-3" style={{ color: "var(--color-muted)" }}>
              Deine Einladung ist unterwegs — prüfe dein E-Mail-Postfach und schließe die
              Registrierung in Twenty ab. Danach kannst du das CRM direkt öffnen.
            </p>
          )}
          {access.syncStatus === "manual_required" && (
            <p className="text-[13px] mb-3" style={{ color: "var(--color-muted)" }}>
              Dein Zugang wird manuell eingerichtet — du bekommst eine Einladung per E-Mail.
            </p>
          )}
          {access.syncStatus === "error" && (
            <p className="text-[13px] mb-3" style={{ color: "var(--color-danger)" }}>
              Bei der Einrichtung ist ein Fehler aufgetreten — dein Admin wurde informiert.
            </p>
          )}
          <p className="text-[13px] mb-4" style={{ color: "var(--color-muted)" }}>
            Das CRM öffnet sich in einem neuen Tab. Anmeldung mit deiner
            E-Mail-Adresse ({user.email}).
          </p>
          {access.baseUrl && !access.baseUrl.startsWith("mock://") ? (
            <CrmLaunchButton url={access.baseUrl} />
          ) : access.baseUrl ? (
            <p className="text-[12px]" style={{ color: "var(--color-placeholder)" }}>
              Test-Modus (mock) — kein echtes CRM hinterlegt.
            </p>
          ) : (
            <p className="text-[12px]" style={{ color: "var(--color-placeholder)" }}>
              Die CRM-Instanz ist noch nicht konfiguriert.
            </p>
          )}
        </Card>
      )}

      {/* KPI slot: Twenty REST widgets (Pipeline, offene Deals, Aktivitäten)
          docken hier an, sobald das Outcome-Reporting für CRM priorisiert ist. */}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl p-5"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      {children}
    </section>
  );
}

function AccessBadge({
  access,
}: {
  access: { syncStatus: string };
}) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    synced: {
      label: "Zugriff aktiv",
      color: "var(--color-success)",
      bg: "var(--color-success-soft)",
    },
    pending: {
      label: "Einladung offen",
      color: "var(--color-warning)",
      bg: "var(--color-warning-soft)",
    },
    manual_required: {
      label: "Einrichtung läuft",
      color: "var(--color-warning)",
      bg: "var(--color-warning-soft)",
    },
    revoking: {
      label: "Wird entzogen",
      color: "var(--color-warning)",
      bg: "var(--color-warning-soft)",
    },
    error: {
      label: "Fehler",
      color: "var(--color-danger)",
      bg: "var(--color-danger-soft)",
    },
  };
  const entry = map[access.syncStatus] ?? map.pending;
  return (
    <span
      className="text-[11px] px-2 py-1 rounded-full font-medium"
      style={{ background: entry.bg, color: entry.color }}
    >
      {entry.label}
    </span>
  );
}
