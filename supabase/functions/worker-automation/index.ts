// worker-automation
//
// Drains the `automation` pgmq queue. Each message is {run_id}; the worker
// loads the run, its pinned template definition version and the org params,
// then executes the definition's steps sequentially:
//
//   - context is persisted to automation_runs after EVERY step, so a crashed
//     worker resumes where it stopped instead of redoing work
//   - already-succeeded steps (step_runs) are skipped on resume
//   - human_approval pauses the run (status waiting_approval) and stops;
//     decide_automation_step() re-enqueues it on approve
//   - `when` guards skip steps whose condition does not hold
//
// Definition schema: packages/contracts/src/automations.ts

import {
  automationDefinitionSchema,
  type AutomationDefinition,
  type AutomationQueueMsg,
  type AutomationStep,
} from "@haiway/contracts/automations";
import { getServiceClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import { readBatch, ack, archive, deadLetter, queueLength } from "../_shared/queue.ts";
import { conditionHolds, resolveTemplate, type RunScope } from "../_shared/automation/scope.ts";
import { executeStep } from "../_shared/automation/steps.ts";

const QUEUE = "automation" as const;
const VISIBILITY_TIMEOUT = 120; // seconds — LLM + connector calls can be slow
const BATCH_SIZE = 5;
const MAX_ATTEMPTS_PER_MSG = 3;

interface RunRow {
  id: string;
  organization_id: string;
  template_id: string;
  template_version: number;
  org_automation_id: string | null;
  status: string;
  context: Record<string, unknown>;
  current_step_key: string | null;
  trigger_ref: Record<string, unknown>;
}

async function loadDefinition(
  templateId: string,
  version: number,
): Promise<AutomationDefinition> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("automation_template_versions")
    .select("definition")
    .eq("template_id", templateId)
    .eq("version", version)
    .maybeSingle<{ definition: unknown }>();
  if (error) throw error;
  if (!data) throw new Error(`definition ${templateId}@${version} not found`);
  return automationDefinitionSchema.parse(data.definition);
}

async function loadOrgParams(orgAutomationId: string | null): Promise<Record<string, unknown>> {
  if (!orgAutomationId) return {};
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("organization_automations")
    .select("params")
    .eq("id", orgAutomationId)
    .maybeSingle<{ params: Record<string, unknown> }>();
  if (error) throw error;
  return data?.params ?? {};
}

async function loadSucceededStepKeys(runId: string): Promise<Set<string>> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("automation_step_runs")
    .select("step_key, status")
    .eq("run_id", runId)
    .in("status", ["succeeded", "skipped"]);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.step_key as string));
}

async function insertStepRun(
  run: RunRow,
  step: AutomationStep,
  status: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  const supabase = getServiceClient();
  // attempt = count of existing rows for this (run, step) + 1
  const { count } = await supabase
    .from("automation_step_runs")
    .select("*", { count: "exact", head: true })
    .eq("run_id", run.id)
    .eq("step_key", step.key);
  const { data, error } = await supabase
    .from("automation_step_runs")
    .insert({
      run_id: run.id,
      organization_id: run.organization_id,
      step_key: step.key,
      step_kind: step.kind,
      status,
      attempt: (count ?? 0) + 1,
      ...fields,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

async function updateRun(runId: string, fields: Record<string, unknown>): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.from("automation_runs").update(fields).eq("id", runId);
  if (error) throw error;
}

// Executes the run until it finishes, pauses for approval, or a step throws.
async function processRun(run: RunRow): Promise<void> {
  const supabase = getServiceClient();
  const definition = await loadDefinition(run.template_id, run.template_version);
  const params = await loadOrgParams(run.org_automation_id);
  const succeeded = await loadSucceededStepKeys(run.id);

  const context = { ...(run.context ?? {}) };
  const scope: RunScope = { params, context, trigger: run.trigger_ref ?? {} };

  if (run.status === "pending") {
    await updateRun(run.id, { status: "running" });
  }

  for (const step of definition.steps) {
    if (succeeded.has(step.key)) continue;

    if (!conditionHolds(step.when, scope)) {
      await insertStepRun(run, step, "skipped", { finished_at: new Date().toISOString() });
      continue;
    }

    if (step.kind === "human_approval") {
      const title = resolveTemplate(step.title, scope);
      await insertStepRun(run, step, "waiting_approval", {
        input: {
          title,
          description: step.description ? resolveTemplate(step.description, scope) : null,
        },
      });
      await updateRun(run.id, {
        status: "waiting_approval",
        current_step_key: step.key,
        context,
      });
      return; // decide_automation_step() re-enqueues on approve
    }

    const stepRunId = await insertStepRun(run, step, "running", {
      input: { when: step.when ?? null },
    });

    try {
      const result = await executeStep(step, scope, run.organization_id);
      context[step.key] = result.output;

      const { error } = await supabase
        .from("automation_step_runs")
        .update({
          status: "succeeded",
          output: result.output,
          metadata: result.metadata,
          finished_at: new Date().toISOString(),
        })
        .eq("id", stepRunId);
      if (error) throw error;

      // Crash-safe checkpoint: context + cursor after every step.
      await updateRun(run.id, { context, current_step_key: step.key });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from("automation_step_runs")
        .update({
          status: "failed",
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", stepRunId);
      throw err; // bubbles to the queue loop → retry / dead-letter
    }
  }

  await updateRun(run.id, {
    status: "succeeded",
    finished_at: new Date().toISOString(),
    error_message: null,
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    const pending = await queueLength(QUEUE);
    if (pending === 0) {
      return jsonResponse({ skipped: "queue empty", processed: 0, failed: 0, batch: 0 });
    }

    const supabase = getServiceClient();
    const messages = await readBatch<AutomationQueueMsg>(QUEUE, VISIBILITY_TIMEOUT, BATCH_SIZE);

    let processed = 0;
    let failed = 0;

    for (const m of messages) {
      const { run_id } = m.message;
      let orgIdForDeadLetter: string | null = null;
      try {
        const { data: run, error } = await supabase
          .from("automation_runs")
          .select("id, organization_id, template_id, template_version, org_automation_id, status, context, current_step_key, trigger_ref")
          .eq("id", run_id)
          .maybeSingle<RunRow>();
        if (error) throw error;

        orgIdForDeadLetter = run?.organization_id ?? null;

        if (!run || ["succeeded", "failed", "rejected", "cancelled"].includes(run.status)) {
          // Gone or already terminal (e.g. duplicate enqueue) — ack silently.
          await ack(QUEUE, m.msg_id);
          continue;
        }
        if (run.status === "waiting_approval") {
          // Not decided yet; decide_automation_step() enqueues a fresh
          // message on approval. Drop this one.
          await ack(QUEUE, m.msg_id);
          continue;
        }

        await processRun(run);
        await ack(QUEUE, m.msg_id);
        processed++;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (m.read_ct >= MAX_ATTEMPTS_PER_MSG) {
          // Mark the run failed and dead-letter the message.
          await updateRun(run_id, {
            status: "failed",
            error_message: error.message,
            finished_at: new Date().toISOString(),
          }).catch(() => {});
          if (orgIdForDeadLetter) {
            await deadLetter({
              queue: QUEUE,
              msgId: m.msg_id,
              organizationId: orgIdForDeadLetter,
              message: m.message,
              error,
              attemptCount: m.read_ct,
            });
          } else {
            // Run row unavailable — archive without a job_failures entry
            // (FK to organizations would fail).
            await archive(QUEUE, m.msg_id);
          }
        }
        failed++;
      }
    }

    return jsonResponse({ processed, failed, batch: messages.length });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[worker-automation] FATAL", err.message, err.stack);
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
});
