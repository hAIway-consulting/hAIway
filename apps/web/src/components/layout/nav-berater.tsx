"use client";

import {
  IconHome,
  IconSources,
  IconShield,
  IconChart,
  IconPlug,
  IconPhone,
  IconBuilding,
  NavLink,
  NavGroupBlock,
  type NavGroup,
} from "./nav-primitives";

/**
 * Berater-Sidebar — Kunden-Admin (organization_members.role IN ('admin','owner')).
 * Konfiguriert pro Kunden-Org: Datenpools, Berechtigungen, KPIs, Integrationen.
 */
export function NavBerater({ hasPhoneAssistant }: { hasPhoneAssistant?: boolean }) {
  const groups: NavGroup[] = [
    {
      label: "Daten & Zugriff",
      items: [
        { href: "/admin/daten", label: "Datenpools", icon: IconSources },
        { href: "/berechtigungen", label: "Berechtigungen", icon: IconShield },
      ],
    },
    {
      label: "Outcome",
      items: [
        { href: "/admin/vertriebssteuerung", label: "Vertriebssteuerung", icon: IconChart },
        { href: "/admin/retrieval-qualitaet", label: "KPIs", icon: IconChart },
      ],
    },
    {
      label: "System",
      items: [
        { href: "/admin/integrationen", label: "Datenquellen + Sync", icon: IconPlug },
        { href: "/admin/branding", label: "Branding", icon: IconBuilding },
        ...(hasPhoneAssistant
          ? [{ href: "/telefon-assistent", label: "Telefon", icon: IconPhone }]
          : []),
      ],
    },
  ];

  return (
    <nav className="flex flex-col gap-6 p-3 py-4">
      <div>
        <NavLink item={{ href: "/", label: "Übersicht", icon: IconHome }} exact />
      </div>
      {groups.map((g) => (
        <NavGroupBlock key={g.label} group={g} />
      ))}
    </nav>
  );
}
