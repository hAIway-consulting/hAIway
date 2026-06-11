"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/db/supabase-browser";

const LINK_ERROR_MESSAGES: Record<string, string> = {
  link_invalid:
    "Der Anmelde-Link ist abgelaufen oder wurde bereits verwendet. Fordere unten einen neuen an.",
  missing_code:
    "Der Anmelde-Link war unvollständig. Fordere unten einen neuen an.",
  missing_token:
    "Der Anmelde-Link war unvollständig. Fordere unten einen neuen an.",
};

type Mode = "magic" | "password";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlErrorCode = searchParams.get("error");
  const urlErrorReason = searchParams.get("reason");
  const urlError = urlErrorCode
    ? LINK_ERROR_MESSAGES[urlErrorCode] ??
      "Anmeldung fehlgeschlagen. Fordere unten einen neuen Link an."
    : null;

  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const displayError = error ?? urlError;

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setError(null);
    setSent(false);
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // The branded email template links to `/auth/confirm?token_hash=…`,
        // which does not need a client-side code_verifier — the link works
        // across devices and browsers. `emailRedirectTo` is used as the
        // fallback `redirect_to` if the dashboard template still points at
        // `{{ .ConfirmationURL }}` (PKCE flow).
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    if (error) {
      setError("Versand fehlgeschlagen. Bitte prüfe die E-Mail-Adresse und versuche es erneut.");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Supabase returns generic "Invalid login credentials" — keep the German
      // copy equally generic so we don't leak whether the email exists.
      setError("Anmeldung fehlgeschlagen. Bitte prüfe E-Mail und Passwort.");
      setLoading(false);
      return;
    }

    // Full navigation so server components re-render with the new session.
    router.push("/");
    router.refresh();
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
          Anmelden
        </h1>
        <p className="text-sm mt-2" style={{ color: "var(--color-muted)" }}>
          {mode === "magic"
            ? "Wir senden dir einen Login-Link per E-Mail — kein Passwort nötig."
            : "Melde dich mit deinem Passwort an."}
        </p>
      </div>

      <div
        className="flex gap-1 p-1 rounded-lg mb-5"
        style={{ background: "var(--color-bg)", border: "1px solid var(--color-line)" }}
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "magic"}
          onClick={() => switchMode("magic")}
          className="flex-1 min-h-[44px] rounded-md text-sm font-medium transition-colors"
          style={{
            background: mode === "magic" ? "var(--color-panel)" : "transparent",
            color: mode === "magic" ? "var(--color-text)" : "var(--color-muted)",
            border:
              mode === "magic"
                ? "1px solid var(--color-line)"
                : "1px solid transparent",
          }}
        >
          Magic Link
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          onClick={() => switchMode("password")}
          className="flex-1 min-h-[44px] rounded-md text-sm font-medium transition-colors"
          style={{
            background: mode === "password" ? "var(--color-panel)" : "transparent",
            color: mode === "password" ? "var(--color-text)" : "var(--color-muted)",
            border:
              mode === "password"
                ? "1px solid var(--color-line)"
                : "1px solid transparent",
          }}
        >
          Passwort
        </button>
      </div>

      {mode === "magic" && sent ? (
        <div
          className="rounded-lg p-4 text-sm"
          style={{
            background: "var(--color-accent-soft)",
            color: "var(--color-text)",
            border: "1px solid var(--color-accent)",
          }}
        >
          <p className="font-medium mb-1">E-Mail ist unterwegs.</p>
          <p style={{ color: "var(--color-muted)" }}>
            Prüfe dein Postfach — der Link meldet dich direkt an. Falls nichts ankommt, schau im
            Spam-Ordner nach.
          </p>
        </div>
      ) : mode === "magic" ? (
        <form onSubmit={handleMagicLink} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              E-Mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="min-h-[44px] px-3 rounded-lg text-sm"
              style={{
                border: "1px solid var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              placeholder="name@beispiel.de"
            />
          </div>

          {displayError && (
            <p className="text-sm" style={{ color: "var(--color-danger)" }}>
              {displayError}
              {urlErrorReason && !error ? (
                <span
                  className="block mt-1 text-xs"
                  style={{ color: "var(--color-muted)" }}
                >
                  Details: {urlErrorReason}
                </span>
              ) : null}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] rounded-lg text-sm font-medium gradient-accent"
            style={{ color: "var(--color-accent-text)", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Wird gesendet..." : "Login-Link senden"}
          </button>
        </form>
      ) : (
        <form onSubmit={handlePasswordLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              E-Mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              className="min-h-[44px] px-3 rounded-lg text-sm"
              style={{
                border: "1px solid var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              placeholder="name@beispiel.de"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label
                className="text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Passwort
              </label>
              <Link
                href="/auth/passwort-vergessen"
                className="text-xs font-medium"
                style={{ color: "var(--color-accent)" }}
              >
                Vergessen?
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="min-h-[44px] px-3 rounded-lg text-sm"
              style={{
                border: "1px solid var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              placeholder="••••••••"
            />
          </div>

          {displayError && (
            <p className="text-sm" style={{ color: "var(--color-danger)" }}>
              {displayError}
              {urlErrorReason && !error ? (
                <span
                  className="block mt-1 text-xs"
                  style={{ color: "var(--color-muted)" }}
                >
                  Details: {urlErrorReason}
                </span>
              ) : null}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] rounded-lg text-sm font-medium gradient-accent"
            style={{ color: "var(--color-accent-text)", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Wird angemeldet..." : "Anmelden"}
          </button>
        </form>
      )}

      <p className="text-center text-sm mt-4" style={{ color: "var(--color-muted)" }}>
        Noch kein Konto?{" "}
        <Link href="/auth/registrieren" className="font-medium" style={{ color: "var(--color-accent)" }}>
          Registrieren
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
