import { createServiceClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { setIcpOverride } from "./actions";

export const dynamic = "force-dynamic";

type Industry = "commerce" | "hls" | "bauwesen" | "other" | "unclassified";

const ICP_LABEL: Record<Industry, string> = {
  commerce:     "E-Commerce KMU",
  hls:          "Heizung · Lüftung · Sanitär",
  bauwesen:     "Bauwesen / Architekten",
  other:        "Andere",
  unclassified: "Nicht klassifiziert",
};

const ICP_TONE: Record<Industry, string> = {
  commerce:     "var(--color-accent)",
  hls:          "#17C764",
  bauwesen:     "#F59E0B",
  other:        "var(--color-muted)",
  unclassified: "var(--color-placeholder)",
};

const TARGET_ICPS: Industry[] = ["commerce", "hls", "bauwesen"];

interface KpiRow {
  organization_id:        string;
  industry:               Industry;
  day:                    string;
  activity_count:         number;
  calls_count:            number;
  meetings_count:         number;
  emails_count:           number;
  open_deals_count:       number;
  open_pipeline_value:    number;
  weighted_pipeline_value: number;
  stale_deal_count:       number;
}

interface StaleDeal {
  deal_external_id:  string;
  title:             string | null;
  value:             number | null;
  currency:          string | null;
  industry:          Industry;
  owner_external_id: string | null;
  org_external_id:   string | null;
  last_activity_at:  string | null;
  days_stale:        number;
}

interface PdConnection {
  status:  string;
  config?: { company_domain?: string };
}

function startOfThisWeek(ref: Date): Date {
  const d = new Date(ref.getTime());
  const day = d.getUTCDay() || 7;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

function formatMoney(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString("de-DE")} ${currency ?? "EUR"}`;
  }
}

function daysAgoIsoDate(days: number, ref: Date): string {
  const d = new Date(ref.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export default async function VertriebssteuerungPage() {
  const orgId = await requireOrgId();
  const supabase = createServiceClient();
  const now = new Date();
  const since14d = daysAgoIsoDate(14, now);

  const [kpiResult, integrationResult, staleResult] = await Promise.all([
    supabase
      .from("sales_kpi_daily")
      .select("*")
      .eq("organization_id", orgId)
      .gte("day", since14d)
      .order("day", { ascending: false }),
    supabase
      .from("organization_integrations")
      .select("status, config")
      .eq("organization_id", orgId)
      .eq("provider_id", "pipedrive")
      .maybeSingle<PdConnection>(),
    supabase.rpc("list_stale_pipedrive_deals", { p_org_id: orgId, p_days: 14 }),
  ]);

  const allRows = (kpiResult.data ?? []) as KpiRow[];
  const pdConnection = integrationResult.data;
  const stale = (staleResult.data ?? []) as StaleDeal[];

  if (!pdConnection || pdConnection.status !== "active") {
    return <NotConnected />;
  }

  const weekStart = startOfThisWeek(now);
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Pipeline-Volume: latest day per industry (the view rolls open_pipeline today)
  const latestByIndustry = new Map<Industry, KpiRow>();
  for (const r of allRows) {
    const prev = latestByIndustry.get(r.industry);
    if (!prev || prev.day < r.day) latestByIndustry.set(r.industry, r);
  }

  const targetWeighted = sumWeightedPipeline(latestByIndustry, TARGET_ICPS);
  const offTargetWeighted = sumWeightedPipeline(latestByIndustry, (Object.keys(ICP_LABEL) as Industry[]).filter((i) => !TARGET_ICPS.includes(i)));
  const focusQuote = targetWeighted + offTargetWeighted > 0
    ? Math.round((targetWeighted / (targetWeighted + offTargetWeighted)) * 100)
    : 0;

  // Activities this week vs last week, in target ICPs
  const thisWeek = sumActivities(allRows, weekStart, now, TARGET_ICPS);
  const lastWeek = sumActivities(allRows, lastWeekStart, weekStart, TARGET_ICPS);
  const trend = lastWeek === 0 ? null : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);

  const companyDomain = pdConnection.config?.company_domain;
  const pdLink = (id: string) => companyDomain
    ? `https://${companyDomain}.pipedrive.com/deal/${id}`
    : `https://app.pipedrive.com/deal/${id}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Vertriebssteuerung
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Pipeline · Fokus · Aktivitäten
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Steuert den Vertrieb auf Zielbranchen (E-Commerce KMU, HLS, Bauwesen).
          Zahlen kommen direkt aus Pipedrive — Refresh alle 15 Minuten.
        </p>
      </header>

      <section>
        <h2 className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-placeholder)" }}>
          Fokus-KPIs (aktuelle Woche)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <StatCard
            label="Pipeline-Fokus"
            value={`${focusQuote} %`}
            sub={`${formatMoney(targetWeighted, "EUR")} in Zielbranche`}
          />
          <StatCard
            label="Aktivitäten ICP · Woche"
            value={String(thisWeek)}
            sub={trend === null ? "Erste Vergleichswoche" : `${trend >= 0 ? "+" : ""}${trend}% vs. Vorwoche`}
            tone={trend !== null && trend < 0 ? "warn" : undefined}
          />
          <StatCard
            label="Stale Deals (ICP, 14d+)"
            value={String(stale.filter((d) => TARGET_ICPS.includes(d.industry)).length)}
            tone="warn"
          />
          <StatCard
            label="Off-ICP Volumen"
            value={formatMoney(offTargetWeighted, "EUR")}
            tone={offTargetWeighted > targetWeighted ? "warn" : undefined}
          />
        </div>
      </section>

      <section>
        <h2 className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-placeholder)" }}>
          Pipeline pro Branche
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {TARGET_ICPS.map((ind) => {
            const row = latestByIndustry.get(ind);
            return (
              <SegmentCard
                key={ind}
                label={ICP_LABEL[ind]}
                tone={ICP_TONE[ind]}
                weighted={row?.weighted_pipeline_value ?? 0}
                openCount={row?.open_deals_count ?? 0}
                staleCount={row?.stale_deal_count ?? 0}
              />
            );
          })}
        </div>
      </section>

      <Panel title="Stale Deals in Zielbranchen">
        {stale.length === 0 ? (
          <Empty text="Keine offenen ICP-Deals ohne Aktivität in den letzten 14 Tagen." />
        ) : (
          <ul className="flex flex-col gap-2">
            {stale
              .filter((d) => TARGET_ICPS.includes(d.industry))
              .slice(0, 20)
              .map((d) => (
                <li
                  key={d.deal_external_id}
                  className="rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4"
                  style={{ background: "var(--color-bg)" }}
                >
                  <IndustryPill industry={d.industry} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                      {d.title ?? `Deal ${d.deal_external_id}`}
                    </div>
                    <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                      {d.days_stale} Tage ohne Aktivität · Owner {d.owner_external_id ?? "—"}
                    </div>
                  </div>
                  <div className="text-xs flex items-center gap-3 flex-wrap" style={{ color: "var(--color-muted)" }}>
                    <span>{d.value !== null ? formatMoney(d.value, d.currency) : "—"}</span>
                    {d.org_external_id && <OverrideForm orgExternalId={d.org_external_id} currentIndustry={d.industry} />}
                    <a
                      href={pdLink(d.deal_external_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[36px] px-3 inline-flex items-center rounded-lg text-[12px] font-semibold"
                      style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                    >
                      In Pipedrive öffnen
                    </a>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function sumWeightedPipeline(map: Map<Industry, KpiRow>, industries: Industry[]): number {
  let total = 0;
  for (const ind of industries) {
    total += map.get(ind)?.weighted_pipeline_value ?? 0;
  }
  return total;
}

function sumActivities(rows: KpiRow[], from: Date, to: Date, industries: Industry[]): number {
  const fromKey = from.toISOString().slice(0, 10);
  const toKey = to.toISOString().slice(0, 10);
  let total = 0;
  for (const r of rows) {
    if (!industries.includes(r.industry)) continue;
    if (r.day < fromKey || r.day >= toKey) continue;
    total += r.activity_count;
  }
  return total;
}

function NotConnected() {
  return (
    <div
      className="rounded-2xl p-6 flex flex-col gap-3"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <h1 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>
        Pipedrive noch nicht verbunden
      </h1>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Verbinde dein Pipedrive über die Connect-Card unter „Datenquellen + Sync&ldquo;, damit die
        Vertriebssteuerung Daten zeigen kann.
      </p>
      <a
        href="/admin/integrationen"
        className="inline-flex items-center min-h-[44px] px-4 rounded-lg text-sm font-semibold w-fit"
        style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
      >
        Zu den Integrationen
      </a>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
        {label}
      </p>
      <p
        className="text-2xl md:text-3xl font-bold mt-1"
        style={{
          fontFamily: "var(--font-display)",
          color: tone === "warn" ? "var(--color-danger)" : "var(--color-text)",
        }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>{sub}</p>
      )}
    </div>
  );
}

function SegmentCard({
  label,
  tone,
  weighted,
  openCount,
  staleCount,
}: {
  label: string;
  tone: string;
  weighted: number;
  openCount: number;
  staleCount: number;
}) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-2"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: tone }} aria-hidden />
        <span className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
        {formatMoney(weighted, "EUR")}
      </p>
      <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
        {openCount} offene Deals · {staleCount} stale
      </p>
    </div>
  );
}

function OverrideForm({ orgExternalId, currentIndustry }: { orgExternalId: string; currentIndustry: Industry }) {
  return (
    <form action={setIcpOverride} className="flex items-center gap-1">
      <input type="hidden" name="pipedrive_org_external_id" value={orgExternalId} />
      <select
        name="industry"
        defaultValue={currentIndustry}
        className="min-h-[36px] rounded-lg px-2 text-[12px]"
        style={{ background: "var(--color-bg-elevated)", color: "var(--color-text)", border: "1px solid var(--color-line)" }}
      >
        <option value="commerce">E-Commerce</option>
        <option value="hls">HLS</option>
        <option value="bauwesen">Bauwesen</option>
        <option value="other">Andere</option>
      </select>
      <button
        type="submit"
        className="min-h-[36px] px-2 rounded-lg text-[12px] font-semibold"
        style={{ background: "var(--color-bg-elevated)", color: "var(--color-text)", border: "1px solid var(--color-line)" }}
        title="Branche überschreiben"
      >
        ✓
      </button>
    </form>
  );
}

function IndustryPill({ industry }: { industry: Industry }) {
  return (
    <span
      className="text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap"
      style={{ background: "var(--color-bg-elevated)", color: ICP_TONE[industry] }}
    >
      {ICP_LABEL[industry]}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <h2 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm" style={{ color: "var(--color-muted)" }}>{text}</p>;
}
