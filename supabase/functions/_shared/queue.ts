// Thin pgmq wrapper for Edge Function workers.
//
// We call SECURITY DEFINER wrappers in the `public` schema (defined in
// migration 20260406100000_ingest_pipeline_foundation.sql) so that
// supabase-js can reach them through the standard PostgREST RPC endpoint.
// Direct `pgmq.*` calls would require exposing the pgmq schema, which
// Supabase blocks by default.

import type { QueueName } from "@haiway/contracts/queue-messages";
import { getServiceClient } from "./supabase.ts";

export type { QueueName };

export interface QueueMessage<T = unknown> {
  msg_id:     number;
  read_ct:    number;
  enqueued_at: string;
  vt:         string;
  message:    T;
}

export async function enqueue<T>(
  queue: QueueName,
  message: T,
): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("pgmq_send", {
    p_queue: queue,
    p_msg:   message as unknown as Record<string, unknown>,
  });
  if (error) throw error;
  return data as number;
}

export async function readBatch<T>(
  queue: QueueName,
  visibilityTimeoutSec: number,
  qty: number,
): Promise<QueueMessage<T>[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("pgmq_read", {
    p_queue: queue,
    p_vt:    visibilityTimeoutSec,
    p_qty:   qty,
  });
  if (error) throw error;
  return (data ?? []) as QueueMessage<T>[];
}

// Cheap pre-flight check so cron-driven workers can skip the heavier
// pgmq.read + downstream work when there is nothing to do. Backed by
// pgmq.metrics() — a single COUNT under the hood. Defined in migration
// 20260506140000_throttle_pipeline_crons.sql.
export async function queueLength(queue: QueueName): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("pgmq_queue_length", {
    p_queue: queue,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function ack(queue: QueueName, msgId: number): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.rpc("pgmq_delete", {
    p_queue:  queue,
    p_msg_id: msgId,
  });
  if (error) throw error;
}

export async function archive(queue: QueueName, msgId: number): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.rpc("pgmq_archive", {
    p_queue:  queue,
    p_msg_id: msgId,
  });
  if (error) throw error;
}

// Move a permanently failed message into job_failures and ack it on the
// queue so it stops cycling. Use after retries are exhausted.
export async function deadLetter(params: {
  queue:           QueueName;
  msgId:           number;
  organizationId:  string;
  providerId?:     string;
  runId?:          string;
  message:         unknown;
  error:           Error;
  attemptCount:    number;
}): Promise<void> {
  const supabase = getServiceClient();

  const { error: insertErr } = await supabase.from("job_failures").insert({
    organization_id: params.organizationId,
    provider_id:     params.providerId ?? null,
    run_id:          params.runId ?? null,
    queue_name:      params.queue,
    message:         params.message,
    error_message:   params.error.message,
    error_stack:     params.error.stack ?? null,
    attempt_count:   params.attemptCount,
  });
  if (insertErr) throw insertErr;

  await archive(params.queue, params.msgId);
}
