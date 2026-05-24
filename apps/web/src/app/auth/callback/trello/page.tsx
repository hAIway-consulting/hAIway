"use client";

// Trello's 1-Click Token Authorization returns the token in the URL
// fragment (#token=…), which servers never see. This thin client page
// reads it from window.location.hash, hands it to a server action, and
// redirects the user back to /admin/integrationen.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveTrelloToken } from "@/app/quellen/actions";

export default function TrelloCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"reading" | "saving" | "done">("reading");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const token = params.get("token");
      if (!token) {
        if (!cancelled) setError("Kein Token im Trello-Callback empfangen. Möglicherweise hast du den Zugriff verweigert.");
        return;
      }
      try {
        setStage("saving");
        await saveTrelloToken(token);
        if (cancelled) return;
        setStage("done");
        router.replace("/admin/integrationen?connected=trello-token");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => { cancelled = true; };
  }, [router]);

  const message =
    error                     ? `Fehler: ${error}` :
    stage === "reading"       ? "Token wird gelesen …" :
    stage === "saving"        ? "Verbindung wird gespeichert …" :
                                "Verbindung gespeichert. Weiterleitung …";

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--color-bg)" }}>
      <div
        className="rounded-2xl p-6 max-w-md w-full flex flex-col gap-3"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
      >
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
          Trello verbinden
        </h1>
        <p className="text-sm" style={{ color: error ? "var(--color-danger)" : "var(--color-muted)" }}>
          {message}
        </p>
        {error && (
          <a
            href="/admin/integrationen"
            className="self-start min-h-[44px] px-4 inline-flex items-center rounded-lg text-sm font-medium"
            style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
          >
            Zurück zu Integrationen
          </a>
        )}
      </div>
    </div>
  );
}
