import { createServiceClient, createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { connectSharepoint, connectGdrive, triggerInitialSync } from "@/app/quellen/actions";
import { replayJobFailureAction } from "./actions";
import {
  metaFor,
  connectKindLabel,
  VIRTUAL_PROVIDERS,
  type ProviderMeta,
} from "./provider-meta";

export const dynamic = "force-dynamic";

interface RunRow {
  id:              string;
  organization_id: string;
  provider_id:     string;
  status:          string;
  trigger:         string;
  started_at:      string;
  finished_at:     string | null;
  duration_ms:     number | null;
  records_in:      number;
  records_ok:      number;
  records_failed:  number;
  error_message:   string | null;
}

interface FailureRow {
  id:              string;
  organization_id: string;
  provider_id:     string | null;
  queue_name:      string;
  error_message:   string;
  attempt_count:   number;
  failed_at:       string;
  replayed_at:     string | null;
}

interface KpiRow {
  organization_id:      string;
  provider_id:          string;
  day:                  string;
  run_count:            number;
  success_count:        number;
  failed_count:         number;
  records_in_total:     number;
  records_ok_total:     number;
  records_failed_total: number;
  avg_duration_ms:      number;
}

interface ConnectionRow {
  provider_id: string;
  status:      string;
  updated_at:  string | null;
}

interface ProviderRow {
  id:        string;
  name:      string;
  category:  string;
  auth_type: string;
  is_active: boolean;
}

export default async function IntegrationsAdminPage() {
  const orgId = await requireOrgId();
  const supabase = createServiceClient();
  const userClient = await createUserClient();

  const [{ data: runs }, { data: failures }, { data: kpis }, { data: connections }, { data: providers }] = await Promise.all([
    supabase
      .from("integration_runs")
      .select("*")
      .eq("organization_id", orgId)
      .order("started_at", { ascending: false })
      .limit(50),
    supabase
      .from("job_failures")
      .select("*")
      .eq("organization_id", orgId)
      .is("replayed_at", null)
      .order("failed_at", { ascending: false })
      .limit(50),
    supabase
      .from("integration_kpi_daily")
      .select("*")
      .eq("organization_id", orgId)
      .order("day", { ascending: false })
      .limit(14),
    userClient
      .from("organization_integrations")
      .select("provider_id, status, updated_at")
      .eq("organization_id", orgId),
    supabase
      .from("integration_providers")
      .select("id, name, category, auth_type, is_active")
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("name",     { ascending: true }),
  ]);

  const runRows:        RunRow[]        = (runs        ?? []) as RunRow[];
  const failureRows:    FailureRow[]    = (failures    ?? []) as FailureRow[];
  const kpiRows:        KpiRow[]        = (kpis        ?? []) as KpiRow[];
  const connectionRows: ConnectionRow[] = (connections ?? []) as ConnectionRow[];
  const providerRows:   ProviderRow[]   = (providers   ?? []) as ProviderRow[];

  const totals = kpiRows.reduce(
    (acc, k) => ({
      runs:    acc.runs    + k.run_count,
      success: acc.success + k.success_count,
      failed:  acc.failed  + k.failed_count,
      records: acc.records + k.records_ok_total,
    }),
    { runs: 0, success: 0, failed: 0, records: 0 },
  );

  const connectionByProvider = new Map(connectionRows.map((c) => [c.provider_id, c] as const));

  // Server actions cannot live inside a serializable map, so resolve the
  // server-action name from provider-meta into a real reference here.
  const actionLookup = { connectSharepoint, connectGdrive } as const;

  type ConnectorCardInput = {
    providerId: string;
    name:       string;
    meta:       ProviderMeta;
    connection: ConnectionRow | null;
  };

  const cards: ConnectorCardInput[] = [
    ...providerRows.map((p) => ({
      providerId: p.id,
      name:       p.name,
      meta:       metaFor(p.id),
      connection: connectionByProvider.get(p.id) ?? null,
    })),
    ...VIRTUAL_PROVIDERS.map((v) => ({
      providerId: v.id,
      name:       v.name,
      meta:       v.meta,
      connection: connectionByProvider.get(v.statusFrom) ?? null,
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Integrationen
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Datenquellen verbinden + Sync-Status
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Verknüpfe externe Tools mit deiner Org. Provider werden aus der Plattform-Registry geladen — Sync-Logs und Fehler stehen darunter.
        </p>
      </header>

      {/* Connect-Cards */}
      <section>
        <h2 className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-placeholder)" }}>
          Datenquellen anbinden
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {cards.map((c) => (
            <ConnectorCard
              key={c.providerId}
              providerId={c.providerId}
              name={c.name}
              meta={c.meta}
              connection={c.connection}
              connectAction={c.meta.serverAction ? actionLookup[c.meta.serverAction] : undefined}
            />
          ))}
        </div>
      </section>

      {/* KPI Cards */}
      <section>
        <h2 className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-placeholder)" }}>
          Pipeline-Status (14 Tage)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <StatCard label="Läufe"          value={totals.runs} />
          <StatCard label="Erfolgreich"    value={totals.success} />
          <StatCard label="Fehlgeschlagen" value={totals.failed} tone="warn" />
          <StatCard label="Records ok"     value={totals.records} />
        </div>
      </section>

      {/* Recent runs */}
      <Panel title="Letzte Sync-Läufe">
        {runRows.length === 0 ? (
          <Empty text="Noch keine Sync-Läufe — verbinde oben eine Datenquelle und starte den ersten Sync." />
        ) : (
          <ul className="flex flex-col gap-2">
            {runRows.slice(0, 12).map((r) => (
              <li
                key={r.id}
                className="rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4 min-h-[44px]"
                style={{ background: "var(--color-bg)" }}
              >
                <StatusPill status={r.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                    {r.provider_id}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {new Date(r.started_at).toLocaleString("de-DE")} · {r.trigger}
                  </div>
                </div>
                <div className="text-xs flex gap-3" style={{ color: "var(--color-muted)" }}>
                  <span>{r.records_ok}/{r.records_in} ok</span>
                  {r.records_failed > 0 && <span>{r.records_failed} Fehler</span>}
                  {r.duration_ms !== null && <span>{r.duration_ms} ms</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Dead letters */}
      <Panel title="Fehlgeschlagene Jobs (DLQ)">
        {failureRows.length === 0 ? (
          <Empty text="Keine offenen Fehler." />
        ) : (
          <ul className="flex flex-col gap-2">
            {failureRows.map((f) => (
              <li
                key={f.id}
                className="rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4"
                style={{ background: "var(--color-bg)" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {f.provider_id ?? "—"} · {f.queue_name}
                  </div>
                  <div
                    className="text-xs truncate"
                    style={{ color: "var(--color-muted)" }}
                    title={f.error_message}
                  >
                    {f.error_message}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {new Date(f.failed_at).toLocaleString("de-DE")} · Versuch {f.attempt_count}
                  </div>
                </div>
                <form action={replayJobFailureAction}>
                  <input type="hidden" name="failure_id" value={f.id} />
                  <button
                    type="submit"
                    className="min-h-[44px] min-w-[44px] px-4 rounded-lg text-sm font-medium"
                    style={{
                      background: "var(--color-accent-soft)",
                      color:      "var(--color-accent)",
                    }}
                  >
                    Erneut ausführen
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function ConnectorCard({
  providerId,
  name,
  meta,
  connection,
  connectAction,
}: {
  providerId:    string;
  name:          string;
  meta:          ProviderMeta;
  connection:    ConnectionRow | null;
  connectAction: (() => Promise<void>) | undefined;
}) {
  const isConnected = connection?.status === "connected" || connection?.status === "active";
  const isAvailable = meta.connectKind !== "coming-soon" && !!connectAction;
  const syncProviderId =
    meta.syncProviderId === "sharepoint" || meta.syncProviderId === "google_drive"
      ? meta.syncProviderId
      : null;
  const syncAction = syncProviderId ? triggerInitialSync.bind(null, syncProviderId) : null;

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[15px] font-semibold" style={{ color: "var(--color-text)" }}>
            {name}
          </span>
          <span className="text-[12px] leading-snug" style={{ color: "var(--color-muted)" }}>
            {meta.description}
          </span>
        </div>
        <span
          className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-[12px] font-bold"
          style={{ background: `${meta.color}18`, color: meta.color }}
          aria-hidden
        >
          {name.slice(0, 2).toUpperCase()}
        </span>
      </div>

      <span
        className="self-start text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full"
        style={{ background: "var(--color-bg-elevated)", color: "var(--color-muted)" }}
      >
        {connectKindLabel(meta.connectKind)}
      </span>

      {meta.note && (
        <span className="text-[11px]" style={{ color: "var(--color-placeholder)" }}>
          {meta.note}
        </span>
      )}

      <div className="flex items-center justify-between gap-3 mt-auto pt-2 border-t" style={{ borderColor: "var(--color-line-soft)" }}>
        <span className="text-[11px]" style={{ color: isConnected ? "var(--color-success)" : "var(--color-placeholder)" }}>
          {isConnected
            ? `Verbunden${connection?.updated_at ? " · " + new Date(connection.updated_at).toLocaleDateString("de-DE") : ""}`
            : isAvailable
              ? "Nicht verbunden"
              : "Setup folgt"}
        </span>
        <div className="flex items-center gap-1.5">
          {isConnected && syncAction && (
            <form action={syncAction}>
              <button
                type="submit"
                className="min-h-[36px] px-3 rounded-lg text-[12px] font-semibold"
                style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
              >
                Jetzt synchronisieren
              </button>
            </form>
          )}
          {isAvailable && connectAction ? (
            <form action={connectAction}>
              <button
                type="submit"
                className="min-h-[36px] px-3 rounded-lg text-[12px] font-semibold"
                style={{
                  background: isConnected ? "var(--color-bg-elevated)" : "var(--color-accent)",
                  color:      isConnected ? "var(--color-text)"        : "var(--color-accent-text)",
                  border:     isConnected ? "1px solid var(--color-line)" : "none",
                }}
              >
                {isConnected ? "Neu verbinden" : `${name} verbinden`}
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled
              title="Auth-Adapter folgt in einem nächsten PR"
              className="min-h-[36px] px-3 rounded-lg text-[12px] font-semibold cursor-not-allowed"
              style={{
                background: "var(--color-bg-elevated)",
                color:      "var(--color-placeholder)",
                border:     "1px dashed var(--color-line)",
              }}
            >
              Bald verfügbar
            </button>
          )}
        </div>
      </div>
      <span hidden data-provider-id={providerId} />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <h2
        className="text-base font-semibold mb-4"
        style={{ color: "var(--color-text)" }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
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
          color: tone === "warn" && value > 0 ? "var(--color-danger)" : "var(--color-text)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "success" ? "var(--color-accent)"  :
    status === "partial" ? "var(--color-warning)" :
    status === "failed"  ? "var(--color-danger)"  :
                           "var(--color-muted)";
  const bg =
    status === "success" ? "var(--color-accent-soft)" :
                           "var(--color-bg-elevated)";
  return (
    <span
      className="text-xs px-2 py-1 rounded-full font-medium"
      style={{ background: bg, color: tone }}
    >
      {status}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="text-sm" style={{ color: "var(--color-muted)" }}>{text}</p>
  );
}
