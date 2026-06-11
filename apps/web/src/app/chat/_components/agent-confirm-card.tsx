"use client";

// Write-confirmation card (spec-cockpit.md §12.2): a pending write action is
// settled HERE — never by the model. Renders the tool's preview and offers
// Bestätigen/Abbrechen; the server action executes the persisted input.

import { useState } from "react";
import { confirmAgentAction, type PendingConfirmation } from "../agent-actions";
import { badge, btn, styles } from "@/components/ui/table-classes";

const MAX_LISTED_CARDS = 8;

type CleanupPreview = {
  target_list?: string;
  would_move?: number;
  cards?: { name?: string }[];
};

function parsePreview(preview: string): CleanupPreview | null {
  try {
    const obj = JSON.parse(preview) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const p = obj as CleanupPreview;
      if (typeof p.would_move === "number" && Array.isArray(p.cards)) return p;
    }
  } catch {
    /* not JSON — fall back to raw rendering */
  }
  return null;
}

export default function AgentConfirmCard({
  confirmation,
  onResolved,
}: {
  confirmation: PendingConfirmation;
  onResolved: (text: string) => void;
}) {
  const [submitting, setSubmitting] = useState<"approve" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = parsePreview(confirmation.preview);

  async function decide(approve: boolean) {
    if (submitting) return; // double-submit safe
    setSubmitting(approve ? "approve" : "cancel");
    setError(null);
    try {
      const result = await confirmAgentAction(confirmation.runId, approve);
      onResolved(result.text);
    } catch {
      setError("Das hat nicht geklappt. Bitte versuche es erneut.");
      setSubmitting(null);
    }
  }

  return (
    <div
      className="max-w-[90%] md:max-w-[80%] rounded-xl border p-4 flex flex-col gap-3 animate-slide-up"
      style={{
        background: "var(--color-panel)",
        borderColor: "var(--color-warning)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--color-text)" }}
        >
          Bestätigung erforderlich
        </span>
        <span className={`${badge.pill} font-mono`} style={styles.warning}>
          {confirmation.tool}
        </span>
      </div>

      {parsed ? (
        <div className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--color-text)" }}>
          <p>
            {parsed.would_move === 0 ? (
              "Es würde keine Karte verschoben."
            ) : (
              <>
                <strong>{parsed.would_move}</strong>{" "}
                {parsed.would_move === 1 ? "Karte wird" : "Karten werden"} in die Liste{" "}
                <strong>„{parsed.target_list ?? "…"}“</strong> verschoben.
              </>
            )}
          </p>
          {(parsed.cards ?? []).length > 0 && (
            <ul className="flex flex-col gap-1">
              {(parsed.cards ?? []).slice(0, MAX_LISTED_CARDS).map((c, i) => (
                <li
                  key={i}
                  className="text-xs px-2.5 py-1.5 rounded-lg truncate"
                  style={{ background: "var(--color-bg-elevated)", color: "var(--color-muted)" }}
                >
                  {c.name ?? "(ohne Namen)"}
                </li>
              ))}
              {(parsed.cards ?? []).length > MAX_LISTED_CARDS && (
                <li className="text-xs px-2.5 py-1" style={styles.muted}>
                  + {(parsed.cards ?? []).length - MAX_LISTED_CARDS} weitere
                </li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <pre
          className="text-xs p-2.5 rounded-lg overflow-hidden max-h-40 whitespace-pre-wrap break-words"
          style={{ background: "var(--color-bg-elevated)", color: "var(--color-muted)" }}
        >
          {confirmation.preview.slice(0, 1200)}
        </pre>
      )}

      <p className="text-xs" style={styles.muted}>
        Erst nach deiner Bestätigung wird die Aktion ausgeführt — Abbrechen ändert nichts.
      </p>

      {error && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void decide(true)}
          disabled={submitting !== null}
          className={btn.primary}
          style={{ ...styles.accent, opacity: submitting !== null ? 0.6 : 1 }}
        >
          {submitting === "approve" ? "Wird ausgeführt …" : "Bestätigen"}
        </button>
        <button
          type="button"
          onClick={() => void decide(false)}
          disabled={submitting !== null}
          className={btn.ghost}
          style={{
            color: "var(--color-danger)",
            opacity: submitting !== null ? 0.6 : 1,
          }}
        >
          {submitting === "cancel" ? "Wird abgebrochen …" : "Abbrechen"}
        </button>
      </div>
    </div>
  );
}
