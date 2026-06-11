"use client";

import {
  IconHome,
  IconUsers,
  IconChart,
  IconBuilding,
  IconPlug,
  IconAdmin,
  IconBox,
  IconSources,
  IconShield,
  NavLink,
  NavGroupBlock,
  type NavGroup,
} from "./nav-primitives";

/**
 * HAIway-internes Sidebar — Platform-Admin (profiles.is_platform_admin=true).
 * Operatives + strategisches Cockpit für unser Team. Gruppen:
 *  - Mission Control (Status + Plattform-Health)
 *  - Kunden (Pilotkunden)
 *  - Bibliothek (cross-tenant Automatisierungen + Skills, admin spec §3/§4)
 *  - Plattform (Integrationen, KI-Settings, AI-Keys, AI-Kosten, Retrieval)
 */
const groups: NavGroup[] = [
  {
    label: "Kunden",
    items: [
      { href: "/admin/kunden", label: "Kundenliste", icon: IconUsers },
      { href: "/admin/mein-unternehmen", label: "Mein Unternehmen", icon: IconBuilding },
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
      { href: "/admin/ai-settings", label: "Chat-Verhalten", icon: IconAdmin },
      { href: "/admin/ai-keys", label: "AI-Keys", icon: IconShield },
      { href: "/admin/ai-kosten", label: "AI-Kosten", icon: IconChart },
      { href: "/admin/retrieval-qualitaet", label: "Retrieval-Qualität", icon: IconChart },
    ],
  },
];

export function NavHaiway() {
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
