import { requireOrgId } from "@/lib/db/org-context";
import {
  listAutomations,
  listWorkflowRuns,
  type Automation,
  type WorkflowRun,
} from "@/lib/db/queries/workflows";

export const dynamic = "force-dynamic";

// Read-only customer view of the automations. The Berater keeps the
// action surface (run / seed) under /admin/automatisierungen.

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

export default async function CustomerAutomationsPage() {
  const orgId = await requireOrgId();
  const [automations, runs] = await Promise.all([
    listAutomations(orgId).catch(() => [] as Automation[]),
    listWorkflowRuns(orgId, 30).catch(() => [] as WorkflowRun[]),
  ]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Automatisierungen
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Was gerade für dich läuft
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Überblick über die aktiven Automatisierungen und ihre Ergebnisse. Fragen dazu? Stell sie
          einfach im Chat — z. B. „wie viele Reklamationen gab es?“.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {automations.map((a) => {
          const rate = a.kpi.total > 0 ? Math.round((a.kpi.success / a.kpi.total) * 100) : null;
          const handlungsbedarf = a.kpi.failed > 0;
          return (
            <div
              key={a.key}
              className="rounded-2xl p-5"
              style={{
                background: "var(--color-panel)",
                border: handlungsbedarf ? "1px solid var(--color-danger)" : "1px solid var(--color-line)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[15px] font-semibold truncate" style={{ color: "var(--color-text)" }}>
                  {a.name}
                </span>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                  style={{
                    background: a.active ? "var(--color-success-soft)" : "var(--color-bg-elevated)",
                    color: a.active ? "var(--color-success)" : "var(--color-muted)",
                  }}
                >
                  {a.active ? "Aktiv" : "Inaktiv"}
                </span>
              </div>
              <p className="text-[12px] mb-3" style={{ color: "var(--color-muted)" }}>{a.description}</p>
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Tickets" value={String(a.kpi.total)} />
                <Stat label="Erfolg" value={String(a.kpi.success)} tone="success" />
                <Stat label="Fehler" value={String(a.kpi.failed)} tone={handlungsbedarf ? "danger" : "default"} />
                <Stat label="Quote" value={rate == null ? "—" : `${rate}%`} />
              </div>
              <p className="text-[11px] mt-3" style={{ color: "var(--color-placeholder)" }}>
                Letzter Lauf: {relativeTime(a.kpi.last_run_at)}
              </p>
              {handlungsbedarf && (
                <p className="text-[12px] mt-2 font-medium" style={{ color: "var(--color-danger)" }}>
                  ⚠ {a.kpi.failed} {a.kpi.failed === 1 ? "Fall benötigt" : "Fälle benötigen"} Aufmerksamkeit.
                </p>
              )}
            </div>
          );
        })}
      </section>

      <div className="rounded-2xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
        <h2 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>Letzte Vorgänge</h2>
        {runs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>Noch keine Vorgänge.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((r) => {
              const src = r.source_ref as { customer_name?: string; product_name?: string } | null;
              const title = [src?.product_name, src?.customer_name].filter(Boolean).join(" · ") || r.workflow_key;
              return (
                <li
                  key={r.id}
                  className="rounded-xl p-3 flex flex-wrap items-center gap-2 md:gap-3"
                  style={{
                    background: "var(--color-bg)",
                    border: r.status === "failed" ? "1px solid var(--color-danger)" : "1px solid var(--color-line-soft)",
                  }}
                >
                  <StatusPill status={r.status} />
                  <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                    {title}
                  </span>
                  {r.target_ref?.url && (
                    <a href={r.target_ref.url} target="_blank" rel="noreferrer" className="text-xs font-medium" style={{ color: "var(--color-accent)" }}>
                      Trello →
                    </a>
                  )}
                  <span className="text-xs shrink-0" style={{ color: "var(--color-placeholder)" }}>
                    {relativeTime(r.started_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "danger" }) {
  const color =
    tone === "success" ? "var(--color-success)" :
    tone === "danger"  ? "var(--color-danger)"  :
                         "var(--color-text)";
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>{label}</span>
      <span className="text-lg font-bold leading-tight" style={{ fontFamily: "var(--font-display)", color }}>{value}</span>
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
    <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: bg, color }}>{label}</span>
  );
}
