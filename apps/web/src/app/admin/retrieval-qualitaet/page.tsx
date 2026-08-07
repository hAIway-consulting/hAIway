import Link from "next/link";
import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import {
  getQualityTotals,
  getPassiveSignals,
  listReviewableMessages,
  listOrganizationsForFilter,
  type ReviewableMessage,
  type RetrievalQualityTotals,
  type PassiveSignals,
} from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = {
  org?: string;
  unreviewed?: string;
  zero?: string;
  days?: string;
  offset?: string;
};

export default async function RetrievalQualityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Cross-tenant view. The actions below already enforce requireAdmin(), but
  // they throw — without this gate a Berater gets a 500 page instead of a
  // redirect. Defense in depth plus correct UX.
  if (!(await isPlatformAdmin().catch(() => false))) redirect("/");

  const params = await searchParams;
  const organizationId = params.org && params.org !== "all" ? params.org : null;
  const onlyUnreviewed = params.unreviewed === "1";
  const onlyZeroChunks = params.zero === "1";
  const days = Math.max(1, Math.min(parseInt(params.days ?? "30"), 365));
  const offset = Math.max(0, parseInt(params.offset ?? "0") || 0);
  const pageSize = 50;

  const [totals, passive, messages, orgs] = await Promise.all([
    getQualityTotals(days, organizationId),
    getPassiveSignals(days, organizationId),
    listReviewableMessages({
      organizationId,
      onlyUnreviewed,
      onlyZeroChunks,
      limit: pageSize,
      offset,
    }),
    listOrganizationsForFilter(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Header days={days} />
      <FilterBar
        orgs={orgs}
        selectedOrg={organizationId}
        onlyUnreviewed={onlyUnreviewed}
        onlyZeroChunks={onlyZeroChunks}
        days={days}
      />
      <KpiCards totals={totals} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CauseBreakdown totals={totals} />
        <PassiveSignalsCard passive={passive} />
      </div>
      <ReviewQueue
        messages={messages}
        offset={offset}
        pageSize={pageSize}
        params={params}
      />
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────

function Header({ days }: { days: number }) {
  return (
    <div>
      <h2
        className="text-xl font-semibold"
        style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
      >
        Retrieval-Qualität
      </h2>
      <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
        Treffergenauigkeit aus manuell verifizierten Chat-Antworten der letzten{" "}
        {days} Tage. Nur Platform-Admins.
      </p>
    </div>
  );
}

// ── Filter-Bar ────────────────────────────────────────────────────────

function FilterBar({
  orgs,
  selectedOrg,
  onlyUnreviewed,
  onlyZeroChunks,
  days,
}: {
  orgs: Array<{ id: string; name: string }>;
  selectedOrg: string | null;
  onlyUnreviewed: boolean;
  onlyZeroChunks: boolean;
  days: number;
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-center gap-3 rounded-xl p-4"
      style={{
        background: "var(--color-panel)",
        border: "1px solid var(--color-line)",
      }}
    >
      <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-muted)" }}>
        <span>Kunde</span>
        <select
          name="org"
          defaultValue={selectedOrg ?? "all"}
          className="min-h-[36px] px-2 rounded-lg text-sm"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-line)",
            color: "var(--color-text)",
          }}
        >
          <option value="all">Alle</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-muted)" }}>
        <span>Zeitraum</span>
        <select
          name="days"
          defaultValue={String(days)}
          className="min-h-[36px] px-2 rounded-lg text-sm"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-line)",
            color: "var(--color-text)",
          }}
        >
          <option value="7">7 Tage</option>
          <option value="30">30 Tage</option>
          <option value="90">90 Tage</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-muted)" }}>
        <input
          type="checkbox"
          name="unreviewed"
          value="1"
          defaultChecked={onlyUnreviewed}
        />
        <span>Nur unbewertet</span>
      </label>

      <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-muted)" }}>
        <input
          type="checkbox"
          name="zero"
          value="1"
          defaultChecked={onlyZeroChunks}
        />
        <span>Nur ohne Chunks</span>
      </label>

      <button
        type="submit"
        className="min-h-[36px] px-4 rounded-lg text-sm font-medium"
        style={{
          background: "var(--color-accent)",
          color: "var(--color-on-accent, #fff)",
        }}
      >
        Filtern
      </button>
    </form>
  );
}

// ── KPI Cards ─────────────────────────────────────────────────────────

function KpiCards({ totals }: { totals: RetrievalQualityTotals }) {
  // Partial zaehlt halb (0.5) — keine Treffergenauigkeit ohne Abstufung.
  const hitRate =
    totals.reviewed > 0
      ? (totals.correct + 0.5 * totals.partial) / totals.reviewed
      : null;
  const halluRate =
    totals.reviewed > 0 ? totals.hallucination / totals.reviewed : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatCard
        label="Trefferquote"
        value={hitRate === null ? "–" : `${Math.round(hitRate * 100)} %`}
        sub={
          totals.reviewed === 0
            ? "Noch keine Bewertungen"
            : `${totals.correct} korrekt · ${totals.partial} teilweise`
        }
      />
      <StatCard
        label="Halluzinations-Rate"
        value={halluRate === null ? "–" : `${(halluRate * 100).toFixed(1)} %`}
        sub={`${totals.hallucination} von ${totals.reviewed} reviewt`}
      />
      <StatCard
        label="Keine Antwort"
        value={String(totals.empty)}
        sub="Antwort leer / LLM versagt"
      />
      <StatCard
        label="Reviewt"
        value={String(totals.reviewed)}
        sub="Gesamte Bewertungen"
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--color-panel)",
        border: "1px solid var(--color-line)",
      }}
    >
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        {label}
      </p>
      <p
        className="text-3xl font-semibold mt-1"
        style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ── Ursachen-Breakdown ────────────────────────────────────────────────

function CauseBreakdown({ totals }: { totals: RetrievalQualityTotals }) {
  const rows: Array<{ label: string; value: number }> = [
    { label: "Datenqualität", value: totals.cause_data },
    { label: "Retrieval", value: totals.cause_retrieval },
    { label: "System-Prompt", value: totals.cause_prompt },
    { label: "LLM", value: totals.cause_llm },
    { label: "Außerhalb Scope", value: totals.cause_oos },
    { label: "Frage unklar", value: totals.cause_ambiguous },
  ];
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--color-panel)",
        border: "1px solid var(--color-line)",
      }}
    >
      <h3
        className="text-base font-semibold mb-4"
        style={{ color: "var(--color-text)" }}
      >
        Fehlerursachen
      </h3>
      {rows.every((r) => r.value === 0) ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Noch keine Fehlklassifikationen markiert.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: "var(--color-text-secondary)" }}>
                  {r.label}
                </span>
                <span style={{ color: "var(--color-muted)" }}>{r.value}</span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "var(--color-bg)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(r.value / max) * 100}%`,
                    background: "var(--color-accent)",
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Passiv-Signale ────────────────────────────────────────────────────

function PassiveSignalsCard({ passive }: { passive: PassiveSignals }) {
  const zeroRate =
    passive.total_messages > 0
      ? (passive.zero_chunks / passive.total_messages) * 100
      : null;
  const armEntries = Object.entries(passive.arm_mix).sort(
    (a, b) => b[1] - a[1],
  );
  const armTotal = armEntries.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--color-panel)",
        border: "1px solid var(--color-line)",
      }}
    >
      <h3
        className="text-base font-semibold mb-4"
        style={{ color: "var(--color-text)" }}
      >
        Technische Signale
      </h3>

      <dl className="grid grid-cols-2 gap-3 text-sm mb-4">
        <div>
          <dt style={{ color: "var(--color-muted)" }}>Messages gesamt</dt>
          <dd className="font-semibold" style={{ color: "var(--color-text)" }}>
            {passive.total_messages}
          </dd>
        </div>
        <div>
          <dt style={{ color: "var(--color-muted)" }}>Keine-Chunks-Rate</dt>
          <dd className="font-semibold" style={{ color: "var(--color-text)" }}>
            {zeroRate === null ? "–" : `${zeroRate.toFixed(1)} %`}
          </dd>
        </div>
        <div>
          <dt style={{ color: "var(--color-muted)" }}>Ø Chunks/Antwort</dt>
          <dd className="font-semibold" style={{ color: "var(--color-text)" }}>
            {passive.avg_chunks === null ? "–" : passive.avg_chunks}
          </dd>
        </div>
        <div>
          <dt style={{ color: "var(--color-muted)" }}>p95 Latenz</dt>
          <dd className="font-semibold" style={{ color: "var(--color-text)" }}>
            {passive.p95_latency_ms === null
              ? "–"
              : `${passive.p95_latency_ms} ms`}
          </dd>
        </div>
      </dl>

      {armEntries.length > 0 && (
        <>
          <p
            className="text-xs uppercase tracking-widest mb-2"
            style={{ color: "var(--color-muted)" }}
          >
            Retrieval-Arme (Chunks aus …)
          </p>
          <div
            className="h-2 rounded-full overflow-hidden flex"
            style={{ background: "var(--color-bg)" }}
          >
            {armEntries.map(([arm, count], i) => (
              <div
                key={arm}
                title={`${arm}: ${count}`}
                style={{
                  width: `${(count / armTotal) * 100}%`,
                  background: armColor(i),
                }}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-2 mt-2 text-xs">
            {armEntries.map(([arm, count], i) => (
              <li
                key={arm}
                className="flex items-center gap-1"
                style={{ color: "var(--color-muted)" }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: armColor(i) }}
                />
                {arm}: {count}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function armColor(i: number): string {
  // Accent-Varianten fuer die Retrieval-Arme. Wir verwenden bewusst keine
  // Ampel-Farben — ein Arm ist nicht "besser" oder "schlechter".
  const colors = [
    "var(--color-accent)",
    "var(--color-accent-hover, var(--color-accent))",
    "var(--color-text-secondary)",
    "var(--color-muted)",
    "var(--color-line)",
  ];
  return colors[i % colors.length];
}

// ── Review-Queue ──────────────────────────────────────────────────────

function ReviewQueue({
  messages,
  offset,
  pageSize,
  params,
}: {
  messages: ReviewableMessage[];
  offset: number;
  pageSize: number;
  params: SearchParams;
}) {
  const hasMore = messages.length === pageSize;
  const baseQuery = new URLSearchParams();
  if (params.org) baseQuery.set("org", params.org);
  if (params.unreviewed) baseQuery.set("unreviewed", params.unreviewed);
  if (params.zero) baseQuery.set("zero", params.zero);
  if (params.days) baseQuery.set("days", params.days);

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--color-panel)",
        border: "1px solid var(--color-line)",
      }}
    >
      <h3
        className="text-base font-semibold mb-4"
        style={{ color: "var(--color-text)" }}
      >
        Review-Queue
      </h3>

      {messages.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Keine Messages im aktuellen Filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {messages.map((m) => (
            <li key={m.id}>
              <Link
                href={`/admin/retrieval-qualitaet/${m.id}`}
                className="flex flex-col gap-1 p-3 rounded-lg"
                style={{ background: "var(--color-bg)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-xs"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {new Date(m.created_at).toLocaleString("de-DE")} ·{" "}
                    {m.organization_name ?? "—"}
                  </span>
                  <VerdictBadge verdict={m.my_verdict} reviews={m.total_reviews} />
                </div>
                <span
                  className="text-sm font-medium"
                  style={{ color: "var(--color-text)" }}
                >
                  {m.question
                    ? m.question.slice(0, 180)
                    : "(keine User-Frage gefunden)"}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {m.answer_preview.slice(0, 140)}
                  {m.answer_preview.length >= 140 && "…"}
                </span>
                <div
                  className="flex flex-wrap gap-1 mt-1 text-[11px]"
                  style={{ color: "var(--color-muted)" }}
                >
                  <Chip label={`${m.chunks_retrieved ?? "?"} Chunks`} />
                  <Chip label={`${m.latency_ms ?? "?"} ms`} />
                  {m.retrieval_arms &&
                    Object.entries(m.retrieval_arms).map(([arm, count]) => (
                      <Chip key={arm} label={`${arm}:${count}`} />
                    ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-between mt-4 text-sm">
        {offset > 0 ? (
          <Link
            href={`/admin/retrieval-qualitaet?${withOffset(baseQuery, Math.max(0, offset - pageSize))}`}
            style={{ color: "var(--color-accent)" }}
          >
            ← Zurück
          </Link>
        ) : (
          <span />
        )}
        {hasMore ? (
          <Link
            href={`/admin/retrieval-qualitaet?${withOffset(baseQuery, offset + pageSize)}`}
            style={{ color: "var(--color-accent)" }}
          >
            Weiter →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

function withOffset(base: URLSearchParams, offset: number): string {
  const copy = new URLSearchParams(base.toString());
  if (offset > 0) copy.set("offset", String(offset));
  else copy.delete("offset");
  return copy.toString();
}

function Chip({ label }: { label: string }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded"
      style={{
        background: "var(--color-bg-elevated)",
        color: "var(--color-text-secondary)",
      }}
    >
      {label}
    </span>
  );
}

function VerdictBadge({
  verdict,
  reviews,
}: {
  verdict: ReviewableMessage["my_verdict"];
  reviews: number;
}) {
  if (!verdict && reviews === 0) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full"
        style={{
          background: "var(--color-bg-elevated)",
          color: "var(--color-muted)",
        }}
      >
        unbewertet
      </span>
    );
  }

  const label =
    verdict === "correct"
      ? "korrekt"
      : verdict === "partial"
        ? "teilweise"
        : verdict === "hallucination"
          ? "halluziniert"
          : verdict === "empty"
            ? "leer"
            : `${reviews} Review${reviews === 1 ? "" : "s"}`;

  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        background: "var(--color-accent-soft)",
        color: "var(--color-accent)",
      }}
    >
      {label}
    </span>
  );
}
