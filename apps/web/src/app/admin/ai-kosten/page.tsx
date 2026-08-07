import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import {
  usagePlatformRollup,
  quotaAlarms,
  runsDaily,
} from "@/lib/db/queries/admin-cockpit";
import { table } from "@/components/ui/table-classes";

export const dynamic = "force-dynamic";

// Plattform-Observability & Kosten (admin spec §6): STRICT platform gate —
// the soft /admin layout gate lets org admins through and must not be relied
// on here. All data via service-role-only cross-tenant views.

const PURPOSE_LABELS: Record<string, string> = {
  chat: "Chat",
  agent: "Agent",
  embedding: "Embedding",
};

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function formatTokens(n: number): string {
  return n.toLocaleString("de-DE");
}

export default async function AiCostsPage() {
  if (!(await isPlatformAdmin().catch(() => false))) redirect("/");

  const [rollup, alarms, runs] = await Promise.all([
    usagePlatformRollup(),
    quotaAlarms(),
    runsDaily(14),
  ]);

  const alarmOrgIds = new Set(alarms.map((a) => a.organization_id));
  const totalTokens = rollup.perOrg.reduce((sum, o) => sum + o.tokens, 0);
  const totalCost = rollup.perOrg.reduce((sum, o) => sum + o.cost_cents, 0);

  const agentTotals = runs.reduce(
    (acc, r) => ({ total: acc.total + r.total, failed: acc.failed + r.failed }),
    { total: 0, failed: 0 },
  );
  const errorRate = (t: { total: number; failed: number }) =>
    t.total === 0 ? "—" : `${((t.failed / t.total) * 100).toFixed(1).replace(".", ",")} %`;

  const monthLabel = new Date().toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Plattform · AI-Kosten
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          AI-Kosten &amp; Observability (cross-tenant)
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Token-Verbrauch und Kostenschätzung je Kunde im laufenden Monat ({monthLabel}),
          Breakdown nach Provider/Modell/Zweck sowie Run-Volumen der letzten 14 Tage.
        </p>
      </header>

      {/* ── Übersichtskarten ── */}
      <section className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        <StatCard label="Tokens (Monat)" value={formatTokens(totalTokens)} />
        <StatCard label="Kosten (Monat)" value={formatEuro(totalCost)} />
        <StatCard
          label="Agent-Runs (14 T.)"
          value={formatTokens(agentTotals.total)}
          sub={`Fehlerrate ${errorRate(agentTotals)}`}
          warn={agentTotals.failed > 0}
        />
      </section>

      {/* ── Quoten-Alarme ── */}
      {alarms.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: "var(--color-warning-soft, var(--color-bg-elevated))", border: "1px solid var(--color-line)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--color-warning, var(--color-danger))" }}>
            Quoten-Alarm: {alarms.map((a) => `${a.org_name} (${Math.round(a.ratio * 100)} %)`).join(" · ")}
          </p>
        </div>
      )}

      {/* ── Pro Kunde ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Verbrauch je Kunde (laufender Monat)
        </h2>

        <div className="rounded-xl overflow-hidden" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead>
                <tr style={{ background: "var(--color-bg-elevated)" }}>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Kunde</th>
                  <th className={`${table.th} hidden md:table-cell`} style={{ color: "var(--color-text-secondary)" }}>Plan</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Tokens</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Kosten</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Limit</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Auslastung</th>
                </tr>
              </thead>
              <tbody>
                {rollup.perOrg.map((o) => {
                  const ratio = o.tokens_limit && o.tokens_limit > 0 ? o.tokens / o.tokens_limit : null;
                  const isAlarm = alarmOrgIds.has(o.organization_id);
                  return (
                    <tr key={o.organization_id} className={table.tr} style={{ borderColor: "var(--color-line)" }}>
                      <td className={`${table.td} text-sm font-medium`} style={{ color: "var(--color-text)" }}>
                        {o.org_name}
                      </td>
                      <td className={`${table.td} hidden md:table-cell text-xs`} style={{ color: "var(--color-muted)" }}>
                        {o.plan_id ?? "—"}
                      </td>
                      <td className={`${table.td} text-sm tabular-nums`} style={{ color: "var(--color-text)" }}>
                        {formatTokens(o.tokens)}
                      </td>
                      <td className={`${table.td} text-sm tabular-nums`} style={{ color: "var(--color-text)" }}>
                        {formatEuro(o.cost_cents)}
                      </td>
                      <td className={`${table.td} text-xs tabular-nums`} style={{ color: "var(--color-muted)" }}>
                        {o.tokens_limit ? formatTokens(o.tokens_limit) : "—"}
                      </td>
                      <td className={table.td}>
                        {ratio === null ? (
                          <span className="text-xs" style={{ color: "var(--color-placeholder)" }}>—</span>
                        ) : (
                          <div className="flex items-center gap-2 min-w-[140px]">
                            <div className="h-1.5 rounded-full flex-1 overflow-hidden" style={{ background: "var(--color-bg-elevated)" }}>
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(100, Math.round(ratio * 100))}%`,
                                  background: isAlarm ? "var(--color-danger)" : "var(--color-accent)",
                                }}
                              />
                            </div>
                            <span className="text-xs tabular-nums" style={{ color: isAlarm ? "var(--color-danger)" : "var(--color-muted)" }}>
                              {Math.round(ratio * 100)} %
                            </span>
                            {isAlarm && (
                              <span
                                className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                                style={{ background: "var(--color-danger-soft, var(--color-bg-elevated))", color: "var(--color-danger)" }}
                              >
                                ≥ 80 %
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rollup.perOrg.length === 0 && (
            <div className="p-8 text-center text-sm" style={{ color: "var(--color-muted)" }}>
              Noch keine Nutzungsdaten — erscheint nach dem ersten KI-Aufruf nach dem
              Migrations-Push.
            </div>
          )}
        </div>
      </section>

      {/* ── Breakdown ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Breakdown nach Provider / Modell / Zweck
        </h2>

        <div className="rounded-xl overflow-hidden" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead>
                <tr style={{ background: "var(--color-bg-elevated)" }}>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Provider</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Modell</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Zweck</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Tokens</th>
                  <th className={table.th} style={{ color: "var(--color-text-secondary)" }}>Kosten</th>
                  <th className={`${table.th} hidden md:table-cell`} style={{ color: "var(--color-text-secondary)" }}>Events</th>
                </tr>
              </thead>
              <tbody>
                {rollup.breakdown.map((b) => (
                  <tr key={`${b.provider}:${b.model}:${b.purpose}`} className={table.tr} style={{ borderColor: "var(--color-line)" }}>
                    <td className={`${table.td} text-sm`} style={{ color: "var(--color-text)" }}>{b.provider}</td>
                    <td className={`${table.td} text-xs`} style={{ color: "var(--color-muted)" }}>{b.model}</td>
                    <td className={`${table.td} text-xs`} style={{ color: "var(--color-muted)" }}>
                      {PURPOSE_LABELS[b.purpose] ?? b.purpose}
                    </td>
                    <td className={`${table.td} text-sm tabular-nums`} style={{ color: "var(--color-text)" }}>
                      {formatTokens(b.tokens)}
                    </td>
                    <td className={`${table.td} text-sm tabular-nums`} style={{ color: "var(--color-text)" }}>
                      {formatEuro(b.cost_cents)}
                    </td>
                    <td className={`${table.td} hidden md:table-cell text-xs tabular-nums`} style={{ color: "var(--color-muted)" }}>
                      {formatTokens(b.events)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rollup.breakdown.length === 0 && (
            <div className="p-8 text-center text-sm" style={{ color: "var(--color-muted)" }}>
              Noch keine Nutzungsdaten — erscheint nach dem ersten KI-Aufruf nach dem
              Migrations-Push.
            </div>
          )}
        </div>
      </section>

      {runs.length === 0 && (
        <p className="text-[11px]" style={{ color: "var(--color-placeholder)" }}>
          Noch keine Agent-Runs — die Run-Karte füllt sich, sobald die ersten Läufe
          protokolliert sind.
        </p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
      <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
        {label}
      </p>
      <p className="text-2xl md:text-3xl font-bold mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-1" style={{ color: warn ? "var(--color-danger)" : "var(--color-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}
