"use client";

import { recordCrmLaunch } from "@/app/crm/actions";
import {
  IconHome,
  IconSources,
  IconShield,
  IconChat,
  IconPlug,
  IconPhone,
  IconImport,
  IconTrash,
  IconCrm,
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
 * ohne Berechtigungen, Papierkorb und Sync-Verwaltung.
 */
export function NavBerater({
  hasPhoneAssistant,
  hasCrm,
  hasCrmAdmin,
  crmLaunchUrl,
  variant = "manager",
}: {
  hasPhoneAssistant?: boolean;
  hasCrm?: boolean;
  hasCrmAdmin?: boolean;
  crmLaunchUrl?: string | null;
  variant?: "manager" | "berater";
}) {
  const isManager = variant === "manager";
  const crmItem = crmLaunchUrl
    ? {
        href: crmLaunchUrl,
        label: "CRM",
        icon: IconCrm,
        external: true,
        onOpen: () => void recordCrmLaunch(),
      }
    : { href: "/crm", label: "CRM", icon: IconCrm };
  const groups: NavGroup[] = [
    {
      label: "Daten & Zugriff",
      items: [
        { href: "/admin/daten", label: "Datenpools", icon: IconSources },
        { href: "/sources", label: "Dateien", icon: IconImport },
        { href: "/quellen", label: "Verbundene Quellen", icon: IconPlug },
        ...(isManager
          ? [
              { href: "/berechtigungen", label: "Berechtigungen", icon: IconShield },
              { href: "/papierkorb", label: "Papierkorb", icon: IconTrash },
            ]
          : []),
      ],
    },
    {
      label: "Outcome",
      items: [
        { href: "/admin/cockpit", label: "Cockpit", icon: IconChat },
        ...(hasCrm ? [crmItem] : []),
        // No /admin/retrieval-qualitaet here: the page is cross-tenant and
        // platform-admin-only (every action in its actions.ts calls
        // requireAdmin() -> isPlatformAdmin()). Offering it to Berater produced
        // a dead link — it is reachable from the hAIway nav instead.
      ],
    },
    ...(isManager
      ? [
          {
            label: "System",
            items: [
              { href: "/admin/integrationen", label: "Datenquellen + Sync", icon: IconPlug },
              ...(hasCrmAdmin
                ? [{ href: "/admin/crm", label: "CRM-Zugänge", icon: IconCrm }]
                : []),
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
