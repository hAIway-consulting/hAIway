import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/db/queries/organization";
import { getMessageDetail } from "../actions";
import ReviewForm from "./review-form";

export const dynamic = "force-dynamic";

export default async function MessageReviewPage({
  params,
}: {
  params: Promise<{ messageId: string }>;
}) {
  // Cross-tenant view — same reasoning as the overview page.
  if (!(await isPlatformAdmin().catch(() => false))) redirect("/");

  const { messageId } = await params;
  const detail = await getMessageDetail(messageId);
  if (!detail) notFound();

  const myReview = detail.reviews.find((r) => r.is_mine) ?? null;
  const otherReviews = detail.reviews.filter((r) => !r.is_mine);

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/admin/retrieval-qualitaet"
        className="text-sm"
        style={{ color: "var(--color-accent)" }}
      >
        ← Zurück zur Übersicht
      </Link>

      {/* Frage + Antwort */}
      <section
        className="rounded-xl p-5 flex flex-col gap-4"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-line)",
        }}
      >
        <div>
          <p
            className="text-xs uppercase tracking-widest mb-1"
            style={{ color: "var(--color-muted)" }}
          >
            Frage
          </p>
          <p
            className="text-base font-medium"
            style={{ color: "var(--color-text)" }}
          >
            {detail.question ?? "(keine User-Frage im Verlauf gefunden)"}
          </p>
        </div>
        <div>
          <p
            className="text-xs uppercase tracking-widest mb-1"
            style={{ color: "var(--color-muted)" }}
          >
            Antwort
          </p>
          <p
            className="text-sm whitespace-pre-wrap"
            style={{ color: "var(--color-text)" }}
          >
            {detail.content}
          </p>
        </div>
      </section>

      {/* Metadaten */}
      <section
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
          Kontext
        </h3>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Meta label="Zeitpunkt" value={new Date(detail.created_at).toLocaleString("de-DE")} />
          <Meta label="Kunde" value={detail.organization_name ?? "–"} />
          <Meta label="Modell" value={detail.model ?? "–"} />
          <Meta label="Chat" value={detail.conversation_title ?? "–"} />
          <Meta label="Chunks" value={String(detail.chunks_retrieved ?? 0)} />
          <Meta label="Latenz" value={detail.latency_ms != null ? `${detail.latency_ms} ms` : "–"} />
          <Meta label="Entity-Context" value={detail.entity_context ?? "–"} />
          <Meta label="Rewrite" value={detail.rewritten_query ?? "–"} />
        </dl>
        {detail.retrieval_arms &&
          Object.keys(detail.retrieval_arms).length > 0 && (
            <div className="mt-4">
              <p
                className="text-xs uppercase tracking-widest mb-2"
                style={{ color: "var(--color-muted)" }}
              >
                Retrieval-Arme
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(detail.retrieval_arms).map(([arm, n]) => (
                  <span
                    key={arm}
                    className="text-xs px-2 py-1 rounded-full"
                    style={{
                      background: "var(--color-accent-soft)",
                      color: "var(--color-accent)",
                    }}
                  >
                    {arm}: {n}
                  </span>
                ))}
              </div>
            </div>
          )}
      </section>

      {/* Zitierte Quellen */}
      <section
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
          Verwendete Chunks ({detail.chunks.length})
        </h3>
        {detail.chunks.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Keine Chunks — das LLM hatte keinen Kontext. Das ist oft ein
            Retrieval- oder Datenqualitäts-Signal.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.chunks.map((c, idx) => (
              <li
                key={c.id}
                className="rounded-lg p-3"
                style={{ background: "var(--color-bg)" }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="text-xs font-medium"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    #{idx + 1} · {c.source_title ?? "(unbekannte Quelle)"}
                    {c.chunk_index != null && ` · Chunk ${c.chunk_index}`}
                  </span>
                  {c.source_id && (
                    <Link
                      href={`/sources/${c.source_id}`}
                      className="text-xs"
                      style={{ color: "var(--color-accent)" }}
                    >
                      Quelle öffnen →
                    </Link>
                  )}
                </div>
                <p
                  className="text-sm whitespace-pre-wrap"
                  style={{ color: "var(--color-text)" }}
                >
                  {c.text_preview}
                  {c.text_preview.length >= 500 && "…"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Review Form */}
      <ReviewForm
        messageId={detail.id}
        initialVerdict={myReview?.verdict ?? null}
        initialRootCause={myReview?.root_cause ?? null}
        initialNotes={myReview?.notes ?? ""}
      />

      {/* Andere Reviews */}
      {otherReviews.length > 0 && (
        <section
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
            Weitere Bewertungen
          </h3>
          <ul className="flex flex-col gap-3">
            {otherReviews.map((r) => (
              <li
                key={r.id}
                className="rounded-lg p-3"
                style={{ background: "var(--color-bg)" }}
              >
                <div className="flex items-center justify-between mb-1 text-xs">
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    {r.reviewer_name ?? "Unbekannter Admin"} ·{" "}
                    {new Date(r.updated_at).toLocaleString("de-DE")}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: "var(--color-accent-soft)",
                      color: "var(--color-accent)",
                    }}
                  >
                    {verdictLabel(r.verdict)}
                    {r.root_cause && ` · ${rootCauseLabel(r.root_cause)}`}
                  </span>
                </div>
                {r.notes && (
                  <p
                    className="text-sm whitespace-pre-wrap"
                    style={{ color: "var(--color-text)" }}
                  >
                    {r.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt
        className="text-xs uppercase tracking-widest"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </dt>
      <dd className="mt-0.5 break-words" style={{ color: "var(--color-text)" }}>
        {value}
      </dd>
    </div>
  );
}

function verdictLabel(v: string): string {
  switch (v) {
    case "correct":
      return "korrekt";
    case "partial":
      return "teilweise";
    case "hallucination":
      return "halluziniert";
    case "empty":
      return "leer";
    default:
      return v;
  }
}

function rootCauseLabel(c: string): string {
  switch (c) {
    case "prompt":
      return "System-Prompt";
    case "data_quality":
      return "Datenqualität";
    case "retrieval":
      return "Retrieval";
    case "llm":
      return "LLM";
    case "out_of_scope":
      return "Außerhalb Scope";
    case "ambiguous_question":
      return "Frage unklar";
    default:
      return c;
  }
}
