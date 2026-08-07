import { ShellTabs } from "@/components/layout/shell-tabs";

/**
 * Berater-Cockpit-Verwaltung (docs/spec-berater-dashboard.md §8): one
 * section, two tabs. The /admin layout already gates on platform admin OR
 * Berater (role admin/owner); every mutation re-checks via
 * requireBeraterRole() in its server action.
 */
export default function CockpitVerwaltungLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <header className="flex flex-col gap-1">
        <span
          className="text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--color-placeholder)" }}
        >
          Berater
        </span>
        <h1
          className="text-2xl md:text-3xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
        >
          Cockpit-Verwaltung
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Agenten beaufsichtigen und Nutzung &amp; Kosten im Blick behalten — nichts wird für
          den Kunden sichtbar, was hier nicht freigegeben ist.
        </p>
      </header>

      <ShellTabs
        tabs={[
          { href: "/admin/cockpit/agenten", label: "Agenten & Runs" },
          { href: "/admin/cockpit/modelle", label: "Modelle & Kosten" },
        ]}
      />

      {children}
    </div>
  );
}
