import { requireOrgId } from "@/lib/db/org-context";
import {
  getWorkflowKpi,
  listWorkflowRuns,
  getOrchestratorStatus,
  type WorkflowRun,
  type WorkflowStep,
} from "@/lib/db/queries/workflows";
import { runComplaintOrchestrator, seedDemoTickets, clearDemoTickets } from "./actions";

export const dynamic = "force-dynamic";

function relativeTime(iso: string | null): string {
  if (!iso) return "noch nie";
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return "gestern";
  return `vor ${diffD} Tagen`;
}

export default async function AutomatisierungenPage() {
  const orgId = await requireOrgId();
  const [kpi, runs] = await Promise.all([
    getWorkflowKpi(orgId).catch(() => null),
    listWorkflowRuns(orgId, 30).catch(() => [] as WorkflowRun[]),
  ]);
  const k = kpi ?? { total: 0, success: 0, failed: 0, running: 0, last_run_at: null, avg_duration_ms: null };
  const status = await getOrchestratorStatus(orgId, k).catch(() => ({
    active: false, handlungsbedarf: k.failed > 0, missing: [] as string[],
  }));
  const successRate = k.total > 0 ? Math.round((k.success / k.total) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Automatisierungen
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Reklamations-Orchestrator
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Liest Kunde + Produkt aus Shopware und legt daraus eine Reklamations-Karte in Trello an.
          Der reale Trigger (E-Mail/Nachricht) ist hier bewusst übersprungen — du löst manuell aus.
        </p>
      </header>

      {/* Status + Runtime */}
      <section className="flex flex-wrap items-center gap-3">
        <StatusBadge active={status.active} />
        <span className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Letzter Lauf: <strong style={{ color: "var(--color-text)" }}>{relativeTime(k.last_run_at)}</strong>
          {k.avg_duration_ms != null && <> · ⌀ {Math.round(k.avg_duration_ms)} ms</>}
        </span>
        {!status.active && status.missing.length > 0 && (
          <span className="text-[12px]" style={{ color: "var(--color-warning)" }}>
            Nicht verbunden: {status.missing.join(", ")}
          </span>
        )}
      </section>

      {/* Handlungsbedarf */}
      {status.handlungsbedarf && (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: "var(--color-danger-soft)", border: "1px solid var(--color-danger)" }}
        >
          <span aria-hidden style={{ color: "var(--color-danger)" }}>⚠</span>
          <div className="text-[13px]" style={{ color: "var(--color-text)" }}>
            <strong>Handlungsbedarf:</strong> {k.failed} {k.failed === 1 ? "Ticket ist" : "Tickets sind"} fehlgeschlagen.
            Prüfe die markierten Einträge in der Liste unten.
          </div>
        </div>
      )}

      {/* KPI tiles */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Tickets gesamt" value={k.total} />
        <StatCard label="Erfolgreich"    value={k.success} tone="success" />
        <StatCard label="Fehlgeschlagen" value={k.failed} tone="warn" />
        <StatCard label="Erfolgsquote"   value={successRate == null ? "—" : `${successRate}%`} />
      </section>

      {/* Actions */}
      <section className="flex flex-wrap gap-2">
        <form action={runComplaintOrchestrator}>
          <button
            type="submit"
            disabled={!status.active}
            className="min-h-[44px] px-5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
          >
            Jetzt ausführen
          </button>
        </form>
        <form action={seedDemoTickets}>
          <button
            type="submit"
            className="min-h-[44px] px-4 rounded-xl text-sm font-semibold"
            style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
          >
            Demo-Tickets erzeugen
          </button>
        </form>
        <form action={clearDemoTickets}>
          <button
            type="submit"
            className="min-h-[44px] px-4 rounded-xl text-sm font-medium"
            style={{ background: "var(--color-bg-elevated)", color: "var(--color-muted)", border: "1px solid var(--color-line)" }}
          >
            Demo-Daten zurücksetzen
          </button>
        </form>
      </section>

      {/* Ticket list */}
      <Panel title="Durchgelaufene Tasks">
        {runs.length === 0 ? (
          <Empty text="Noch keine Läufe — starte oben „Jetzt ausführen“ oder erzeuge Demo-Tickets." />
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((r) => (
              <TicketRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function TicketRow({ run }: { run: WorkflowRun }) {
  const src = run.source_ref as { customer_name?: string; product_name?: string } | null;
  const title = [src?.product_name, src?.customer_name].filter(Boolean).join(" · ") || run.workflow_key;
  return (
    <li
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{
        background: "var(--color-bg)",
        border: run.status === "failed" ? "1px solid var(--color-danger)" : "1px solid var(--color-line-soft)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <StatusPill status={run.status} />
        {run.trigger === "simulated" && (
          <span
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: "var(--color-bg-elevated)", color: "var(--color-placeholder)" }}
          >
            Demo
          </span>
        )}
        <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
          {title}
        </span>
        <span className="text-xs shrink-0" style={{ color: "var(--color-placeholder)" }}>
          {relativeTime(run.started_at)}
          {run.duration_ms != null && <> · {run.duration_ms} ms</>}
        </span>
      </div>

      {/* Step chips — which tasks ran */}
      <div className="flex flex-wrap gap-1.5">
        {(run.steps ?? []).map((s, i) => (
          <StepChip key={`${run.id}-${i}`} step={s} />
        ))}
      </div>

      {run.target_ref?.url && (
        <a
          href={run.target_ref.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium self-start"
          style={{ color: "var(--color-accent)" }}
        >
          Trello-Karte öffnen →
        </a>
      )}
      {run.status === "failed" && run.error_message && (
        <span className="text-xs" style={{ color: "var(--color-danger)" }}>
          {run.error_message}
        </span>
      )}
    </li>
  );
}

function StepChip({ step }: { step: WorkflowStep }) {
  const color =
    step.status === "success" ? "var(--color-success)" :
    step.status === "failed"  ? "var(--color-danger)"  :
                                "var(--color-muted)";
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

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className="text-xs font-semibold px-3 py-1 rounded-full inline-flex items-center gap-1.5"
      style={{
        background: active ? "var(--color-success-soft)" : "var(--color-bg-elevated)",
        color:      active ? "var(--color-success)"      : "var(--color-muted)",
      }}
    >
      <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: active ? "var(--color-success)" : "var(--color-muted)" }} />
      {active ? "Aktiv" : "Inaktiv"}
    </span>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: "warn" | "success" }) {
  const isWarn = tone === "warn" && typeof value === "number" && value > 0;
  return (
    <div className="rounded-2xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
      <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
        {label}
      </p>
      <p
        className="text-2xl md:text-3xl font-bold mt-1"
        style={{
          fontFamily: "var(--font-display)",
          color: isWarn ? "var(--color-danger)" : tone === "success" ? "var(--color-success)" : "var(--color-text)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "success" ? "var(--color-accent)"  :
    status === "running" ? "var(--color-warning)" :
    status === "failed"  ? "var(--color-danger)"  :
                           "var(--color-muted)";
  const bg = status === "success" ? "var(--color-accent-soft)" : "var(--color-bg-elevated)";
  const label = status === "success" ? "Erfolg" : status === "failed" ? "Fehler" : status === "running" ? "läuft" : status;
  return (
    <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: bg, color }}>
      {label}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
      <h2 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>{title}</h2>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm" style={{ color: "var(--color-muted)" }}>{text}</p>;
}
