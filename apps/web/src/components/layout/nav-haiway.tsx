"use client";

import {
  IconHome,
  IconUsers,
  IconChart,
  IconChat,
  IconPlug,
  IconAdmin,
  IconBox,
  IconSources,
  IconShield,
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
 *  - Berater (eigener Arbeitsbereich — Cockpit + Automatisierungen)
 *  - Bibliothek (cross-tenant Automatisierungen + Skills, admin spec §3/§4)
 *  - Plattform (Integrationen, KI-Settings, AI-Keys, AI-Kosten, Retrieval)
 *
 * "Mein Unternehmen" lebt nicht mehr unter Kunden — Organisationseinstellungen
 * öffnen sich über das Profil-Dropdown in der Top-Bar (/organisation).
 */
export function NavHaiway({
  hasCrm,
  hasCrmAdmin,
}: {
  hasCrm?: boolean;
  hasCrmAdmin?: boolean;
}) {
  const groups: NavGroup[] = [
    {
      label: "Kunden",
      items: [{ href: "/admin/kunden", label: "Kundenliste", icon: IconUsers }],
    },
    {
      label: "Berater",
      items: [
        { href: "/admin/cockpit", label: "Cockpit", icon: IconChat },
        { href: "/admin/automatisierungen", label: "Automatisierungen", icon: IconBox },
        ...(hasCrm ? [{ href: "/crm", label: "CRM", icon: IconCrm }] : []),
      ],
    },
    {
      label: "Bibliothek",
      items: [
        { href: "/admin/bibliothek/automatisierungen", label: "Automatisierungen", icon: IconBox },
        { href: "/admin/bibliothek/skills", label: "Skills", icon: IconSources },
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
