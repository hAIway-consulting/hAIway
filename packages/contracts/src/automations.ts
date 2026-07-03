// Automation engine contracts: the JSONB definition format stored in
// automation_template_versions, validated by the sync script (Node) and
// interpreted by worker-automation (Deno).
//
// Design constraints (v1, deliberately minimal):
//   - steps are a LINEAR list — no DAG
//   - conditions are structured objects, never evaluated strings
//   - "{{params.x}}" / "{{context.<step_key>.y}}" template strings are
//     resolved by the worker against the run scope

import { z } from "zod";

// Structured guard: skip the step unless the condition holds.
export const stepConditionSchema = z.object({
  // Dot path into the run scope, e.g. "context.classify.intent" or "params.mode"
  path: z.string().min(1),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  not_equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  exists: z.boolean().optional(),
});

const stepBase = {
  key: z.string().regex(/^[a-z0-9_]+$/, "step key: lowercase snake_case"),
  name: z.string().optional(),
  when: stepConditionSchema.optional(),
};

export const llmClassifyStepSchema = z.object({
  ...stepBase,
  kind: z.literal("llm_classify"),
  // Prompt template; the sync script inlines prompt files before upload.
  prompt: z.string().min(1),
  // Documented output shape; the worker requires valid JSON output and
  // stores it under context[step.key].
  output_schema: z.record(z.string(), z.unknown()).optional(),
  model: z.string().optional(),
  max_tokens: z.number().int().positive().optional(),
});

export const connectorActionStepSchema = z.object({
  ...stepBase,
  kind: z.literal("connector_action"),
  provider: z.enum(["shopware", "trello"]),
  action: z.string().min(1),
  // Action parameters; string values may contain {{...}} templates.
  params: z.record(z.string(), z.unknown()).default({}),
});

export const humanApprovalStepSchema = z.object({
  ...stepBase,
  kind: z.literal("human_approval"),
  // Shown in the Berater approval inbox; supports {{...}} templates.
  title: z.string().min(1),
  description: z.string().optional(),
});

export const notifyStepSchema = z.object({
  ...stepBase,
  kind: z.literal("notify"),
  channel: z.enum(["trello", "log"]),
  message: z.string().min(1),
  // channel-specific settings (e.g. trello list id), templates allowed.
  params: z.record(z.string(), z.unknown()).default({}),
});

export const automationStepSchema = z.discriminatedUnion("kind", [
  llmClassifyStepSchema,
  connectorActionStepSchema,
  humanApprovalStepSchema,
  notifyStepSchema,
]);

export const automationTriggerSchema = z.object({
  type: z.enum(["event", "cron", "manual"]),
  // For type=event: which pipeline messages start a run.
  provider_id: z.string().optional(),
  entity_type: z.string().optional(),
  // For type=cron: schedule is managed via pg_cron per tenant, not here.
});

// params_schema follows the integration_providers.config_schema convention:
// the Cockpit renders a form from it; keys land in organization_automations.params.
export const automationDefinitionSchema = z.object({
  trigger: automationTriggerSchema,
  params_schema: z
    .object({
      required: z.array(z.string()).default([]),
      fields: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ required: [], fields: {} }),
  steps: z.array(automationStepSchema).min(1),
});

export type StepCondition = z.infer<typeof stepConditionSchema>;
export type AutomationStep = z.infer<typeof automationStepSchema>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;

// pgmq message on the `automation` queue.
export interface AutomationQueueMsg {
  run_id: string;
}

export type AutomationRunStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "rejected"
  | "cancelled";

export type AutomationStepRunStatus =
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rejected";
