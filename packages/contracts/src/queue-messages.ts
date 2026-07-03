// pgmq message contracts. The Next.js app enqueues these shapes and the
// Deno edge workers consume them — this file is the single source of truth
// for both sides. Keep it runtime-neutral: types and pure values only.

export type QueueName =
  | "ingest"
  | "normalize"
  | "embed"
  | "index"
  | "extract"
  | "automation";

export interface QueueMessage<T = unknown> {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: T;
}

// Bronze → Silver: consumed by worker-normalize. References a raw_events row
// via (organization_id, provider_id, external_id, payload_hash).
export interface NormalizeMsg {
  organization_id: string;
  provider_id: string;
  run_id: string;
  external_id: string;
  entity_type: string;
  payload_hash: string;
}

// Silver → Gold: consumed by worker-embed.
export interface EmbedMsg {
  organization_id: string;
  provider_id: string;
  entity_type: string;
  external_id: string;
  run_id?: string;
  title: string;
  text: string;
  metadata?: Record<string, unknown>;
  // Connector workers (gdrive/sharepoint) pass the existing connector source
  // id so the embed worker updates that row in place instead of creating a
  // parallel source_type='entity' row.
  source_id?: string;
  // When a large sheet is split into multiple messages, only the first part
  // carries replace_sheet=true so the embed worker deletes old chunks once.
  replace_sheet?: boolean;
}

// Consumed by worker-extract-entities.
export interface ExtractEntitiesMsg {
  organization_id: string;
  source_id: string;
}
