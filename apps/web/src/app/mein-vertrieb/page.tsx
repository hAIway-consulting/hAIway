import { createServiceClient } from "@/lib/db/supabase-server";
import { requireOrgId } from "@/lib/db/org-context";
import { dismissNudge } from "@/app/admin/vertriebssteuerung/actions";

export const dynamic = "force-dynamic";

type Industry = "commerce" | "hls" | "bauwesen" | "other" | "unclassified";
const ICP_LABEL: Record<Industry, string> = {
  commerce: "E-Commerce", hls: "HLS", bauwesen: "Bauwesen", other: "Andere", unclassified: "Unklassifiziert",
};
const ICP_TONE: Record<Industry, string> = {
  commerce: "var(--color-accent)", hls: "#17C764", bauwesen: "#F59E0B",
  other: "var(--color-muted)", unclassified: "var(--color-placeholder)",
};
const TARGET_ICPS: Industry[] = ["commerce", "hls", "bauwesen"];

interface DealRow {
  external_id:        string;
  title:              string | null;
  value:              number | null;
  currency:           string | null;
  status:             string | null;
  org_external_id:    string | null;
  owner_external_id:  string | null;
  last_activity_at:   string | null;
  stage_external_id:  string | null;
}

interface StageRow {
  external_id:      string;
  deal_probability: number | null;
}

interface ClassificationRow {
  pipedrive_org_external_id: string;
  industry:                  Industry;
}

interface ActivityRow {
  external_id:      string;
  subject:          string | null;
  type:             string | null;
  due_date:         string | null;
  deal_external_id: string | null;
  done:             boolean | null;
}

interface DismissalRow {
  deal_external_id: string;
}

interface PdConnection {
  status:  string;
  config?: { company_domain?: string };
}

function formatMoney(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency", currency: currency || "EUR", maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString("de-DE")} ${currency ?? "EUR"}`;
  }
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)));
}

export default async function MeinVertriebPage() {
  const orgId = await requireOrgId();
  const supabase = createServiceClient();
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);

  const [conn, dealsRes, stagesRes, classRes, activitiesRes, dismissRes] = await Promise.all([
    supabase
      .from("organization_integrations")
      .select("status, config")
      .eq("organization_id", orgId)
      .eq("provider_id", "pipedrive")
      .maybeSingle<PdConnection>(),
    supabase
      .from("entities_pipedrive_deals")
      .select("external_id, title, value, currency, status, org_external_id, owner_external_id, last_activity_at, stage_external_id")
      .eq("organization_id", orgId)
      .eq("status", "open")
      .is("deleted_at", null),
    supabase
      .from("entities_pipedrive_stages")
      .select("external_id, deal_probability")
      .eq("organization_id", orgId),
    supabase
      .from("deal_icp_classifications")
      .select("pipedrive_org_external_id, industry")
      .eq("organization_id", orgId),
    supabase
      .from("entities_pipedrive_activities")
      .select("external_id, subject, type, due_date, deal_external_id, done")
      .eq("organization_id", orgId)
      .eq("due_date", todayIso)
      .eq("done", false)
      .is("deleted_at", null),
    supabase
      .from("nudge_dismissals")
      .select("deal_external_id")
      .eq("organization_id", orgId)
      .eq("source", "off_icp"),
  ]);

  if (!conn.data || conn.data.status !== "active") return <NotConnected />;

  const deals = (dealsRes.data ?? []) as DealRow[];
  const stages = new Map<string, number>();
  for (const s of (stagesRes.data ?? []) as StageRow[]) {
    if (s.deal_probability !== null) stages.set(s.external_id, s.deal_probability);
  }
  const classByOrg = new Map<string, Industry>();
  for (const c of (classRes.data ?? []) as ClassificationRow[]) {
    classByOrg.set(c.pipedrive_org_external_id, c.industry);
  }
  const dismissedSet = new Set((dismissRes.data ?? []).map((d: DismissalRow) => d.deal_external_id));

  const enriched = deals.map((d) => {
    const industry = d.org_external_id ? (classByOrg.get(d.org_external_id) ?? "unclassified") : "unclassified";
    const prob = d.stage_external_id ? stages.get(d.stage_external_id) ?? 100 : 100;
    const weighted = (d.value ?? 0) * prob / 100;
    return { ...d, industry, weighted, daysSinceActivity: daysSince(d.last_activity_at, now) };
  });

  const icpDeals = enriched.filter((d) => TARGET_ICPS.includes(d.industry));
  const todayCalls = icpDeals
    .filter((d) => !dismissedSet.has(d.external_id))
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 5);

  const activities = ((activitiesRes.data ?? []) as ActivityRow[])
    .map((a) => {
      const deal = enriched.find((d) => d.external_id === a.deal_external_id);
      return { ...a, deal };
    });

  const offIcpDeals = enriched
    .filter((d) => d.industry === "other" && !dismissedSet.has(d.external_id))
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 20);

  const companyDomain = conn.data.config?.company_domain;
  const pdLink = (id: string) => companyDomain
    ? `https://${companyDomain}.pipedrive.com/deal/${id}`
    : `https://app.pipedrive.com/deal/${id}`;

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-4xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-placeholder)" }}>
          Mein Vertrieb
        </span>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          Heute fokussieren
        </h1>
        <p className="text-[13px]" style={{ color: "var(--color-muted)" }}>
          Top-Deals in den Zielbranchen (E-Commerce KMU, HLS, Bauwesen).
          Reihenfolge nach gewichtetem Pipeline-Wert.
        </p>
      </header>

      <Panel title="Heute anrufen">
        {todayCalls.length === 0 ? (
          <Empty text="Keine ICP-Deals offen. Klassifikation läuft stündlich — synchronisiere Pipedrive, falls die Liste leer ist." />
        ) : (
          <ul className="flex flex-col gap-2">
            {todayCalls.map((d) => (
              <li
                key={d.external_id}
                className="rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4"
                style={{ background: "var(--color-bg)" }}
              >
                <IndustryPill industry={d.industry} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                    {d.title ?? `Deal ${d.external_id}`}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {formatMoney(d.weighted, d.currency)} gewichtet
                    {d.daysSinceActivity !== null && ` · ${d.daysSinceActivity}d ohne Aktivität`}
                  </div>
                </div>
                <a
                  href={pdLink(d.external_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] px-4 inline-flex items-center rounded-lg text-sm font-semibold"
                  style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
                >
                  Öffnen
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Geplant heute">
        {activities.length === 0 ? (
          <Empty text="Keine offenen Aktivitäten für heute." />
        ) : (
          <ul className="flex flex-col gap-2">
            {activities.map((a) => (
              <li
                key={a.external_id}
                className="rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4"
                style={{ background: "var(--color-bg)" }}
              >
                {a.deal && <IndustryPill industry={a.deal.industry} />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                    {a.subject ?? a.type ?? "Aktivität"}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {a.type ?? "Task"}
                    {a.deal?.title && ` · ${a.deal.title}`}
                  </div>
                </div>
                {a.deal && (
                  <a
                    href={pdLink(a.deal.external_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[36px] px-3 inline-flex items-center rounded-lg text-[12px] font-semibold"
                    style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                  >
                    Öffnen
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <details className="rounded-2xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}>
        <summary className="text-base font-semibold cursor-pointer" style={{ color: "var(--color-text)" }}>
          Außerhalb der Zielbranchen ({offIcpDeals.length})
        </summary>
        <p className="text-[12px] mt-2 mb-4" style={{ color: "var(--color-muted)" }}>
          Diese Deals passen nicht zur Zielgruppen-Definition. Wenn die Klassifikation falsch ist, im Berater-Cockpit überschreiben.
        </p>
        {offIcpDeals.length === 0 ? (
          <Empty text="Keine Off-ICP-Deals offen." />
        ) : (
          <ul className="flex flex-col gap-2">
            {offIcpDeals.map((d) => (
              <li
                key={d.external_id}
                className="rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4"
                style={{ background: "var(--color-bg)" }}
              >
                <IndustryPill industry={d.industry} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                    {d.title ?? `Deal ${d.external_id}`}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {formatMoney(d.weighted, d.currency)} gewichtet
                  </div>
                </div>
                <div className="flex gap-2">
                  <a
                    href={pdLink(d.external_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[36px] px-3 inline-flex items-center rounded-lg text-[12px] font-semibold"
                    style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                  >
                    Öffnen
                  </a>
                  <form action={dismissNudge}>
                    <input type="hidden" name="deal_external_id" value={d.external_id} />
                    <input type="hidden" name="source" value="off_icp" />
                    <button
                      type="submit"
                      className="min-h-[36px] px-3 rounded-lg text-[12px] font-semibold"
                      style={{ background: "var(--color-bg-elevated)", color: "var(--color-text)", border: "1px solid var(--color-line)" }}
                      title="Aus der Liste entfernen"
                    >
                      Ausblenden
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function NotConnected() {
  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-4xl mx-auto">
      <div
        className="rounded-2xl p-6 flex flex-col gap-3"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
      >
        <h1 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>
          Pipedrive noch nicht verbunden
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Bitte den Berater in deiner Org Pipedrive verbinden lassen.
        </p>
      </div>
    </div>
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
