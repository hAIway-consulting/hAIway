"use client";

import {
  IconHome,
  IconSources,
  IconShield,
  IconChart,
  IconChat,
  IconPlug,
  IconPhone,
  IconBuilding,
  IconBox,
  NavLink,
  NavGroupBlock,
  type NavGroup,
} from "./nav-primitives";

/**
 * Berater-Sidebar — Berater-Persona (organization_members.role IN
 * ('admin','owner','manager','berater')). Konfiguriert pro Org: Datenpools,
 * Berechtigungen, KPIs, Integrationen.
 *
 * Variante "manager" (default) zeigt die volle Navigation inkl. Verwaltung.
 * Variante "berater" zeigt nur den Arbeitsbereich (Outcome + Datenpools) —
 * ohne Berechtigungen, Sync-Verwaltung und Branding.
 */
export function NavBerater({
  hasPhoneAssistant,
  variant = "manager",
}: {
  hasPhoneAssistant?: boolean;
  variant?: "manager" | "berater";
}) {
  const isManager = variant === "manager";
  const groups: NavGroup[] = [
    {
      label: "Daten & Zugriff",
      items: [
        { href: "/admin/daten", label: "Datenpools", icon: IconSources },
        ...(isManager
          ? [{ href: "/berechtigungen", label: "Berechtigungen", icon: IconShield }]
          : []),
      ],
    },
    {
      label: "Outcome",
      items: [
        { href: "/admin/cockpit", label: "Cockpit", icon: IconChat },
        { href: "/admin/automatisierungen", label: "Automatisierungen", icon: IconBox },
        { href: "/admin/retrieval-qualitaet", label: "KPIs", icon: IconChart },
      ],
    },
    ...(isManager
      ? [
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
        ]
      : []),
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
