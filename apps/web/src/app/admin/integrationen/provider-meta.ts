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
//   - "credentials-form":    plain username/password form (e.g. IMAP)
//   - "webhook-setup":       show generated URL + secret to paste elsewhere
//   - "oauth-token-grant":   Trello-style 1-click token authorization
//   - "coming-soon":         no adapter yet — disabled with explainer

export type ConnectKind =
  | "oauth-server-action"
  | "wizard"
  | "credentials-form"
  | "webhook-setup"
  | "oauth-token-grant"
  | "coming-soon";

export interface ProviderMeta {
  color:        string;
  description:  string;
  note?:        string;
  connectKind:  ConnectKind;
  // The server action name (resolved at render time) for oauth-server-action
  // kind. Other kinds will be wired in follow-up PRs.
  serverAction?: "connectSharepoint" | "connectGdrive";
  // The provider id we sync against if it differs from the card's id
  // (OneDrive piggybacks SharePoint's connection).
  syncProviderId?: string;
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
    connectKind:  "coming-soon",
    note:         "OAuth-Flow wird in einem späteren PR ergänzt.",
  },
  vapi: {
    color:        "#19c37d",
    description:  "Telefonassistent (Voice). Eigener API-Key pro Org optional.",
    connectKind:  "coming-soon",
    note:         "Setup-Wizard folgt.",
  },
  shopware: {
    color:        "#189eff",
    description:  "Shopware 6 — Bestellungen, Kunden, Retouren. Auth via Admin-Integration.",
    connectKind:  "wizard",
    note:         "Shopware bietet keinen Drittapp-OAuth — Wizard mit Client-ID/Secret folgt.",
  },
  trello: {
    color:        "#0079bf",
    description:  "Cards + Boards. Verbindung via 1-Click-Token (Trello unterstützt kein OAuth 2.0).",
    connectKind:  "oauth-token-grant",
    note:         "Implementierung folgt im nächsten PR.",
  },
  imap_inbox: {
    color:        "#7d8da1",
    description:  "Generisches IMAP-Postfach (z.B. selbstgehostete Mail). User/Pass.",
    connectKind:  "credentials-form",
    note:         "Formular + Connection-Test folgt im nächsten PR.",
  },
  inbound_mail_webhook: {
    color:        "#7d8da1",
    description:  "Mail-Forwarding-Endpoint (Postmark, Resend, Cloudflare Email). HMAC-signiert.",
    connectKind:  "webhook-setup",
    note:         "Wizard mit generierter URL + Shared Secret folgt im nächsten PR.",
  },
};

// OneDrive isn't a separate DB provider — it piggybacks on SharePoint.
// Surface it as a virtual card so users see it as an option.
export const VIRTUAL_PROVIDERS: Array<{
  id:          string;
  name:        string;
  meta:        ProviderMeta;
  // The actual DB provider whose connection row we read for status.
  statusFrom:  string;
}> = [
  {
    id:   "onedrive",
    name: "OneDrive",
    statusFrom: "sharepoint",
    meta: {
      color:         "#0078D4",
      description:   "Persönliche + Team-OneDrive — nutzt denselben Microsoft-Login wie SharePoint.",
      note:          "Anbindung läuft über den gemeinsamen Microsoft-OAuth-Flow (SharePoint-Tenant).",
      connectKind:   "oauth-server-action",
      serverAction:  "connectSharepoint",
      syncProviderId: "sharepoint",
    },
  },
];

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
    case "credentials-form":    return "Benutzerdaten";
    case "webhook-setup":       return "Webhook-URL";
    case "oauth-token-grant":   return "Token-Authorize";
    case "coming-soon":         return "In Vorbereitung";
  }
}
