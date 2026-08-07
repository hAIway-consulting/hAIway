import Link from "next/link";
import { listMyConversations } from "@/app/chat/actions";
import { countReadySources } from "@/lib/db/queries/sources";
import { createUserClient, getUser } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { HeroAsk } from "./hero-ask";
import { AgentTile, type AgentTileData } from "./agent-tile";
import { listVisibleSavedAgents } from "@/lib/db/queries/saved-agents";
import { hasFeature } from "@/lib/features/flags";
import { resolveAgentConfig } from "@/lib/ai/agent/config";

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
    listMyConversations(1).catch(() => []),
    countReadySources().catch(() => 0),
  ]);

  let agents: AgentTileData[] = [];
  let agentAvailable = false;
  try {
    const orgId = await requireOrgId();

    const [agentFlag, agentCfg] = await Promise.all([
      hasFeature("agent_mode").catch(() => false),
      resolveAgentConfig(orgId).catch(() => ({ available: false })),
    ]);
    agentAvailable = agentFlag && agentCfg.available;

    // DB-backed saved agents (spec-cockpit.md §9). An empty list renders the
    // honest empty state instead of hardcoded placeholder tiles.
    const saved = await listVisibleSavedAgents(orgId);
    const accents: AgentTileData["accent"][] = ["teal", "violet", "sky", "amber", "rose"];
    agents = saved.map((a, i) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      accent: a.ui.accent ?? accents[i % accents.length],
      icon: a.ui.icon ?? "draft",
    }));
  } catch {
    /* no org context or agent config available — render the empty state */
    agents = [];
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
            hAIway Cockpit · {greeting()}
          </span>
          <h1
            className="text-3xl md:text-5xl font-bold leading-[1.05] tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
          >
            {first ? `Was kann ich heute für dich tun, ${first}?` : "Was kann ich heute für dich tun?"}
          </h1>
        </div>

        <HeroAsk
          placeholder={'Frag mich etwas zu deinen Daten — z. B. „Welche Pilotkunden sind diese Woche aktiv?"'}
          agentAvailable={agentAvailable}
        />
      </section>

      {/* ── Heute / Inbox ── */}
      <section className="w-full max-w-5xl mt-12 md:mt-16">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
            Heute
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
        </div>
      </section>

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
        {agents.length === 0 ? (
          <div
            className="rounded-2xl p-5 text-center text-[13px]"
            style={{
              background: "var(--color-panel)",
              border: "1px dashed var(--color-line)",
              color: "var(--color-muted)",
            }}
          >
            Noch keine Agenten hinterlegt — euer Berater richtet sie im Cockpit ein.
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {agents.map((agent) => (
              <AgentTile key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </section>

      {/* Verlauf lebt im Cockpit (spec §2) — hier nur der Einstieg. */}
      <section className="w-full max-w-5xl mt-10 flex justify-center">
        <Link
          href="/chat"
          className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full text-[13px] font-medium transition-all hover:shadow-sm"
          style={{
            background: "var(--color-panel)",
            border: "1px solid var(--color-line)",
            color: "var(--color-accent)",
          }}
        >
          Cockpit-Verlauf öffnen →
        </Link>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
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
          color: "var(--color-text)",
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

