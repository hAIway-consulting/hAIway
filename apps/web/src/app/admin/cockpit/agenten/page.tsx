import { requireOrgId } from "@/lib/db/org-context";
import {
  listAllSavedAgentsForOrg,
  type SavedAgentOversight,
} from "@/lib/db/queries/saved-agents";
import {
  listAgentRuns,
  resolveProfileNames,
  AGENT_RUN_STATUSES,
  type AgentRun,
  type AgentRunStatus,
} from "@/lib/db/queries/agent-runs";
import { setSavedAgentStatus } from "../actions";
import { Empty, Panel, Pill, truncate, type PillTone } from "../ui";

export const dynamic = "force-dynamic";

const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  running: "läuft",
  awaiting_confirmation: "wartet auf Bestätigung",
  success: "Erfolg",
  failed: "Fehler",
  cancelled: "abgebrochen",
};

const RUN_STATUS_TONES: Record<AgentRunStatus, PillTone> = {
  running: "warning",
  awaiting_confirmation: "warning",
  success: "accent",
  failed: "danger",
  cancelled: "muted",
};

function isRunStatus(value: string): value is AgentRunStatus {
  return (AGENT_RUN_STATUSES as string[]).includes(value);
}

/**
 * Cockpit-Aufsicht (berater spec §6): all saved agents of the tenant
 * (private + disabled included) with enable/disable, plus the agent_runs
 * audit list. The Berater never edits agent content — that stays with the
 * customer (Rollen-Matrix Cockpit-Spec §11).
 */
export default async function CockpitAgentenPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; agent?: string }>;
}) {
  const sp = await searchParams;
  const orgId = await requireOrgId();

  const statusFilter = sp.status && isRunStatus(sp.status) ? sp.status : undefined;
  const agents = await listAllSavedAgentsForOrg(orgId);
  const agentIds = new Set(agents.map((a) => a.id));
  const agentFilter = sp.agent && agentIds.has(sp.agent) ? sp.agent : undefined;

  const runs = await listAgentRuns(orgId, { status: statusFilter, savedAgentId: agentFilter }, 50);
  const names = await resolveProfileNames([
    ...agents.map((a) => a.createdBy),
    ...runs.map((r) => r.triggered_by),
  ]);
  const agentNameById = new Map(agents.map((a) => [a.id, a.name] as const));

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <Panel title="Gespeicherte Agenten">
        {agents.length === 0 ? (
          <Empty text="Noch keine gespeicherten Agenten — Kund:innen legen sie im Cockpit aus Konversationen an." />
        ) : (
          <div className="w-full overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>Name</th>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>Besitzer:in</th>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>Sichtbarkeit</th>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>Status</th>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>Angelegt</th>
                  <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} ownerName={agent.createdBy ? names.get(agent.createdBy) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Agent-Läufe (letzte 50)">
        <form method="get" className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-status" className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>
              Status
            </label>
            <select
              id="filter-status"
              name="status"
              defaultValue={statusFilter ?? ""}
              className="min-h-[44px] rounded-xl border px-3 text-sm outline-none"
              style={{ borderColor: "var(--color-line)", background: "var(--color-bg)", color: "var(--color-text)" }}
            >
              <option value="">Alle</option>
              {AGENT_RUN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RUN_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-agent" className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>
              Gespeicherter Agent
            </label>
            <select
              id="filter-agent"
              name="agent"
              defaultValue={agentFilter ?? ""}
              className="min-h-[44px] rounded-xl border px-3 text-sm outline-none max-w-[220px]"
              style={{ borderColor: "var(--color-line)", background: "var(--color-bg)", color: "var(--color-text)" }}
            >
              <option value="">Alle</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="min-h-[44px] min-w-[44px] px-4 rounded-xl text-sm font-medium"
            style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
          >
            Filtern
          </button>
        </form>

        {runs.length === 0 ? (
          <Empty
            text={
              statusFilter || agentFilter
                ? "Keine Agent-Läufe für diesen Filter."
                : "Noch keine Agent-Läufe — erscheint nach dem Migrations-Push."
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                triggeredByName={run.triggered_by ? names.get(run.triggered_by) : undefined}
                agentName={run.saved_agent_id ? agentNameById.get(run.saved_agent_id) : undefined}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function AgentRow({ agent, ownerName }: { agent: SavedAgentOversight; ownerName?: string }) {
  const nextStatus = agent.status === "active" ? ("disabled" as const) : ("active" as const);
  return (
    <tr className="border-t align-middle" style={{ borderColor: "var(--color-line-soft)" }}>
      <td className="px-3 py-2">
        <div className="font-medium" style={{ color: "var(--color-text)" }}>
          {agent.name}
        </div>
        <div className="text-xs" style={{ color: "var(--color-muted)" }} title={agent.description}>
          {truncate(agent.description, 60)}
        </div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
        {ownerName ?? "Berater-kuratiert"}
      </td>
      <td className="px-3 py-2">
        {agent.visibility === "org" ? (
          <Pill label="Team" tone="accent" />
        ) : (
          <Pill label="Privat" tone="muted" />
        )}
      </td>
      <td className="px-3 py-2">
        {agent.status === "active" ? (
          <Pill label="Aktiv" tone="success" />
        ) : (
          <Pill label="Deaktiviert" tone="muted" />
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: "var(--color-muted)" }}>
        {new Date(agent.createdAt).toLocaleDateString("de-DE")}
      </td>
      <td className="px-3 py-2">
        <form action={setSavedAgentStatus.bind(null, agent.id, nextStatus)}>
          <button
            type="submit"
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl text-[13px] font-medium whitespace-nowrap"
            style={
              agent.status === "active"
                ? {
                    background: "var(--color-bg-elevated)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-line)",
                  }
                : { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
            }
          >
            {agent.status === "active" ? "Deaktivieren" : "Aktivieren"}
          </button>
        </form>
      </td>
    </tr>
  );
}

function formatTokenUsage(tokenUsage: Record<string, unknown> | null): string {
  if (!tokenUsage) return "—";
  const num = (keys: string[]): number | null => {
    for (const key of keys) {
      const value = tokenUsage[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
  };
  const input = num(["input_tokens", "tokens_in", "prompt_tokens", "in"]);
  const output = num(["output_tokens", "tokens_out", "completion_tokens", "out"]);
  if (input == null && output == null) return "—";
  return `${(input ?? 0).toLocaleString("de-DE")} in · ${(output ?? 0).toLocaleString("de-DE")} out`;
}

function RunRow({
  run,
  triggeredByName,
  agentName,
}: {
  run: AgentRun;
  triggeredByName?: string;
  agentName?: string;
}) {
  const toolCount = Array.isArray(run.tool_calls) ? run.tool_calls.length : 0;
  return (
    <li
      className="rounded-xl p-3 flex flex-col gap-1.5"
      style={{
        background: "var(--color-bg)",
        border:
          run.status === "failed"
            ? "1px solid var(--color-danger)"
            : "1px solid var(--color-line-soft)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <Pill label={RUN_STATUS_LABELS[run.status]} tone={RUN_STATUS_TONES[run.status]} />
        <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
          {agentName ?? "Agent-Modus"}
          {triggeredByName && (
            <span className="font-normal" style={{ color: "var(--color-muted)" }}>
              {" "}
              · {triggeredByName}
            </span>
          )}
        </span>
        <span className="text-xs shrink-0" style={{ color: "var(--color-placeholder)" }}>
          {new Date(run.started_at).toLocaleString("de-DE")}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--color-muted)" }}>
        <span>Modell: {run.model ?? "—"}</span>
        <span>Tools: {toolCount}</span>
        <span>Dauer: {run.duration_ms != null ? `${run.duration_ms} ms` : "—"}</span>
        <span>Tokens: {formatTokenUsage(run.token_usage)}</span>
      </div>
      {run.error_message && (
        <span className="text-xs" style={{ color: "var(--color-danger)" }} title={run.error_message}>
          {truncate(run.error_message, 140)}
        </span>
      )}
    </li>
  );
}
