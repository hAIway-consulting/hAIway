import Link from "next/link";
import { requireOrgId } from "@/lib/db/org-context";
import {
  listAutomations,
  listWorkflowRuns,
  type Automation,
  type WorkflowRun,
  type WorkflowStep,
} from "@/lib/db/queries/workflows";
import { setAutomationStatus, setMinutesSavedForm } from "../actions";
import { Empty, Panel, Pill, StatCard, formatMinutes, relativeTime } from "../ui";

export const dynamic = "force-dynamic";

const RUNS_PER_AUTOMATION = 10;

/**
 * Automatisierungs-Verwaltung (berater spec §4): list per tenant with
 * status/blockers/KPIs, Start/Stopp + minutes_saved_per_run maintenance and
 * a per-automation run drill-down. DLQ replay stays on /admin/integrationen
 * for v1.
 */
export default async function CockpitAutomatisierungenPage() {
  const orgId = await requireOrgId();
  const [automations, runs] = await Promise.all([
    listAutomations(orgId).catch(() => [] as Automation[]),
    listWorkflowRuns(orgId, 100).catch(() => [] as WorkflowRun[]),
  ]);

  // Group the newest runs per workflow_key for the drill-down.
  const runsByKey = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    const list = runsByKey.get(run.workflow_key) ?? [];
    if (list.length < RUNS_PER_AUTOMATION) list.push(run);
    runsByKey.set(run.workflow_key, list);
  }

  const totals = automations.reduce(
    (acc, a) => ({
      total: acc.total + a.kpi.total,
      success: acc.success + a.kpi.success,
      failed: acc.failed + a.kpi.failed,
      savedMinutes: acc.savedMinutes + a.minutesSavedPerRun * a.kpi.success,
    }),
    { total: 0, success: 0, failed: 0, savedMinutes: 0 },
  );

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Läufe gesamt" value={totals.total} />
        <StatCard label="Erfolgreich" value={totals.success} tone="success" />
        <StatCard label="Fehlgeschlagen" value={totals.failed} tone="warn" />
        <StatCard label="Eingesparte Zeit" value={formatMinutes(totals.savedMinutes)} />
      </section>

      {automations.length === 0 ? (
        <Panel title="Automatisierungen">
          <Empty text="Noch keine Automatisierungen für diese Organisation angelegt." />
        </Panel>
      ) : (
        automations.map((a) => (
          <AutomationCard key={a.key} automation={a} runs={runsByKey.get(a.key) ?? []} />
        ))
      )}
    </div>
  );
}

function AutomationCard({ automation: a, runs }: { automation: Automation; runs: WorkflowRun[] }) {
  const id = a.id;
  const savedMinutes = a.minutesSavedPerRun * a.kpi.success;
  const nextStatus = a.status === "active" ? ("stopped" as const) : ("active" as const);

  return (
    <div
      className="rounded-xl p-4 md:p-5 flex flex-col gap-3"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <h2 className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
          {a.name}
        </h2>
        {a.status === "stopped" ? (
          <Pill label="Gestoppt" tone="muted" />
        ) : a.blockers.length > 0 ? (
          <Pill label="Blockiert" tone="warning" />
        ) : (
          <Pill label="Aktiv" tone="success" />
        )}
      </div>

      <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
        {a.description}
      </p>

      {a.blockers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-warning)" }}>
            Fehlende Integrationen:
          </span>
          {a.blockers.map((b) => (
            <Link
              key={b}
              href="/admin/integrationen"
              className="text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: "var(--color-warning-soft)", color: "var(--color-warning)" }}
            >
              {b} →
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" style={{ color: "var(--color-muted)" }}>
        <span>
          Läufe: <strong style={{ color: "var(--color-text)" }}>{a.kpi.total}</strong>
        </span>
        <span>
          Erfolg: <strong style={{ color: "var(--color-success)" }}>{a.kpi.success}</strong>
        </span>
        <span>
          Fehler:{" "}
          <strong style={{ color: a.kpi.failed > 0 ? "var(--color-danger)" : "var(--color-text)" }}>
            {a.kpi.failed}
          </strong>
        </span>
        <span>
          Letzter Lauf:{" "}
          <strong style={{ color: "var(--color-text)" }}>{relativeTime(a.kpi.last_run_at)}</strong>
        </span>
        <span>
          Eingesparte Zeit:{" "}
          <strong style={{ color: "var(--color-text)" }}>{formatMinutes(savedMinutes)}</strong>
        </span>
      </div>

      {id ? (
        <div
          className="flex flex-wrap items-center gap-3 pt-3 border-t"
          style={{ borderColor: "var(--color-line-soft)" }}
        >
          <form action={setAutomationStatus.bind(null, id, nextStatus)}>
            <button
              type="submit"
              className="min-h-[44px] min-w-[44px] px-5 rounded-xl text-sm font-semibold"
              style={
                a.status === "active"
                  ? {
                      background: "var(--color-bg-elevated)",
                      color: "var(--color-text)",
                      border: "1px solid var(--color-line)",
                    }
                  : { background: "var(--color-accent)", color: "var(--color-accent-text)" }
              }
            >
              {a.status === "active" ? "Stoppen" : "Starten"}
            </button>
          </form>

          <form action={setMinutesSavedForm} className="flex items-center gap-2">
            <input type="hidden" name="automation_id" value={id} />
            <label className="text-xs" style={{ color: "var(--color-muted)" }} htmlFor={`minutes-${id}`}>
              Min/Lauf
            </label>
            <input
              id={`minutes-${id}`}
              type="number"
              name="minutes"
              min={0}
              max={600}
              step={1}
              defaultValue={a.minutesSavedPerRun}
              className="w-24 min-h-[44px] rounded-xl border px-3 text-sm outline-none"
              style={{
                borderColor: "var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
            />
            <button
              type="submit"
              className="min-h-[44px] min-w-[44px] px-4 rounded-xl text-sm font-medium"
              style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
            >
              Speichern
            </button>
          </form>
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--color-placeholder)" }}>
          Noch nicht in der Datenbank registriert — Start/Stopp und KPI-Pflege erscheinen nach dem
          Migrations-Push.
        </p>
      )}

      <details>
        <summary
          className="cursor-pointer text-sm font-medium min-h-[44px] flex items-center"
          style={{ color: "var(--color-accent)" }}
        >
          Letzte Läufe ({runs.length})
        </summary>
        {runs.length === 0 ? (
          <Empty text="Noch keine Läufe für diese Automatisierung." />
        ) : (
          <ul className="flex flex-col gap-2 mt-1">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRun }) {
  return (
    <li
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{
        background: "var(--color-bg)",
        border:
          run.status === "failed"
            ? "1px solid var(--color-danger)"
            : "1px solid var(--color-line-soft)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <RunStatusPill status={run.status} />
        <span className="flex-1 min-w-0 text-xs truncate" style={{ color: "var(--color-muted)" }}>
          {new Date(run.started_at).toLocaleString("de-DE")}
        </span>
        <span className="text-xs shrink-0" style={{ color: "var(--color-placeholder)" }}>
          {run.duration_ms != null ? `${run.duration_ms} ms` : "—"}
        </span>
      </div>

      {(run.steps ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(run.steps ?? []).map((s, i) => (
            <StepChip key={`${run.id}-${i}`} step={s} />
          ))}
        </div>
      )}

      {run.status === "failed" && run.error_message && (
        <span className="text-xs" style={{ color: "var(--color-danger)" }}>
          {run.error_message}
        </span>
      )}
    </li>
  );
}

function RunStatusPill({ status }: { status: WorkflowRun["status"] }) {
  if (status === "success") return <Pill label="Erfolg" tone="accent" />;
  if (status === "failed") return <Pill label="Fehler" tone="danger" />;
  return <Pill label="läuft" tone="warning" />;
}

function StepChip({ step }: { step: WorkflowStep }) {
  const color =
    step.status === "success"
      ? "var(--color-success)"
      : step.status === "failed"
        ? "var(--color-danger)"
        : "var(--color-muted)";
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
      style={{ background: "var(--color-bg-elevated)", color }}
      title={step.detail}
    >
      <span aria-hidden>{step.status === "success" ? "✓" : step.status === "failed" ? "✕" : "•"}</span>
      {step.label}
    </span>
  );
}
