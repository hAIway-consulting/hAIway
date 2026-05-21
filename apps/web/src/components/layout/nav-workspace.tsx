"use client";

import {
  IconHome,
  IconSearch,
  IconChat,
  IconPhone,
  IconChart,
  NavLink,
  NavGroupBlock,
  type NavGroup,
} from "./nav-primitives";

/**
 * Workspace-Sidebar — End-User-Sicht.
 * Bewusst minimal: Übersicht, Chat, Suche, optional Telefon.
 * Kein Datei-Upload, keine Verwaltungs-Items.
 */
export function NavWorkspace({ hasPhoneAssistant }: { hasPhoneAssistant?: boolean }) {
  const groups: NavGroup[] = [
    {
      label: "Arbeiten",
      items: [
        { href: "/chat", label: "Chats", icon: IconChat },
        { href: "/search", label: "Suchen", icon: IconSearch },
        { href: "/mein-vertrieb", label: "Mein Vertrieb", icon: IconChart },
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
