import Link from "next/link";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { listAutomations } from "@/lib/db/queries/workflows";
import { Empty, Panel, StatCard, formatMinutes } from "../ui";

export const dynamic = "force-dynamic";

const USAGE_DAYS = 30;
const QUOTA_WARN_THRESHOLD = 0.8;

const PURPOSE_LABELS: Record<string, string> = {
  chat: "Chat",
  agent: "Agent",
  skill: "Skill",
  automation: "Automatisierung",
  embedding: "Embedding",
};

interface UsageDailyRow {
  day: string;
  purpose: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number | null;
  events: number;
}

interface UsageAgg {
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  events: number;
}

function emptyAgg(): UsageAgg {
  return { tokensIn: 0, tokensOut: 0, costCents: 0, events: 0 };
}

function addRow(agg: UsageAgg, row: UsageDailyRow): void {
  agg.tokensIn += Number(row.tokens_in ?? 0);
  agg.tokensOut += Number(row.tokens_out ?? 0);
  agg.costCents += Number(row.cost_cents ?? 0);
  agg.events += Number(row.events ?? 0);
}

async function listUsageDaily(orgId: string): Promise<UsageDailyRow[]> {
  try {
    const db = await createUserClient();
    const since = new Date(Date.now() - USAGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from("ai_usage_daily")
      .select("day, purpose, model, tokens_in, tokens_out, cost_cents, events")
      .eq("organization_id", orgId)
      .gte("day", since);
    if (error || !data) return [];
    return data as UsageDailyRow[];
  } catch {
    return [];
  }
}

async function getMonthUsage(orgId: string): Promise<{ tokens: number; costCents: number } | null> {
  try {
    const db = await createUserClient();
    const { data, error } = await db.rpc("get_org_ai_usage_month", { p_org_id: orgId });
    if (error || !data || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as Record<string, unknown>;
    return { tokens: Number(row.tokens ?? 0), costCents: Number(row.cost_cents ?? 0) };
  } catch {
    return null;
  }
}

async function getTokenLimit(orgId: string): Promise<number | null> {
  try {
    const db = await createUserClient();
    const { data, error } = await db.rpc("get_org_limit", {
      p_org_id: orgId,
      p_limit_key: "max_ai_tokens_month",
    });
    if (error || data == null) return null;
    const limit = Number(data);
    return Number.isFinite(limit) && limit > 0 ? limit : null;
  } catch {
    return null;
  }
}

/** Sum of kpi_events time_saved values (minutes), org-scoped via RLS. */
async function getTimeSavedMinutes(orgId: string): Promise<number> {
  try {
    const db = await createUserClient();
    const { data, error } = await db
      .from("kpi_events")
      .select("value")
      .eq("organization_id", orgId)
      .eq("event_type", "time_saved")
      .limit(1000);
    if (error || !data) return 0;
    return data.reduce((sum, row) => sum + Number((row as { value: unknown }).value ?? 0), 0);
  } catch {
    return 0;
  }
}

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/**
 * Nutzung & Kosten (berater spec §7): 30-day usage from ai_usage_daily,
 * monthly quota vs. plan limit (80% warning), and the outcome view
 * ("Ergebnis statt Feature": saved time). Model routing itself stays on
 * /admin/ai-settings.
 */
export default async function CockpitModellePage() {
  const orgId = await requireOrgId();
  const [usage, monthUsage, tokenLimit, kpiTimeSaved, automations] = await Promise.all([
    listUsageDaily(orgId),
    getMonthUsage(orgId),
    getTokenLimit(orgId),
    getTimeSavedMinutes(orgId),
    listAutomations(orgId).catch(() => []),
  ]);

  const total = emptyAgg();
  const byPurpose = new Map<string, UsageAgg>();
  const byModel = new Map<string, UsageAgg>();
  for (const row of usage) {
    addRow(total, row);
    const purpose = byPurpose.get(row.purpose) ?? emptyAgg();
    addRow(purpose, row);
    byPurpose.set(row.purpose, purpose);
    const model = byModel.get(row.model) ?? emptyAgg();
    addRow(model, row);
    byModel.set(row.model, model);
  }

  const quotaPercent =
    monthUsage && tokenLimit ? Math.min(100, Math.round((monthUsage.tokens / tokenLimit) * 100)) : null;
  const quotaWarning =
    monthUsage != null && tokenLimit != null && monthUsage.tokens >= tokenLimit * QUOTA_WARN_THRESHOLD;

  const automationMinutes = automations.reduce(
    (sum, a) => sum + a.minutesSavedPerRun * a.kpi.success,
    0,
  );

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      {quotaWarning && (
        <div
          className="rounded-xl p-4 flex items-start gap-3"
          style={{ background: "var(--color-warning-soft)", border: "1px solid var(--color-warning)" }}
        >
          <span aria-hidden style={{ color: "var(--color-warning)" }}>⚠</span>
          <div className="text-[13px]" style={{ color: "var(--color-text)" }}>
            <strong>Achtung: 80 % des Monatskontingents erreicht.</strong> Weitere Cockpit-Anfragen
            können blockiert werden, sobald das Limit ausgeschöpft ist.
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Tokens rein (30 T.)" value={total.tokensIn.toLocaleString("de-DE")} />
        <StatCard label="Tokens raus (30 T.)" value={total.tokensOut.toLocaleString("de-DE")} />
        <StatCard label="Kosten (30 T.)" value={formatEuro(total.costCents)} />
        <StatCard label="Aufrufe (30 T.)" value={total.events.toLocaleString("de-DE")} />
      </section>

      <Panel title="Monatskontingent">
        {monthUsage == null ? (
          <Empty text="Noch keine Nutzungsdaten — erscheint nach dem Migrations-Push." />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm" style={{ color: "var(--color-text)" }}>
              <span>
                <strong>{monthUsage.tokens.toLocaleString("de-DE")}</strong> Tokens diesen Monat
                {tokenLimit != null && (
                  <span style={{ color: "var(--color-muted)" }}>
                    {" "}
                    von {tokenLimit.toLocaleString("de-DE")}
                  </span>
                )}
              </span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                Kosten: {formatEuro(monthUsage.costCents)}
              </span>
            </div>
            {quotaPercent != null ? (
              <>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ background: "var(--color-bg-elevated)" }}
                  role="progressbar"
                  aria-valuenow={quotaPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Monatskontingent"
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${quotaPercent}%`,
                      background: quotaWarning ? "var(--color-warning)" : "var(--color-accent)",
                    }}
                  />
                </div>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {quotaPercent} % des Kontingents genutzt
                </span>
              </>
            ) : (
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                Kein Token-Limit im Plan hinterlegt (max_ai_tokens_month).
              </span>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Ergebnis statt Feature — eingesparte Zeit">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl p-3" style={{ background: "var(--color-bg)", border: "1px solid var(--color-line-soft)" }}>
            <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
              Aus KPI-Events (time_saved)
            </p>
            <p className="text-xl font-bold mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--color-success)" }}>
              {formatMinutes(kpiTimeSaved)}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{ background: "var(--color-bg)", border: "1px solid var(--color-line-soft)" }}>
            <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
              Aus Automatisierungen (live)
            </p>
            <p className="text-xl font-bold mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--color-success)" }}>
              {formatMinutes(automationMinutes)}
            </p>
          </div>
        </div>
        <p className="text-xs mt-3" style={{ color: "var(--color-muted)" }}>
          Dieselben Werte sieht der Kunde im Cockpit — keine zwei Wahrheiten.
        </p>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-6">
        <BreakdownPanel
          title="Nach Zweck (30 Tage)"
          rows={[...byPurpose.entries()].map(([key, agg]) => ({
            label: PURPOSE_LABELS[key] ?? key,
            agg,
          }))}
        />
        <BreakdownPanel
          title="Nach Modell (30 Tage)"
          rows={[...byModel.entries()].map(([key, agg]) => ({ label: key, agg }))}
        />
      </div>

      <div>
        <Link
          href="/admin/ai-settings"
          className="inline-flex items-center min-h-[44px] px-4 rounded-xl text-sm font-medium"
          style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
        >
          Modell &amp; Routing ändern →
        </Link>
      </div>
    </div>
  );
}

function BreakdownPanel({ title, rows }: { title: string; rows: { label: string; agg: UsageAgg }[] }) {
  const sorted = [...rows].sort((a, b) => b.agg.costCents - a.agg.costCents || b.agg.events - a.agg.events);
  return (
    <Panel title={title}>
      {sorted.length === 0 ? (
        <Empty text="Noch keine Nutzungsdaten in den letzten 30 Tagen." />
      ) : (
        <div className="w-full overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>&nbsp;</th>
                <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>Tokens</th>
                <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>Kosten</th>
                <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wide" style={{ color: "var(--color-placeholder)" }}>Aufrufe</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ label, agg }) => (
                <tr key={label} className="border-t" style={{ borderColor: "var(--color-line-soft)" }}>
                  <td className="px-3 py-2 font-medium" style={{ color: "var(--color-text)" }}>
                    {label}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--color-muted)" }}>
                    {(agg.tokensIn + agg.tokensOut).toLocaleString("de-DE")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--color-muted)" }}>
                    {formatEuro(agg.costCents)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--color-muted)" }}>
                    {agg.events.toLocaleString("de-DE")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
