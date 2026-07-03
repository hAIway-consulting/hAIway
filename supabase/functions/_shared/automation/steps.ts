// Step executors for worker-automation. Each executor receives the resolved
// run scope and returns the step output (stored under context[step.key]) plus
// metadata for the audit trail.
//
// connector_action calls the shared connector modules directly (no HTTP hop
// through the connector-* functions) with credentials from
// organization_integrations.

import type {
  AutomationStep,
} from "@haiway/contracts/automations";
import { getServiceClient } from "../supabase.ts";
import {
  type ShopwareConfig,
  fetchOrderByNumber,
  fetchCustomerByEmail,
  createReturn,
} from "../shopware.ts";
import { type TrelloConfig, createCard } from "../trello.ts";
import { type RunScope, resolveParams, resolveTemplate } from "./scope.ts";

export interface StepResult {
  output: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

const DEFAULT_LLM_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_LLM_MAX_TOKENS = 1024;

async function getIntegrationConfig<T>(
  orgId: string,
  providerId: string,
  requiredKeys: string[],
): Promise<T> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("organization_integrations")
    .select("credentials, config")
    .eq("organization_id", orgId)
    .eq("provider_id", providerId)
    .eq("status", "active")
    .maybeSingle<{ credentials: Record<string, unknown>; config: Record<string, unknown> }>();
  if (error) throw error;
  if (!data) throw new Error(`${providerId} integration not active for this org`);

  const merged = { ...(data.config ?? {}), ...(data.credentials ?? {}) };
  for (const key of requiredKeys) {
    if (!merged[key]) throw new Error(`${providerId} integration missing "${key}"`);
  }
  return merged as T;
}

// ─── llm_classify ─────────────────────────────────────────────────────────

async function executeLlmClassify(
  step: Extract<AutomationStep, { kind: "llm_classify" }>,
  scope: RunScope,
  promptOverride: string | undefined,
): Promise<StepResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const promptTemplate = promptOverride ?? step.prompt;
  const prompt = resolveTemplate(promptTemplate, scope);
  const model = step.model ?? DEFAULT_LLM_MODEL;
  const maxTokens = step.max_tokens ?? DEFAULT_LLM_MAX_TOKENS;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`anthropic API ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json() as {
    content?: { text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.[0]?.text ?? "";

  // The prompt contract: answer with a single JSON object.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`llm_classify "${step.key}": no JSON in model response`);
  const output = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  return {
    output,
    metadata: {
      model,
      input_tokens: data.usage?.input_tokens,
      output_tokens: data.usage?.output_tokens,
      prompt_chars: prompt.length,
      prompt_overridden: promptOverride !== undefined,
    },
  };
}

// ─── connector_action ─────────────────────────────────────────────────────

async function executeConnectorAction(
  step: Extract<AutomationStep, { kind: "connector_action" }>,
  scope: RunScope,
  orgId: string,
): Promise<StepResult> {
  const params = resolveParams(step.params ?? {}, scope);

  if (step.provider === "shopware") {
    const cfg = await getIntegrationConfig<ShopwareConfig>(
      orgId, "shopware", ["base_url", "client_id", "client_secret"],
    );
    switch (step.action) {
      case "fetch-order": {
        const orderNumber = String(params.order_number ?? "");
        if (!orderNumber) throw new Error("fetch-order: order_number missing");
        const order = await fetchOrderByNumber(cfg, orderNumber);
        return { output: { order }, metadata: { provider: "shopware", action: step.action } };
      }
      case "fetch-customer": {
        const email = String(params.email ?? "");
        if (!email) throw new Error("fetch-customer: email missing");
        const customer = await fetchCustomerByEmail(cfg, email);
        return { output: { customer }, metadata: { provider: "shopware", action: step.action } };
      }
      case "create-return": {
        const orderId = String(params.order_id ?? "");
        if (!orderId) throw new Error("create-return: order_id missing");
        const result = await createReturn(cfg, {
          orderId,
          reason: params.reason ? String(params.reason) : undefined,
          internalComment: params.internal_comment ? String(params.internal_comment) : undefined,
        });
        return { output: { return: result }, metadata: { provider: "shopware", action: step.action } };
      }
      default:
        throw new Error(`unknown shopware action "${step.action}"`);
    }
  }

  if (step.provider === "trello") {
    const cfg = await getIntegrationConfig<TrelloConfig>(
      orgId, "trello", ["api_key", "token"],
    );
    switch (step.action) {
      case "create-card": {
        const name = String(params.name ?? "");
        if (!name) throw new Error("create-card: name missing");
        const card = await createCard(cfg, {
          name,
          desc: params.desc ? String(params.desc) : undefined,
          listId: params.list_id ? String(params.list_id) : undefined,
        });
        return {
          output: { card: { id: card.id, url: card.shortUrl } },
          metadata: { provider: "trello", action: step.action },
        };
      }
      default:
        throw new Error(`unknown trello action "${step.action}"`);
    }
  }

  throw new Error(`unknown connector provider "${(step as { provider: string }).provider}"`);
}

// ─── notify ───────────────────────────────────────────────────────────────

async function executeNotify(
  step: Extract<AutomationStep, { kind: "notify" }>,
  scope: RunScope,
  orgId: string,
): Promise<StepResult> {
  const message = resolveTemplate(step.message, scope);
  const params = resolveParams(step.params ?? {}, scope);

  if (step.channel === "trello") {
    const cfg = await getIntegrationConfig<TrelloConfig>(orgId, "trello", ["api_key", "token"]);
    const card = await createCard(cfg, {
      name: message.split("\n")[0].slice(0, 120),
      desc: message,
      listId: params.list_id ? String(params.list_id) : undefined,
    });
    return {
      output: { card: { id: card.id, url: card.shortUrl } },
      metadata: { channel: "trello" },
    };
  }

  // channel === "log": audit-trail-only notification.
  console.log(`[automation notify] org=${orgId} ${message}`);
  return { output: { message }, metadata: { channel: "log" } };
}

// ─── dispatcher ───────────────────────────────────────────────────────────

// human_approval is handled by the worker loop itself (it pauses the run),
// so it never reaches this dispatcher.
export async function executeStep(
  step: AutomationStep,
  scope: RunScope,
  orgId: string,
): Promise<StepResult> {
  switch (step.kind) {
    case "llm_classify": {
      // Per-org prompt override: params.prompts.<step_key>
      const prompts = scope.params.prompts as Record<string, unknown> | undefined;
      const override = prompts?.[step.key];
      return await executeLlmClassify(
        step, scope, typeof override === "string" ? override : undefined,
      );
    }
    case "connector_action":
      return await executeConnectorAction(step, scope, orgId);
    case "notify":
      return await executeNotify(step, scope, orgId);
    case "human_approval":
      throw new Error("human_approval is handled by the worker loop");
    default:
      throw new Error(`unknown step kind "${(step as { kind: string }).kind}"`);
  }
}
