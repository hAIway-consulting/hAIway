"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/db/supabase-browser";

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [sessionReady, setSessionReady] = useState<"checking" | "ok" | "missing">("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let cancelled = false;

    // When Supabase redirects the user here (via /auth/callback → next), the
    // session is written as cookies by the callback route — but the browser
    // client hydrates from those cookies asynchronously. Give it one tick.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSessionReady(data.session ? "ok" : "missing");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }

    setLoading(true);

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError("Passwort konnte nicht gesetzt werden. Bitte versuche es erneut.");
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);

    // Give the user a moment to read the success message, then send them home.
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1500);
  }

  return (
    <div
      className="rounded-xl p-6"
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-line)" }}
    >
      <div className="text-center mb-6">
        <Image
          src="/brand/logo-tile.png"
          alt="hAIway consulting"
          width={48}
          height={48}
          className="w-12 h-12 rounded-xl mx-auto mb-3"
        />
        <h1
          className="text-xl font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
        >
          Neues Passwort setzen
        </h1>
        <p className="text-sm mt-2" style={{ color: "var(--color-muted)" }}>
          Wähle ein neues Passwort für dein Konto.
        </p>
      </div>

      {sessionReady === "checking" ? (
        <p className="text-sm text-center" style={{ color: "var(--color-muted)" }}>
          Sitzung wird geprüft…
        </p>
      ) : sessionReady === "missing" ? (
        <div
          className="rounded-lg p-4 text-sm"
          style={{
            background: "var(--color-panel)",
            border: "1px solid var(--color-danger)",
            color: "var(--color-text)",
          }}
        >
          <p className="font-medium mb-1">Link abgelaufen oder ungültig.</p>
          <p style={{ color: "var(--color-muted)" }}>
            Fordere{" "}
            <Link
              href="/auth/passwort-vergessen"
              className="font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              hier
            </Link>{" "}
            einen neuen Reset-Link an.
          </p>
        </div>
      ) : done ? (
        <div
          className="rounded-lg p-4 text-sm"
          style={{
            background: "var(--color-accent-soft)",
            color: "var(--color-text)",
            border: "1px solid var(--color-accent)",
          }}
        >
          <p className="font-medium mb-1">Passwort aktualisiert.</p>
          <p style={{ color: "var(--color-muted)" }}>Du wirst gleich weitergeleitet…</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              Neues Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoFocus
              autoComplete="new-password"
              className="min-h-[44px] px-3 rounded-lg text-sm"
              style={{
                border: "1px solid var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              placeholder="Mindestens 8 Zeichen"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              Passwort bestätigen
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="min-h-[44px] px-3 rounded-lg text-sm"
              style={{
                border: "1px solid var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              placeholder="Wiederhole das Passwort"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] rounded-lg text-sm font-medium gradient-accent"
            style={{ color: "var(--color-accent-text)", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Wird gespeichert..." : "Passwort speichern"}
          </button>
        </form>
      )}
    </div>
  );
}
