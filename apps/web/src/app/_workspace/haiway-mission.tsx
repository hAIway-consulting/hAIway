import Link from "next/link";
import { createUserClient, getUser } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { listMyConversations } from "@/app/chat/actions";
import { HeroAsk } from "./hero-ask";
import { launchApp } from "./actions";

type Industry = "commerce" | "hls" | "bauwesen" | "other" | "unclassified";
const TARGET_ICPS: Industry[] = ["commerce", "hls", "bauwesen"];

interface SalesSnapshot {
  connected:               boolean;
  focusQuote:              number;
  targetWeighted:          number;
  offTargetWeighted:       number;
  activitiesThisWeek:      number;
  activitiesLastWeek:      number;
  staleDealCount:          number;
}

interface SalesKpiRow {
  industry:                 Industry;
  day:                      string;
  activity_count:           number;
  weighted_pipeline_value:  number;
  stale_deal_count:         number;
}

function formatMoney(value: number): string {
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString("de-DE")} EUR`;
  }
}

async function loadSalesSnapshot(): Promise<SalesSnapshot | null> {
  let orgId: string;
  try {
    orgId = await requireOrgId();
  } catch {
    return null;
  }
  const db = await createUserClient();

  const { data: integration } = await db
    .from("organization_integrations")
    .select("status")
    .eq("organization_id", orgId)
    .eq("provider_id", "pipedrive")
    .maybeSingle<{ status: string }>();
  if (!integration || integration.status !== "active") {
    return { connected: false, focusQuote: 0, targetWeighted: 0, offTargetWeighted: 0, activitiesThisWeek: 0, activitiesLastWeek: 0, staleDealCount: 0 };
  }

  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: kpis } = await db
    .from("sales_kpi_daily")
    .select("industry, day, activity_count, weighted_pipeline_value, stale_deal_count")
    .eq("organization_id", orgId)
    .gte("day", fourteenDaysAgo);

  const rows = (kpis ?? []) as SalesKpiRow[];
  const latestByIndustry = new Map<Industry, SalesKpiRow>();
  for (const r of rows) {
    const prev = latestByIndustry.get(r.industry);
    if (!prev || prev.day < r.day) latestByIndustry.set(r.industry, r);
  }

  const targetWeighted = TARGET_ICPS.reduce((s, i) => s + (latestByIndustry.get(i)?.weighted_pipeline_value ?? 0), 0);
  const offIndustries = (["other", "unclassified"] as Industry[]);
  const offTargetWeighted = offIndustries.reduce((s, i) => s + (latestByIndustry.get(i)?.weighted_pipeline_value ?? 0), 0);
  const focusQuote = targetWeighted + offTargetWeighted > 0
    ? Math.round((targetWeighted / (targetWeighted + offTargetWeighted)) * 100)
    : 0;

  const weekStart = startOfThisWeek(now);
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  let thisWeek = 0;
  let lastWeek = 0;
  for (const r of rows) {
    if (!TARGET_ICPS.includes(r.industry)) continue;
    if (r.day >= fmt(weekStart) && r.day <= fmt(now)) thisWeek += r.activity_count;
    else if (r.day >= fmt(lastWeekStart) && r.day < fmt(weekStart)) lastWeek += r.activity_count;
  }

  const staleDealCount = TARGET_ICPS.reduce((s, i) => s + (latestByIndustry.get(i)?.stale_deal_count ?? 0), 0);

  return {
    connected:           true,
    focusQuote,
    targetWeighted,
    offTargetWeighted,
    activitiesThisWeek:  thisWeek,
    activitiesLastWeek:  lastWeek,
    staleDealCount,
  };
}

function startOfThisWeek(ref: Date): Date {
  const d = new Date(ref.getTime());
  const day = d.getUTCDay() || 7;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

type Customer = {
  id: string;
  name: string;
  status: string;
  member_count: number;
  source_count: number;
};

type OutcomeAggregate = {
  hours_saved: number;
  agent_runs: number;
  source_growth: number;
};

// Stub-App-Inventar — bis der App-Builder steht (siehe
// project_haiway_internal_app_marketplace memory).
const APP_INVENTORY = [
  {
    id: "pilot-brief",
    name: "Pilot-Status-Brief",
    description: "Wöchentlicher Outcome-Bericht je Pilotkunde, automatisch generiert.",
    kind: "no-code" as const,
    status: "läuft",
  },
  {
    id: "kaufen-bauen",
    name: "Kaufen-vs-bauen",
    description: "Vergleicht externe SaaS-Optionen gegen interne Eigenbauten — pro Bedarf.",
    kind: "no-code" as const,
    status: "in Aufbau",
  },
  {
    id: "crm-sync",
    name: "CRM-Sync (HubSpot)",
    description: "TypeScript-App: spiegelt HubSpot-Kontakte in unser Datenlayer.",
    kind: "typescript" as const,
    status: "extern · HubSpot · evaluieren",
  },
];

/**
 * HAIway-internes Mission Control — App-Marketplace + eigener Workspace.
 *
 * Drei Hauptelemente:
 *  1. **Eigener Workspace** (Hero-Frage) — wir arbeiten selbst agentisch,
 *     statt manuell. Eigene Chat-History.
 *  2. **App-Inventar** — interne Apps anlegen, starten, Telemetrie sehen.
 *     Apps sind entweder No-Code (Pre-Prompt + Datenquellen) oder
 *     TypeScript-Komponenten im Repo.
 *  3. **Operating Picture** — Pilotkunden + Outcome auf einen Blick.
 *
 * Hintergrund: project_haiway_internal_app_marketplace, project_internal_roles.
 */
export async function HaiwayMission() {
  const user = await getUser();
  let firstName = "";
  if (user) {
    const db = await createUserClient();
    const { data } = await db.from("profiles").select("full_name").eq("id", user.id).single();
    const cleaned = (data?.full_name ?? "").replace(/^\[[^\]]+\]\s*/, "").trim();
    firstName = cleaned.split(/\s+/)[0] ?? "";
  }

  const [conversations, customers, outcome, appTelemetry, sales] = await Promise.all([
    listMyConversations(3).catch(() => []),
    listCustomers().catch(() => [] as Customer[]),
    aggregateOutcome().catch(() => ({ hours_saved: 0, agent_runs: 0, source_growth: 0 })),
    loadAppTelemetry().catch(() => ({ topApps: [] as TopApp[], totalLaunches: 0 })),
    loadSalesSnapshot().catch(() => null),
  ]);

  const launchCounts = new Map(appTelemetry.topApps.map((t) => [t.app_id, t.count] as const));

  const lastChat = conversations[0];

  return (
    <div className="px-4 md:px-8 py-8 md:py-12 max-w-5xl mx-auto flex flex-col gap-12">
      {/* ── Eigener Workspace ── */}
      <section className="flex flex-col items-center gap-5 md:gap-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-placeholder)" }}>
            Mein Workspace
          </span>
          <h1
            className="text-2xl md:text-4xl font-bold leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
          >
            {firstName ? `Was bauen wir heute, ${firstName}?` : "Was bauen wir heute?"}
          </h1>
        </div>
        <HeroAsk placeholder={'Frag direkt — z. B. „Status aller Pilotkunden in 5 Bullets"'} />
        {lastChat && (
          <Link
            href={`/chat/${lastChat.id}`}
            className="text-[12px] font-medium"
            style={{ color: "var(--color-accent)" }}
          >
            Letzter Chat: {lastChat.title || "Konversation"} →
          </Link>
        )}
      </section>

      {/* ── Apps ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex flex-col">
            <h2 className="text-[13px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
              Apps
            </h2>
            <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
              Internes Inventar · GitHub-artige Repo-Struktur (Download / Launch / Web)
            </span>
          </div>
          <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
            {appTelemetry.totalLaunches > 0 ? `${appTelemetry.totalLaunches} Launches · 30 Tage` : "noch keine Launches"}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {APP_INVENTORY.map((app) => (
            <AppCard key={app.id} app={app} launches={launchCounts.get(app.id) ?? 0} />
          ))}
          <NewAppCard
            label="+ Repo anlegen"
            hint="Neue interne App im GitHub-Inventar registrieren"
            href="/haiway/apps/new"
          />
        </div>
      </section>

      {/* ── Eigener Vertrieb ── */}
      {sales && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex flex-col">
              <h2 className="text-[13px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
                Unser Vertrieb
              </h2>
              <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                Eigene Pipeline · ICP-Fokus auf Commerce / HLS / Bauwesen
              </span>
            </div>
            <Link
              href="/admin/vertriebssteuerung"
              className="text-[12px] font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              Cockpit öffnen →
            </Link>
          </div>
          {!sales.connected ? (
            <div
              className="rounded-2xl p-5 text-center text-[13px]"
              style={{ background: "var(--color-panel)", border: "1px dashed var(--color-line)", color: "var(--color-muted)" }}
            >
              Pipedrive nicht verbunden. <Link href="/admin/integrationen" style={{ color: "var(--color-accent)" }}>Jetzt verbinden →</Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <SalesTile
                label="Pipeline-Fokus"
                value={`${sales.focusQuote} %`}
                sub={`${formatMoney(sales.targetWeighted)} in Zielbranche`}
              />
              <SalesTile
                label="Aktivitäten Woche"
                value={String(sales.activitiesThisWeek)}
                sub={sales.activitiesLastWeek === 0
                  ? "Erste Vergleichswoche"
                  : `${sales.activitiesThisWeek >= sales.activitiesLastWeek ? "+" : ""}${Math.round(((sales.activitiesThisWeek - sales.activitiesLastWeek) / Math.max(1, sales.activitiesLastWeek)) * 100)}% vs. Vorwoche`}
                tone={sales.activitiesThisWeek < sales.activitiesLastWeek ? "warn" : "default"}
              />
              <SalesTile
                label="Stale Deals (ICP)"
                value={String(sales.staleDealCount)}
                tone={sales.staleDealCount > 0 ? "warn" : "default"}
              />
              <SalesTile
                label="Off-ICP Volumen"
                value={formatMoney(sales.offTargetWeighted)}
                tone={sales.offTargetWeighted > sales.targetWeighted ? "warn" : "default"}
              />
            </div>
          )}
        </section>
      )}

      {/* ── Operating Picture ── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
              Pilotkunden
            </h2>
            <Link
              href="/admin/kunden"
              className="text-[12px] font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              Alle verwalten →
            </Link>
          </div>
          {customers.length === 0 ? (
            <div
              className="rounded-2xl p-5 text-center text-[13px]"
              style={{ background: "var(--color-panel)", border: "1px dashed var(--color-line)", color: "var(--color-muted)" }}
            >
              Noch kein Pilotkunde — Onboarding via Kundenliste.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {customers.slice(0, 3).map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
                >
                  <StatusDot status={c.status} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--color-text)" }}>
                      {c.name}
                    </span>
                    <span className="block text-[11px]" style={{ color: "var(--color-muted)" }}>
                      {c.member_count} Nutzer · {c.source_count} Quellen
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside>
          <h2 className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-placeholder)" }}>
            Outcome (30 Tage)
          </h2>
          <div
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
          >
            <OutcomeStat label="Zeitersparnis" value={outcome.hours_saved > 0 ? `${outcome.hours_saved} h` : "—"} tone="success" />
            <OutcomeStat label="Agent-Runs" value={String(outcome.agent_runs)} />
            <OutcomeStat label="Quellen-Wachstum" value={`+${outcome.source_growth}`} />
          </div>
        </aside>
      </section>
    </div>
  );
}

async function listCustomers(): Promise<Customer[]> {
  const db = await createUserClient();
  const { data: orgs } = await db
    .from("organizations")
    .select("id, name, status, is_platform")
    .eq("is_platform", false)
    .order("created_at", { ascending: false });

  if (!orgs || orgs.length === 0) return [];

  const ids = orgs.map((o) => o.id as string);
  const [{ data: memberRows }, { data: sourceRows }] = await Promise.all([
    db.from("organization_members").select("organization_id").in("organization_id", ids),
    db.from("sources").select("organization_id").in("organization_id", ids).is("deleted_at", null),
  ]);

  const memberCount = new Map<string, number>();
  for (const m of memberRows ?? []) {
    const k = (m as { organization_id: string }).organization_id;
    memberCount.set(k, (memberCount.get(k) ?? 0) + 1);
  }
  const sourceCount = new Map<string, number>();
  for (const s of sourceRows ?? []) {
    const k = (s as { organization_id: string }).organization_id;
    sourceCount.set(k, (sourceCount.get(k) ?? 0) + 1);
  }

  return orgs.map((o) => ({
    id: o.id as string,
    name: ((o as { name: string }).name ?? "").replace(/^\[[^\]]+\]\s*/, "").trim(),
    status: (o as { status: string }).status ?? "active",
    member_count: memberCount.get(o.id as string) ?? 0,
    source_count: sourceCount.get(o.id as string) ?? 0,
  }));
}

async function aggregateOutcome(): Promise<OutcomeAggregate> {
  const db = await createUserClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: timeRows } = await db
    .from("kpi_events")
    .select("value")
    .eq("event_type", "time_saved_seconds")
    .gte("occurred_at", since);
  const totalSeconds = (timeRows ?? []).reduce((a, r) => a + (Number((r as { value: number }).value) || 0), 0);

  const { count: agentRuns } = await db
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("role", "assistant")
    .gte("created_at", since);

  const { count: sourceGrowth } = await db
    .from("sources")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  return {
    hours_saved: Math.round(totalSeconds / 3600),
    agent_runs: agentRuns ?? 0,
    source_growth: sourceGrowth ?? 0,
  };
}

function AppCard({ app, launches }: { app: typeof APP_INVENTORY[number]; launches: number }) {
  const kindLabel = app.kind === "no-code" ? "No-Code" : "TypeScript";
  const kindColor = app.kind === "no-code" ? "var(--color-accent)" : "#8b5cf6";
  return (
    <form action={launchApp} className="contents">
      <input type="hidden" name="appId" value={app.id} />
      <input type="hidden" name="appKind" value={app.kind} />
      <button
        type="submit"
        className="text-left rounded-2xl p-5 flex flex-col gap-2 transition-all hover:-translate-y-0.5 cursor-pointer"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)", minHeight: 140 }}
      >
        <div className="flex items-center justify-between">
          <span
            className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-accent) 14%, transparent)", color: kindColor }}
          >
            {kindLabel}
          </span>
          <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
            {app.status}
          </span>
        </div>
        <span className="text-[14px] font-semibold mt-1" style={{ color: "var(--color-text)" }}>
          {app.name}
        </span>
        <span className="text-[12px] leading-snug" style={{ color: "var(--color-muted)" }}>
          {app.description}
        </span>
        <span className="text-[11px] mt-auto pt-2" style={{ color: launches > 0 ? "var(--color-accent)" : "var(--color-placeholder)" }}>
          {launches > 0 ? `${launches} Launches · 30 Tage` : "Launchen →"}
        </span>
      </button>
    </form>
  );
}

type TopApp = { app_id: string; count: number };

async function loadAppTelemetry(): Promise<{ topApps: TopApp[]; totalLaunches: number }> {
  const db = await createUserClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, count } = await db
    .from("app_launch_events")
    .select("app_id", { count: "exact" })
    .gte("occurred_at", since);

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { app_id: string }[]) {
    counts.set(row.app_id, (counts.get(row.app_id) ?? 0) + 1);
  }
  const topApps = [...counts.entries()]
    .map(([app_id, count]) => ({ app_id, count }))
    .sort((a, b) => b.count - a.count);

  return { topApps, totalLaunches: count ?? 0 };
}

function NewAppCard({ label, hint, href }: { label: string; hint: string; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl p-5 flex flex-col gap-1 justify-center items-center text-center transition-all hover:-translate-y-0.5"
      style={{ background: "var(--color-panel)", border: "1px dashed var(--color-accent)", minHeight: 140 }}
    >
      <span className="text-[14px] font-semibold" style={{ color: "var(--color-accent)" }}>
        {label}
      </span>
      <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
        {hint}
      </span>
    </Link>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active" ? "var(--color-success)" : status === "paused" ? "var(--color-warning)" : "var(--color-muted)";
  return <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />;
}

function SalesTile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "warn" }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-1"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <span className="text-[11px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
        {label}
      </span>
      <span
        className="text-xl md:text-2xl font-bold"
        style={{
          fontFamily: "var(--font-display)",
          color: tone === "warn" ? "var(--color-danger)" : "var(--color-text)",
        }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>{sub}</span>
      )}
    </div>
  );
}

function OutcomeStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[11px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
        {label}
      </span>
      <span
        className="text-lg md:text-xl font-bold"
        style={{
          fontFamily: "var(--font-display)",
          color: tone === "success" ? "var(--color-success)" : "var(--color-text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
