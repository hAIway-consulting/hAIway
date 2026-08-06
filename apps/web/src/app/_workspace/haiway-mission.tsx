import Link from "next/link";
import { createUserClient, getUser } from "@/lib/db/supabase-server";
import { listMyConversations } from "@/app/chat/actions";
import { HeroAsk } from "./hero-ask";

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

/**
 * HAIway-internes Mission Control — eigener Workspace + Operating Picture.
 *
 * Zwei Hauptelemente:
 *  1. **Eigener Workspace** (Hero-Frage) — wir arbeiten selbst agentisch,
 *     statt manuell. Eigene Chat-History.
 *  2. **Operating Picture** — Pilotkunden + Outcome auf einen Blick.
 *
 * Hintergrund: project_internal_roles.
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

  const [conversations, customers, outcome] = await Promise.all([
    listMyConversations(3).catch(() => []),
    listCustomers().catch(() => [] as Customer[]),
    aggregateOutcome().catch(() => ({ hours_saved: 0, agent_runs: 0, source_growth: 0 })),
  ]);

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

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active" ? "var(--color-success)" : status === "paused" ? "var(--color-warning)" : "var(--color-muted)";
  return <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />;
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
