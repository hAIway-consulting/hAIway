import Link from "next/link";
import { countReadySources } from "@/lib/db/queries/sources";
import { listConversations } from "@/app/chat/actions";
import { getOrganization } from "@/lib/db/queries/organization";
import { createUserClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";

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
 * Outcome-First: KPI-Kacheln (Quellen / Nutzer), Live-Events
 * (Konversationen), Schnellaktionen. Detail-Tabs lebten heute
 * noch unter ihren bisherigen Routen (`/quellen`, `/berechtigungen`,
 * `/admin/integrationen`); die Top-Tabs der Shell verlinken dort hin.
 */
export async function BeraterOverview() {
  const orgId = await requireOrgId();
  const [org, sourceCount, conversations, members] = await Promise.all([
    getOrganization().catch(() => null),
    countReadySources().catch(() => 0),
    listConversations(8).catch(() => []),
    countActiveMembers(orgId).catch(() => 0),
  ]);

  // Live-Event-Stream: jüngste Konversationen.
  const events: TimelineEvent[] = conversations
    .slice(0, 5)
    .map((c) => ({
      kind: "chat" as const,
      title: c.title || "Konversation",
      at: c.last_message_at,
    }))
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
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
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
              Noch keine Aktivität — sobald im Cockpit gearbeitet wird, erscheint sie hier.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {events.map((e, i) => (
                <li
                  key={`${e.kind}-${i}-${e.at}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
                >
                  <EventIcon />
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
          </div>
        </aside>
      </section>
    </div>
  );
}

type TimelineEvent = { kind: "chat"; title: string; at: string };

async function countActiveMembers(orgId: string): Promise<number> {
  const db = await createUserClient();
  const { count } = await db
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  return count ?? 0;
}

function KpiCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
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
          color: "var(--color-text)",
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

function EventIcon() {
  return (
    <span
      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: "var(--color-bg-elevated)", color: "var(--color-accent)" }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
      </svg>
    </span>
  );
}
