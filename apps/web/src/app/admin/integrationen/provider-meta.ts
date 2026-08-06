// Frontend metadata per integration provider.
//
// The DB row in `integration_providers` carries name/category/auth_type but
// no presentation hints (color, description, install method). Those live
// here so the UI can render a card for any provider seeded in the DB while
// individual auth adapters (OAuth, wizard, …) get added incrementally.
//
// `connectKind` describes HOW a tenant currently connects this provider:
//   - "oauth-server-action": existing server action initiates OAuth redirect
//   - "wizard":              guided form (e.g. Shopware client credentials)
//   - "oauth-token-grant":   Trello-style 1-click token authorization
//   - "managed":             set up by hAIway on the platform side, no
//                            self-service connect flow
//   - "coming-soon":         no adapter yet — disabled with explainer

export type ConnectKind =
  | "oauth-server-action"
  | "wizard"
  | "oauth-token-grant"
  | "managed"
  | "coming-soon";

export interface ProviderMeta {
  color:        string;
  description:  string;
  note?:        string;
  connectKind:  ConnectKind;
  // Name of the server action page.tsx's actionLookup resolves to a real
  // function reference. Add to that map when introducing a new action.
  serverAction?: "connectSharepoint" | "connectGdrive" | "connectTrello";
  // The provider id we sync against if it differs from the card's id.
  syncProviderId?: string;
  // Route the "configuring"-state CTA points to (post-auth wizard).
  configuringRoute?: string;
  // Route the "connect" CTA points to for wizard providers that have no
  // preceding OAuth step (the wizard itself is the entry point, e.g. Shopware).
  setupRoute?: string;
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  sharepoint: {
    color:         "#0078D4",
    description:   "Microsoft 365 Sites + Dokumentenbibliotheken via Microsoft Graph.",
    connectKind:   "oauth-server-action",
    serverAction:  "connectSharepoint",
    syncProviderId: "sharepoint",
  },
  google_drive: {
    color:         "#1A73E8",
    description:   "Shared Drives + persönliche Drives via Google OAuth.",
    connectKind:   "oauth-server-action",
    serverAction:  "connectGdrive",
    syncProviderId: "google_drive",
  },
  google_calendar: {
    color:        "#1A73E8",
    description:  "Termine + Slot-Verfügbarkeit für den Telefonassistenten.",
    connectKind:  "oauth-server-action",
    setupRoute:   "/telefon-assistent/kalender",
    note:         "Verbinden und Status im Telefonassistenten unter „Kalender“.",
  },
  vapi: {
    color:        "#19c37d",
    description:  "Telefonassistent (Voice). Eigener API-Key pro Org optional.",
    connectKind:  "managed",
    note:         "Zugang wird plattformseitig hinterlegt (VAPI_API_KEY oder Org-Key). Betrieb über den Telefonassistenten.",
  },
  shopware: {
    color:        "#189eff",
    description:  "Shopware 6 — Bestellungen, Kunden, Retouren. Auth via Admin-Integration.",
    connectKind:  "wizard",
    setupRoute:   "/admin/integrationen/shopware/setup",
    note:         "Manuell mit Client-ID/Secret aus einer Shopware-Admin-Integration.",
  },
  trello: {
    color:            "#0079bf",
    description:      "Cards + Boards. 1-Click-Token-Authorize (Trello hat kein OAuth 2.0).",
    connectKind:      "oauth-token-grant",
    serverAction:     "connectTrello",
    configuringRoute: "/admin/integrationen/trello/setup",
    note:             "Nach dem Verbinden Board + Liste auswählen.",
  },
  twenty: {
    color:            "#1961ed",
    description:      "Selbst gehostetes Twenty CRM — Zugänge + Rollen werden automatisch synchronisiert.",
    connectKind:      "wizard",
    setupRoute:       "/admin/crm",
    configuringRoute: "/admin/crm",
    note:             "Einrichtung + Zugriffsverwaltung unter CRM-Zugänge. Betrieb: docs/crm-twenty.md",
  },
};

export function metaFor(providerId: string): ProviderMeta {
  return PROVIDER_META[providerId] ?? {
    color:       "#7d8da1",
    description: "Provider ohne UI-Metadaten — bitte in provider-meta.ts ergänzen.",
    connectKind: "coming-soon",
  };
}

export function connectKindLabel(kind: ConnectKind): string {
  switch (kind) {
    case "oauth-server-action": return "OAuth 2.0";
    case "wizard":              return "Geführter Wizard";
    case "oauth-token-grant":   return "Token-Authorize";
    case "managed":             return "Von hAIway eingerichtet";
    case "coming-soon":         return "In Vorbereitung";
  }
}
