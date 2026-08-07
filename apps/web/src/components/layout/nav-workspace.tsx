"use client";

import { recordCrmLaunch } from "@/app/crm/actions";
import {
  IconHome,
  IconChat,
  IconPhone,
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
  crmLaunchUrl,
}: {
  hasPhoneAssistant?: boolean;
  hasCrm?: boolean;
  crmLaunchUrl?: string | null;
}) {
  const groups: NavGroup[] = [
    {
      label: "Arbeiten",
      items: [
        { href: "/chat", label: "hAIway Cockpit", icon: IconChat },
        ...(hasCrm
          ? [
              crmLaunchUrl
                ? {
                    href: crmLaunchUrl,
                    label: "CRM",
                    icon: IconCrm,
                    external: true,
                    onOpen: () => void recordCrmLaunch(),
                  }
                : { href: "/crm", label: "CRM", icon: IconCrm },
            ]
          : []),
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
