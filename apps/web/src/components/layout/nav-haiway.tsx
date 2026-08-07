"use client";

import { recordCrmLaunch } from "@/app/crm/actions";
import {
  IconHome,
  IconUsers,
  IconChart,
  IconChat,
  IconPlug,
  IconAdmin,
  IconShield,
  IconImport,
  IconTrash,
  IconCrm,
  NavLink,
  NavGroupBlock,
  type NavGroup,
} from "./nav-primitives";

/**
 * HAIway-internes Sidebar — Platform-Admin (Flag oder owner/admin der
 * Plattform-Org). Operatives + strategisches Cockpit für unser Team. Gruppen:
 *  - Mission Control (Status + Plattform-Health)
 *  - Kunden (Pilotkunden)
 *  - Berater (eigener Arbeitsbereich — Cockpit)
 *  - Daten (Dateien, verbundene Quellen, Papierkorb, Berechtigungen)
 *  - Plattform (Integrationen, KI-Settings, AI-Keys, AI-Kosten, Retrieval)
 *
 * "Mein Unternehmen" lebt nicht mehr unter Kunden — Organisationseinstellungen
 * öffnen sich über das Profil-Dropdown in der Top-Bar (/organisation).
 */
export function NavHaiway({
  hasCrm,
  hasCrmAdmin,
  crmLaunchUrl,
}: {
  hasCrm?: boolean;
  hasCrmAdmin?: boolean;
  crmLaunchUrl?: string | null;
}) {
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
      label: "Kunden",
      items: [{ href: "/admin/kunden", label: "Kundenliste", icon: IconUsers }],
    },
    {
      label: "Berater",
      items: [
        { href: "/admin/cockpit", label: "Cockpit", icon: IconChat },
        ...(hasCrm ? [crmItem] : []),
      ],
    },
    {
      label: "Daten",
      items: [
        { href: "/sources", label: "Dateien", icon: IconImport },
        { href: "/quellen", label: "Verbundene Quellen", icon: IconPlug },
        { href: "/papierkorb", label: "Papierkorb", icon: IconTrash },
        { href: "/berechtigungen", label: "Berechtigungen", icon: IconShield },
      ],
    },
    {
      label: "Plattform",
      items: [
        { href: "/admin/daten", label: "Datenpools", icon: IconPlug },
        { href: "/admin/integrationen", label: "Datenquellen + Sync", icon: IconPlug },
        ...(hasCrmAdmin
          ? [{ href: "/admin/crm", label: "CRM-Zugänge", icon: IconCrm }]
          : []),
        { href: "/admin/ai-settings", label: "Chat-Verhalten", icon: IconAdmin },
        { href: "/admin/ai-keys", label: "AI-Keys", icon: IconShield },
        { href: "/admin/ai-kosten", label: "AI-Kosten", icon: IconChart },
        { href: "/admin/retrieval-qualitaet", label: "Retrieval-Qualität", icon: IconChart },
      ],
    },
  ];

  return (
    <nav className="flex flex-col gap-6 p-3 py-4">
      <div>
        <NavLink item={{ href: "/", label: "Mission Control", icon: IconHome }} exact />
      </div>
      {groups.map((g) => (
        <NavGroupBlock key={g.label} group={g} />
      ))}
    </nav>
  );
}
