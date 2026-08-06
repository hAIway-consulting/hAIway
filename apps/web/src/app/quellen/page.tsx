import { redirect } from "next/navigation";
import { createUserClient, getUser } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { card, btn, page, styles } from "@/components/ui/table-classes";
import { connectSharepoint, connectGdrive } from "./actions";
import { AutoRefreshWhileSyncing } from "./auto-refresh";
import {
  RetryButton,
  ReindexButton,
  DeleteButton,
  ReconcileButton,
  SyncButton,
} from "./retry-button";

export const dynamic = "force-dynamic";

type Integration = {
  provider_id: string;
  status: string;
  last_synced_at: string | null;
  error_message: string | null;
  config: Record<string, unknown> | null;
};

type SourceRow = {
  id: string;
  title: string;
  connector_type: string;
  sync_status: string;
  last_synced_at: string | null;
  source_url: string | null;
};

type Stats = {
  total: number;
  indexed: number;
  processing: number;
  pending: number;
  failed: number;
};

type FileState = "indexed" | "processing" | "pending" | "failed";

const PROVIDER_LABEL: Record<string, string> = {
  sharepoint: "Microsoft SharePoint",
  google_drive: "Google Drive",
};

const INDEXED = new Set(["ready", "indexed", "done", "completed", "synced", "success"]);
const PROCESSING = new Set(["processing", "embedding", "running", "syncing"]);
const PENDING = new Set(["pending", "queued", "new", "waiting"]);
const FAILED = new Set(["error", "failed"]);

function classify(status: string): FileState {
  const s = (status || "").toLowerCase();
  if (INDEXED.has(s)) return "indexed";
  if (PROCESSING.has(s)) return "processing";
  if (FAILED.has(s)) return "failed";
  if (PENDING.has(s)) return "pending";
  return "pending";
}

function aggregate(rows: SourceRow[]): Stats {
  const stats: Stats = { total: 0, indexed: 0, processing: 0, pending: 0, failed: 0 };
  for (const r of rows) {
    stats.total++;
    stats[classify(r.sync_status)]++;
  }
  return stats;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "noch nie synchronisiert";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "Sync gerade eben";
  if (min < 60) return `Sync vor ${min} Min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Sync vor ${h} Std`;
  const d = Math.round(h / 24);
  return `Sync vor ${d} Tagen`;
}

// Cron runs every 5 min. Anything older than 15 min (3 intervals) with no
// in-flight work means the scheduler is lagging or the last run crashed.
// 30 Min — passt zur gedrosselten Cron-Frequenz seit IO-Vorfall 05/2026
// (siehe feedback_pipeline_architecture). 15 Min war für die alte alle-5-Min-
// Cron-Konfiguration eng kalibriert und schlägt seitdem dauernd Fehlalarm.
const SYNC_STALE_MS = 30 * 60 * 1000;
function isSyncStale(iso: string | null): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > SYNC_STALE_MS;
}

function fileStateLabel(state: FileState): string {
  switch (state) {
    case "indexed":
      return "indexiert";
    case "processing":
      return "verarbeitet…";
    case "pending":
      return "wartet";
    case "failed":
      return "Fehler";
  }
}

function fileStateColor(state: FileState): string {
  switch (state) {
    case "indexed":
      return "var(--color-success)";
    case "processing":
      return "var(--color-accent)";
    case "pending":
      return "var(--color-muted)";
    case "failed":
      return "var(--color-danger)";
  }
}

export default async function QuellenPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login");

  const orgId = await requireOrgId();
  const db = await createUserClient();

  const { data: integrationsRaw } = await db
    .from("organization_integrations")
    .select("provider_id, status, last_synced_at, error_message, config")
    .eq("organization_id", orgId)
    .in("provider_id", ["sharepoint", "google_drive"]);
  const integrations = (integrationsRaw ?? []) as Integration[];

  const { data: sourcesRaw } = await db
    .from("sources")
    .select("id, title, connector_type, sync_status, last_synced_at, source_url")
    .eq("organization_id", orgId)
    .in("connector_type", ["sharepoint", "gdrive"])
    .is("deleted_at", null)
    .order("last_synced_at", { ascending: false })
    .limit(500);
  const sources = (sourcesRaw ?? []) as SourceRow[];

  const byProvider: Record<string, SourceRow[]> = { sharepoint: [], gdrive: [] };
  for (const s of sources) {
    const key = s.connector_type === "sharepoint" ? "sharepoint" : "gdrive";
    byProvider[key].push(s);
  }

  const sharepointInteg = integrations.find((i) => i.provider_id === "sharepoint");
  const gdriveInteg = integrations.find((i) => i.provider_id === "google_drive");

  const sharepointStats = aggregate(byProvider.sharepoint);
  const gdriveStats = aggregate(byProvider.gdrive);

  const anySyncing =
    sharepointStats.processing + sharepointStats.pending > 0 ||
    gdriveStats.processing + gdriveStats.pending > 0;

  return (
    <div className={page.wrapper}>
      <AutoRefreshWhileSyncing active={anySyncing} />
      <div className={page.header}>
        <h1
          className="text-xl md:text-2xl font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
        >
          Quellen
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Verbinde SharePoint oder Drive — danach laeuft Delta-Sync alle 5 Minuten
          automatisch. Aenderungen in der Quelle landen ohne Re-Upload im Chat.
        </p>
      </div>

      {sp?.error && (
        <div
          className="rounded-[var(--radius-card)] p-3 text-sm"
          style={{ background: "var(--color-danger-soft, #fee)", color: "var(--color-danger, #c00)" }}
        >
          Fehler: {sp.error}
        </div>
      )}
      {sp?.connected && (
        <div
          className="rounded-[var(--radius-card)] p-3 text-sm"
          style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
        >
          Verbunden: {sp.connected}
        </div>
      )}

      <ConnectorCard
        providerId="sharepoint"
        integration={sharepointInteg}
        files={byProvider.sharepoint}
        stats={sharepointStats}
        connectAction={connectSharepoint}
      />
      <ConnectorCard
        providerId="google_drive"
        integration={gdriveInteg}
        files={byProvider.gdrive}
        stats={gdriveStats}
        connectAction={connectGdrive}
      />
    </div>
  );
}

function ConnectorCard(props: {
  providerId: "sharepoint" | "google_drive";
  integration?: Integration;
  files: SourceRow[];
  stats: Stats;
  connectAction: () => Promise<void>;
}) {
  const { providerId, integration, files, stats } = props;
  const isActive = integration?.status === "active";
  const isErrored = integration?.status === "error";
  // Sync-side errors (e.g. SharePoint Online license missing, Drive 403) leave
  // status='active' because the OAuth refresh itself worked, but the run still
  // failed. error_message captures the reason — surface it as a warning.
  const hasRunError = isActive && Boolean(integration?.error_message);
  const inFlight = stats.processing + stats.pending;
  const isSyncing = isActive && inFlight > 0;

  const lastSyncedAt = integration?.last_synced_at ?? null;
  const isStale = isActive && !isSyncing && !hasRunError && isSyncStale(lastSyncedAt);

  type Health = { kind: "ok" | "sync" | "warn" | "idle"; label: string };
  let health: Health;
  if (isErrored) {
    health = { kind: "warn", label: "Token-Refresh fehlgeschlagen" };
  } else if (!isActive) {
    health = { kind: "warn", label: integration ? "Token abgelaufen" : "nicht verbunden" };
  } else if (hasRunError) {
    health = { kind: "warn", label: "Sync-Lauf gescheitert" };
  } else if (isSyncing) {
    health = { kind: "sync", label: `Sync läuft… ${stats.indexed} / ${stats.total}` };
  } else if (stats.failed > 0) {
    health = { kind: "warn", label: `${stats.failed} Fehler` };
  } else if (isStale) {
    health = {
      kind: "warn",
      label: lastSyncedAt
        ? `Sync hängt · ${relativeTime(lastSyncedAt)}`
        : "noch nie synchronisiert",
    };
  } else {
    health = { kind: "ok", label: relativeTime(lastSyncedAt) };
  }

  const healthDotColor =
    health.kind === "ok"
      ? "var(--color-success)"
      : health.kind === "sync"
        ? "var(--color-accent)"
        : health.kind === "warn"
          ? "var(--color-warning)"
          : "var(--color-muted)";

  const subtitle = isSyncing
    ? `${stats.indexed} / ${stats.total} verarbeitet`
    : stats.total > 0
      ? `${stats.indexed} Dateien indexiert${stats.failed > 0 ? ` · ${stats.failed} Fehler` : ""}`
      : "Noch keine Dateien indexiert";

  const progressPct = stats.total > 0 ? Math.round((stats.indexed / stats.total) * 100) : 0;

  return (
    <div className={card.flat} style={styles.panel}>
      {isErrored && (
        <div
          className="rounded-[var(--radius-md)] p-3 text-sm mb-4 flex items-start gap-2"
          style={{ background: "var(--color-danger-soft, #fee)", color: "var(--color-danger, #c00)" }}
        >
          <span aria-hidden>⚠️</span>
          <div className="min-w-0">
            <p className="font-medium">Token-Refresh fehlgeschlagen.</p>
            <p className="mt-1 break-words">
              {integration?.error_message ??
                "Der gespeicherte Refresh-Token wurde von der Gegenstelle abgelehnt."}
            </p>
            <p className="mt-1">
              Klicke <strong>Erneut verbinden</strong> und durchlaufe den
              OAuth-Flow neu — danach läuft der Sync wieder.
            </p>
          </div>
        </div>
      )}
      {!isErrored && hasRunError && (
        <div
          className="rounded-[var(--radius-md)] p-3 text-sm mb-4 flex items-start gap-2"
          style={{ background: "var(--color-warning-soft, #fff7e6)", color: "var(--color-warning, #9a6a00)" }}
        >
          <span aria-hidden>⚠️</span>
          <div className="min-w-0">
            <p className="font-medium">Letzter Sync-Lauf ist gescheitert.</p>
            <p className="mt-1 break-words">{integration?.error_message}</p>
          </div>
        </div>
      )}
      {!isErrored && !hasRunError && isStale && (
        <div
          className="rounded-[var(--radius-md)] p-3 text-sm mb-4 flex items-start gap-2"
          style={{ background: "var(--color-warning-soft, #fff7e6)", color: "var(--color-warning, #9a6a00)" }}
        >
          <span aria-hidden>⚠️</span>
          <span>
            Der automatische Delta-Sync (alle 5 Minuten) scheint zu hängen.
            Klicke auf <strong>Jetzt synchronisieren</strong> oder prüfe die
            Läufe unter <em>Admin → Integrationen</em>.
          </span>
        </div>
      )}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--color-text)", fontFamily: "var(--font-display)" }}
          >
            {PROVIDER_LABEL[providerId]}
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
            {subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-2 text-xs px-3 min-h-[32px] rounded-[var(--radius-full)]"
            style={{ background: "var(--color-bg-elevated)", color: "var(--color-muted)" }}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${health.kind === "sync" ? "animate-pulse" : ""}`}
              style={{ background: healthDotColor }}
            />
            {health.label}
          </span>
          {!isActive ? (
            <form action={props.connectAction}>
              <button type="submit" className={btn.primary} style={styles.accent}>
                {integration ? "Erneut verbinden" : "Verbinden"}
              </button>
            </form>
          ) : (
            <>
              <SyncButton providerId={providerId} />
              {/* Aufräumen nur für Google Drive: connector-sharepoint kennt keine
                  'reconcile'-Aktion (siehe actions.ts, reconcileConnector). */}
              {providerId === "google_drive" && <ReconcileButton providerId={providerId} />}
            </>
          )}
        </div>
      </div>

      {isSyncing && (
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex-1 h-2 rounded-[var(--radius-full)] overflow-hidden"
            style={{ background: "var(--color-bg-elevated)" }}
          >
            <div
              className="h-full transition-all duration-500"
              style={{ width: `${progressPct}%`, background: "var(--color-accent)" }}
            />
          </div>
          <span
            className="text-xs tabular-nums"
            style={{ color: "var(--color-muted)", fontFamily: "var(--font-mono)" }}
          >
            {stats.indexed} / {stats.total}
          </span>
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Noch keine Dateien indexiert.
        </p>
      ) : (
        <details open={files.length <= 8} className="group">
          <summary
            className="cursor-pointer list-none flex items-center justify-between gap-2 text-xs min-h-[44px] px-1 select-none"
            style={{ color: "var(--color-muted)" }}
          >
            <span>
              {files.length} {files.length === 1 ? "Datei" : "Dateien"} ·{" "}
              {stats.indexed} indexiert
              {stats.failed > 0 ? ` · ${stats.failed} Fehler` : ""}
            </span>
            <span
              className="text-[10px] transition-transform group-open:rotate-180"
              aria-hidden
            >
              ▾
            </span>
          </summary>
          <ul className="flex flex-col gap-2 max-h-[360px] overflow-y-auto pr-1 mt-2">
            {files.map((f) => {
              const state = classify(f.sync_status);
              return (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2 min-h-[44px]"
                  style={{ background: "var(--color-bg-elevated)" }}
                >
                  <div className="min-w-0 flex items-center gap-3 flex-1">
                    <span
                      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${state === "processing" ? "animate-pulse" : ""}`}
                      style={{ background: fileStateColor(state) }}
                    />
                    <div className="min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: "var(--color-text)" }}
                      >
                        {f.title}
                      </p>
                      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                        {fileStateLabel(state)}
                        {f.last_synced_at
                          ? ` · ${new Date(f.last_synced_at).toLocaleString("de-DE")}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {f.source_url && (
                      <a
                        href={f.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline"
                        style={{ color: "var(--color-accent)" }}
                      >
                        öffnen
                      </a>
                    )}
                    {state === "failed" && <RetryButton sourceId={f.id} />}
                    {state === "indexed" && <ReindexButton sourceId={f.id} />}
                    <DeleteButton sourceId={f.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
