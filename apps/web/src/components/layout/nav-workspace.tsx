"use client";

import {
  IconHome,
  IconChat,
  IconPhone,
  IconBox,
  IconCrm,
  NavLink,
  NavGroupBlock,
  type NavGroup,
} from "./nav-primitives";

/**
 * Workspace-Sidebar — End-User-Sicht.
 * Bewusst minimal: Übersicht, Cockpit, optional Telefon.
 * Die frühere Suche ist im Cockpit aufgegangen (Chat-Modus = Hybrid-Suche).
 * Kein Datei-Upload, keine Verwaltungs-Items.
 */
export function NavWorkspace({
  hasPhoneAssistant,
  hasCrm,
}: {
  hasPhoneAssistant?: boolean;
  hasCrm?: boolean;
}) {
  const groups: NavGroup[] = [
    {
      label: "Arbeiten",
      items: [
        { href: "/chat", label: "hAIway Cockpit", icon: IconChat },
        { href: "/automatisierungen", label: "Automatisierungen", icon: IconBox },
        ...(hasCrm ? [{ href: "/crm", label: "CRM", icon: IconCrm }] : []),
      ],
    },
  ];

  if (hasPhoneAssistant) {
    groups.push({
      label: "Premium",
      items: [{ href: "/telefon-assistent", label: "Telefon", icon: IconPhone }],
    });
  }

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
