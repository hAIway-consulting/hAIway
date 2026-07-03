// Integration registry contracts, mirroring the integration_providers /
// organization_integrations tables (migration 20260404100000). Provider ids
// must match the seeded registry rows.

export type ProviderId =
  | "vapi"
  | "google_calendar"
  | "google_drive"
  | "sharepoint"
  | "shopware"
  | "trello"
  | "imap_inbox"
  | "inbound_mail_webhook";

export type CredentialMode = "platform" | "customer";

export type IntegrationStatus = "pending" | "active" | "error" | "disabled";

// Shape returned by the get_org_integration() RPC.
export interface IntegrationRow {
  status: string;
  credential_mode: CredentialMode | string;
  credentials: Record<string, string>;
  config: Record<string, unknown>;
  error_message: string | null;
}
