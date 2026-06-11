import Link from "next/link";
import { listMyConversations } from "@/app/chat/actions";
import { countReadySources } from "@/lib/db/queries/sources";
import { createUserClient, getUser } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { listAutomations, type Automation } from "@/lib/db/queries/workflows";
import { HeroAsk } from "./hero-ask";
import { AgentTile } from "./agent-tile";
import { STUB_AGENTS, type WorkspaceAgent } from "./agents";
import { listVisibleSavedAgents } from "@/lib/db/queries/saved-agents";

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Späte Stunde";
  if (h < 11) return "Guten Morgen";
  if (h < 14) return "Hallo";
  if (h < 18) return "Guten Tag";
  return "Guten Abend";
}

function firstName(fullName: string | null): string {
  if (!fullName) return "";
  const cleaned = fullName.replace(/^\[[^\]]+\]\s*/, "");
  const first = cleaned.trim().split(/\s+/)[0];
  return first ?? "";
}

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

export async function WorkspaceHome() {
  const user = await getUser();
  let fullName: string | null = null;
  if (user) {
    const db = await createUserClient();
    const { data } = await db.from("profiles").select("full_name").eq("id", user.id).single();
    fullName = data?.full_name ?? null;
  }
  const first = firstName(fullName);

  const [conversations, sourceCount] = await Promise.all([
    listMyConversations(5).catch(() => []),
    countReadySources().catch(() => 0),
  ]);

  let automations: Automation[] = [];
  let agents: WorkspaceAgent[] = STUB_AGENTS;
  try {
    const orgId = await requireOrgId();
    automations = await listAutomations(orgId);

    // DB-backed saved agents (spec-cockpit.md §9); STUB_AGENTS stay as a
    // fallback until the foundation migration is pushed + seeded.
    const saved = await listVisibleSavedAgents(orgId);
    if (saved.length > 0) {
      const accents: WorkspaceAgent["accent"][] = ["teal", "violet", "sky", "amber", "rose"];
      agents = saved.map((a, i) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        prompt: a.prompt,
        accent: a.ui.accent ?? accents[i % accents.length],
        icon: a.ui.icon ?? "draft",
      }));
    }
  } catch {
    automations = [];
  }

  const lastChatTime = conversations[0]?.last_message_at;

  return (
    <div className="flex flex-col items-center px-4 md:px-8 pt-12 md:pt-20 pb-20">
      {/* ── Hero ── */}
      <section className="w-full max-w-2xl flex flex-col items-center gap-6 md:gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <span
            className="text-[12px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--color-placeholder)" }}
          >
            {greeting()}
          </span>
          <h1
            className="text-3xl md:text-5xl font-bold leading-[1.05] tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
          >
            {first ? `Was kann ich heute für dich tun, ${first}?` : "Was kann ich heute für dich tun?"}
          </h1>
        </div>

        <HeroAsk placeholder={'Frag mich etwas zu deinen Daten — z. B. „Welche Pilotkunden sind diese Woche aktiv?"'} />
      </section>

      {/* ── Heute / Inbox ── */}
      <section className="w-full max-w-5xl mt-12 md:mt-16">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
            Heute
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatCard
            label="Wissensquellen verfügbar"
            value={String(sourceCount)}
            hint="für deine Fragen freigegeben"
          />
          <StatCard
            label="Letzte Konversation"
            value={lastChatTime ? relativeTime(lastChatTime) : "—"}
            hint={lastChatTime ? conversations[0]?.title ?? "" : "Noch keine Chats"}
          />
          <StatCard
            label="Status"
            value="Bereit"
            hint="Plattform läuft, Daten frisch"
            tone="success"
          />
        </div>
      </section>

      {/* ── Automatisierungen ── */}
      {automations.length > 0 && (
        <section className="w-full max-w-5xl mt-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
              Automatisierungen
            </h2>
            <Link href="/automatisierungen" className="text-[12px] font-medium" style={{ color: "var(--color-accent)" }}>
              Details →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {automations.map((a) => (
              <AutomationCard key={a.key} a={a} />
            ))}
          </div>
        </section>
      )}

      {/* ── Deine Agenten ── */}
      <section className="w-full max-w-5xl mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
            Deine Agenten
          </h2>
          <span className="text-[12px]" style={{ color: "var(--color-muted)" }}>
            One-Click — Pre-Prompt + deine Daten
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {agents.map((agent) => (
            <AgentTile key={agent.id} agent={agent} />
          ))}
        </div>
      </section>

      {/* ── Letzte Chats ── */}
      <section className="w-full max-w-5xl mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
            Letzte Chats
          </h2>
          {conversations.length > 0 && (
            <Link href="/chat" className="text-[12px] font-medium" style={{ color: "var(--color-accent)" }}>
              Alle öffnen →
            </Link>
          )}
        </div>
        {conversations.length === 0 ? (
          <div
            className="rounded-2xl p-6 text-center"
            style={{
              background: "var(--color-panel)",
              border: "1px dashed var(--color-line)",
              color: "var(--color-muted)",
            }}
          >
            Noch keine Konversation — stell deine erste Frage oben.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl min-h-[52px] transition-all hover:shadow-sm"
                  style={{
                    background: "var(--color-panel)",
                    border: "1px solid var(--color-line)",
                  }}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                      aria-hidden
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
                      </svg>
                    </span>
                    <span className="text-[14px] font-medium truncate" style={{ color: "var(--color-text)" }}>
                      {c.title || "Neuer Chat"}
                    </span>
                  </span>
                  <span className="text-[11px] shrink-0" style={{ color: "var(--color-placeholder)" }}>
                    {relativeTime(c.last_message_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success";
}) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-1"
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
      {hint && (
        <span className="text-[12px] truncate" style={{ color: "var(--color-muted)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function AutomationCard({ a }: { a: Automation }) {
  const rate = a.kpi.total > 0 ? Math.round((a.kpi.success / a.kpi.total) * 100) : null;
  const handlungsbedarf = a.kpi.failed > 0;
  return (
    <Link
      href="/automatisierungen"
      className="block rounded-2xl p-5 transition-all hover:-translate-y-0.5"
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
      <div className="flex gap-5">
        <AutoStat label="Tickets" value={String(a.kpi.total)} />
        <AutoStat label="Erfolg" value={rate == null ? "—" : `${rate}%`} tone="success" />
        <AutoStat label="Fehler" value={String(a.kpi.failed)} tone={handlungsbedarf ? "danger" : "default"} />
      </div>
      {handlungsbedarf && (
        <p className="text-[12px] mt-3 font-medium" style={{ color: "var(--color-danger)" }}>
          ⚠ {a.kpi.failed} {a.kpi.failed === 1 ? "Fall benötigt" : "Fälle benötigen"} Aufmerksamkeit.
        </p>
      )}
    </Link>
  );
}

function AutoStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "danger" }) {
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
