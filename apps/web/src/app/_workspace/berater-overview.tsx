import Link from "next/link";
import { countReadySources } from "@/lib/db/queries/sources";
import { listConversations } from "@/app/chat/actions";
import { getOrganization } from "@/lib/db/queries/organization";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { getWorkflowKpi, type WorkflowKpi } from "@/lib/db/queries/workflows";

function relativeTime(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return "gestern";
  if (diffD < 7) return `vor ${diffD} Tagen`;
  return then.toLocaleDateString("de-DE");
}

/**
 * Berater-Cockpit-Übersicht.
 *
 * Outcome-First: KPI-Kacheln (Quellen / Nutzer / KPIs), Live-Events
 * (Konversationen, Sync-Logs), Schnellaktionen. Detail-Tabs lebten heute
 * noch unter ihren bisherigen Routen (`/quellen`, `/berechtigungen`,
 * `/admin/integrationen`); die Top-Tabs der Shell verlinken dort hin.
 */
export async function BeraterOverview() {
  const orgId = await requireOrgId();
  const [org, sourceCount, conversations, members, syncLogs, workflowKpi] = await Promise.all([
    getOrganization().catch(() => null),
    countReadySources().catch(() => 0),
    listConversations(8).catch(() => []),
    countActiveMembers(orgId).catch(() => 0),
    recentSyncEvents(orgId).catch(() => [] as SyncEvent[]),
    getWorkflowKpi(orgId).catch(() => null),
  ]);

  // Live-Event-Stream: jüngste Konversationen + jüngste Sync-Events sortiert.
  const events: TimelineEvent[] = [
    ...conversations.slice(0, 5).map((c) => ({
      kind: "chat" as const,
      title: c.title || "Konversation",
      at: c.last_message_at,
    })),
    ...syncLogs.slice(0, 5).map((s) => ({
      kind: "sync" as const,
      title: `${s.direction === "inbound" ? "Sync" : "Aktion"} · ${s.provider}`,
      at: s.occurred_at,
      status: s.status,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="flex flex-col gap-1 mb-6">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Berater-Cockpit
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          {org?.name?.replace(/^\[[^\]]+\]\s*/, "").trim() || "Kundenkonfiguration"}
        </h1>
      </header>

      {/* KPI-Kacheln */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <KpiCard
          label="Wissensquellen"
          value={String(sourceCount)}
          hint="freigegeben für Agenten + Chat"
          href="/quellen"
        />
        <KpiCard
          label="Aktive Nutzer"
          value={String(members)}
          hint="Mitarbeiter mit Account"
          href="/berechtigungen"
        />
        <KpiCard
          label="KPIs"
          value="Bereit"
          hint="Outcome-Tracking aktiv"
          tone="success"
          href="/admin/retrieval-qualitaet"
        />
      </section>

      {/* Reklamations-Orchestrator */}
      <section className="mt-8">
        <h2 className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-placeholder)" }}>
          Automatisierungen
        </h2>
        <OrchestratorCard kpi={workflowKpi} />
      </section>

      {/* Events + Aktionen */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-8">
        <div className="lg:col-span-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-placeholder)" }}>
            Letzte Aktivität
          </h2>
          {events.length === 0 ? (
            <div
              className="rounded-2xl p-6 text-center"
              style={{
                background: "var(--color-panel)",
                border: "1px dashed var(--color-line)",
                color: "var(--color-muted)",
              }}
            >
              Noch keine Aktivität — sobald Agenten oder Sync-Connectoren laufen, erscheint sie hier.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {events.map((e, i) => (
                <li
                  key={`${e.kind}-${i}-${e.at}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
                >
                  <EventIcon kind={e.kind} status={"status" in e ? e.status : undefined} />
                  <span className="flex-1 min-w-0 text-[14px] truncate" style={{ color: "var(--color-text)" }}>
                    {e.title}
                  </span>
                  <span className="text-[11px] shrink-0" style={{ color: "var(--color-placeholder)" }}>
                    {relativeTime(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside>
          <h2 className="text-[12px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-placeholder)" }}>
            Schnellaktionen
          </h2>
          <div className="flex flex-col gap-2">
            <ActionLink href="/sources/new" label="Quelle anbinden" hint="Datei oder Connector" />
            <ActionLink href="/berechtigungen" label="Berechtigungen pflegen" hint="Gruppen + Folder" />
            <ActionLink href="/admin/integrationen" label="Integrationen prüfen" hint="ERP, CRM, Telefon" />
            <ActionLink href="/admin/branding" label="Branding anpassen" hint="Logo + Akzentfarben" />
          </div>
        </aside>
      </section>
    </div>
  );
}

type SyncEvent = {
  provider: string;
  direction: "inbound" | "outbound";
  status: "success" | "error" | "skipped";
  occurred_at: string;
};

type TimelineEvent =
  | { kind: "chat"; title: string; at: string }
  | { kind: "sync"; title: string; at: string; status: "success" | "error" | "skipped" };

async function countActiveMembers(orgId: string): Promise<number> {
  const db = await createUserClient();
  const { count } = await db
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  return count ?? 0;
}

async function recentSyncEvents(orgId: string): Promise<SyncEvent[]> {
  const db = await createUserClient();
  const { data } = await db
    .from("connector_sync_log")
    .select("provider_id, direction, status, occurred_at")
    .eq("organization_id", orgId)
    .order("occurred_at", { ascending: false })
    .limit(8);
  return (data ?? []).map((row) => ({
    provider: (row as { provider_id: string }).provider_id,
    direction: (row as { direction: "inbound" | "outbound" }).direction,
    status: (row as { status: "success" | "error" | "skipped" }).status,
    occurred_at: (row as { occurred_at: string }).occurred_at,
  }));
}

function OrchestratorCard({ kpi }: { kpi: WorkflowKpi | null }) {
  const k = kpi ?? { total: 0, success: 0, failed: 0, running: 0, last_run_at: null, avg_duration_ms: null };
  const rate = k.total > 0 ? Math.round((k.success / k.total) * 100) : null;
  const handlungsbedarf = k.failed > 0;
  return (
    <Link
      href="/admin/automatisierungen"
      className="block rounded-2xl p-5 transition-all hover:-translate-y-0.5"
      style={{
        background: "var(--color-panel)",
        border: handlungsbedarf ? "1px solid var(--color-danger)" : "1px solid var(--color-line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[15px] font-semibold truncate" style={{ color: "var(--color-text)" }}>
            Reklamations-Orchestrator
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
            style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}
          >
            Aktiv
          </span>
        </div>
        <span className="text-[16px] shrink-0" style={{ color: "var(--color-accent)" }}>→</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <OrchestratorStat label="Tickets" value={String(k.total)} />
        <OrchestratorStat label="Erfolgsquote" value={rate == null ? "—" : `${rate}%`} tone="success" />
        <OrchestratorStat label="Fehler" value={String(k.failed)} tone={handlungsbedarf ? "danger" : "default"} />
      </div>

      {handlungsbedarf ? (
        <p className="text-[12px] mt-3 font-medium" style={{ color: "var(--color-danger)" }}>
          ⚠ Handlungsbedarf: {k.failed} {k.failed === 1 ? "Ticket" : "Tickets"} fehlgeschlagen — bitte prüfen.
        </p>
      ) : (
        <p className="text-[12px] mt-3" style={{ color: "var(--color-muted)" }}>
          Shopware → Trello · {k.last_run_at ? `letzter Lauf ${relativeTime(k.last_run_at)}` : "noch kein Lauf"}
        </p>
      )}
    </Link>
  );
}

function OrchestratorStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "danger" }) {
  const color =
    tone === "success" ? "var(--color-success)" :
    tone === "danger"  ? "var(--color-danger)"  :
                         "var(--color-text)";
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--color-bg)" }}>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>{label}</span>
      <p className="text-xl font-bold mt-0.5" style={{ fontFamily: "var(--font-display)", color }}>{value}</p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "default" | "success";
}) {
  const inner = (
    <div
      className="rounded-2xl p-5 flex flex-col gap-1 transition-all hover:-translate-y-0.5"
      style={{
        background: "var(--color-panel)",
        border: "1px solid var(--color-line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <span className="text-[11px] font-medium uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
        {label}
      </span>
      <span
        className="text-2xl md:text-3xl font-bold mt-1 leading-tight"
        style={{
          fontFamily: "var(--font-display)",
          color: tone === "success" ? "var(--color-success)" : "var(--color-text)",
        }}
      >
        {value}
      </span>
      {hint && <span className="text-[12px]" style={{ color: "var(--color-muted)" }}>{hint}</span>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ActionLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-all hover:shadow-sm"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <span className="flex flex-col">
        <span className="text-[14px] font-semibold" style={{ color: "var(--color-text)" }}>{label}</span>
        <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>{hint}</span>
      </span>
      <span className="text-[16px]" style={{ color: "var(--color-accent)" }}>→</span>
    </Link>
  );
}

function EventIcon({ kind, status }: { kind: TimelineEvent["kind"]; status?: SyncEvent["status"] }) {
  const color =
    kind === "chat"
      ? "var(--color-accent)"
      : status === "error"
      ? "var(--color-warning)"
      : status === "skipped"
      ? "var(--color-muted)"
      : "var(--color-success)";
  return (
    <span
      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: "var(--color-bg-elevated)", color }}
    >
      {kind === "chat" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
      )}
    </span>
  );
}
