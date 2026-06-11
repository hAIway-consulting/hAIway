// Read helpers for the orchestrator cockpit (workflow_runs). Reads go through
// the user client so RLS scopes them to the caller's org.

import { createUserClient } from "@/lib/db/supabase-server";
import { orchestratorIntegrationsReady } from "@/lib/orchestrator/credentials";
import { WORKFLOW_KEY } from "@/lib/orchestrator/run-complaint";

export interface WorkflowKpi {
  total:           number;
  success:         number;
  failed:          number;
  running:         number;
  last_run_at:     string | null;
  avg_duration_ms: number | null;
}

export interface WorkflowStep {
  key:    string;
  label:  string;
  status: "success" | "failed" | "skipped";
  detail?: string;
}

export interface WorkflowRun {
  id:            string;
  workflow_key:  string;
  status:        "running" | "success" | "failed";
  trigger:       "manual" | "simulated";
  started_at:    string;
  finished_at:   string | null;
  duration_ms:   number | null;
  steps:         WorkflowStep[];
  source_ref:    Record<string, unknown> | null;
  target_ref:    { card_id?: string; url?: string; name?: string } | null;
  error_message: string | null;
}

const EMPTY_KPI: WorkflowKpi = {
  total: 0, success: 0, failed: 0, running: 0, last_run_at: null, avg_duration_ms: null,
};

export async function getWorkflowKpi(
  orgId:       string,
  workflowKey: string | null = WORKFLOW_KEY,
  days        = 365,
): Promise<WorkflowKpi> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("get_workflow_kpi", {
    p_org_id:       orgId,
    p_workflow_key: workflowKey,
    p_days:         days,
  });
  if (error || !data || !Array.isArray(data) || data.length === 0) return EMPTY_KPI;
  const row = data[0] as Record<string, unknown>;
  return {
    total:           Number(row.total ?? 0),
    success:         Number(row.success ?? 0),
    failed:          Number(row.failed ?? 0),
    running:         Number(row.running ?? 0),
    last_run_at:     (row.last_run_at as string | null) ?? null,
    avg_duration_ms: row.avg_duration_ms == null ? null : Number(row.avg_duration_ms),
  };
}

export async function listWorkflowRuns(
  orgId: string,
  limit = 30,
): Promise<WorkflowRun[]> {
  const db = await createUserClient();
  const { data } = await db
    .from("workflow_runs")
    .select("id, workflow_key, status, trigger, started_at, finished_at, duration_ms, steps, source_ref, target_ref, error_message")
    .eq("organization_id", orgId)
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as WorkflowRun[];
}

export interface OrchestratorStatus {
  active:        boolean; // both connectors connected
  handlungsbedarf: boolean; // at least one failed ticket
  missing:       string[]; // provider ids that are not active
}

export async function getOrchestratorStatus(
  orgId: string,
  kpi:   WorkflowKpi,
): Promise<OrchestratorStatus> {
  const ready = await orchestratorIntegrationsReady(orgId);
  const missing: string[] = [];
  if (!ready.shopware) missing.push("shopware");
  if (!ready.trello)   missing.push("trello");
  return {
    active:          ready.shopware && ready.trello,
    handlungsbedarf: kpi.failed > 0,
    missing,
  };
}

// ── Automation registry (shared by customer dashboard + chat agent tool) ──
//
// DB-backed since spec-cockpit.md §10: rows live in `automations` (tenant-
// scoped, consultant-managed). The legacy code registry stays as a fallback
// bridge until the foundation migration is pushed everywhere; remove it in
// the cleanup follow-up.

export interface Automation {
  id:          string | null;
  key:         string;
  name:        string;
  description: string;
  /** consultant switch (automations.status) AND all required integrations ready */
  active:      boolean;
  /** registry status independent of integration readiness */
  status:      "active" | "stopped";
  /** provider ids from `requires` that are not active for this org */
  blockers:    string[];
  minutesSavedPerRun: number;
  kpi:         WorkflowKpi;
}

const LEGACY_AUTOMATION_REGISTRY: {
  key: string; name: string; description: string; requires: string[];
}[] = [
  {
    key:         WORKFLOW_KEY,
    name:        "Reklamations-Orchestrator",
    description: "Erstellt aus Shopware-Reklamationen automatisch Trello-Karten.",
    requires:    ["shopware", "trello"],
  },
];

interface AutomationRow {
  id: string;
  key: string;
  name: string;
  description: string;
  requires: string[];
  status: "active" | "stopped";
  minutes_saved_per_run: number;
}

/** Active provider ids of the org (generic readiness check for `requires`). */
async function activeProviderIds(orgId: string): Promise<Set<string>> {
  const db = await createUserClient();
  const { data } = await db
    .from("organization_integrations")
    .select("provider_id, status")
    .eq("organization_id", orgId);
  return new Set(
    (data ?? []).filter((r) => r.status === "active").map((r) => r.provider_id as string),
  );
}

/** All known automations with live active-state + KPIs for the given org. */
export async function listAutomations(orgId: string): Promise<Automation[]> {
  let rows: AutomationRow[] = [];
  try {
    const db = await createUserClient();
    const { data, error } = await db
      .from("automations")
      .select("id, key, name, description, requires, status, minutes_saved_per_run")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });
    if (!error && data) rows = data as AutomationRow[];
  } catch {
    rows = [];
  }

  // Fallback bridge: table missing (migration not pushed) or org not seeded.
  if (rows.length === 0) {
    rows = LEGACY_AUTOMATION_REGISTRY.map((a) => ({
      id: "",
      key: a.key,
      name: a.name,
      description: a.description,
      requires: a.requires,
      status: "active" as const,
      minutes_saved_per_run: 0,
    }));
  }

  const active = await activeProviderIds(orgId);
  const out: Automation[] = [];
  for (const row of rows) {
    const kpi = await getWorkflowKpi(orgId, row.key);
    const blockers = (row.requires ?? []).filter((r) => !active.has(r));
    out.push({
      id:          row.id || null,
      key:         row.key,
      name:        row.name,
      description: row.description,
      status:      row.status,
      blockers,
      minutesSavedPerRun: Number(row.minutes_saved_per_run ?? 0),
      active:      row.status === "active" && blockers.length === 0,
      kpi,
    });
  }
  return out;
}
