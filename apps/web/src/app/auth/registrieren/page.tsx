"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/db/supabase-browser";

type Mode = "magic" | "password";

const MIN_PASSWORD_LENGTH = 8;

export default function RegisterPage() {
  const [mode, setMode] = useState<Mode>("magic");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

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
        // See /auth/anmelden for why we prefer /auth/confirm over /auth/callback.
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        data: fullName ? { full_name: fullName } : undefined,
      },
    });

    if (error) {
      setError("Registrierung fehlgeschlagen. Bitte versuche es erneut.");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  async function handlePasswordSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
      return;
    }

    setLoading(true);

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Supabase will send a confirmation email — link points at /auth/confirm
        // to match the existing cross-device token_hash flow.
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        data: fullName ? { full_name: fullName } : undefined,
      },
    });

    if (error) {
      setError("Registrierung fehlgeschlagen. Bitte versuche es erneut.");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
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
          Registrieren
        </h1>
        <p className="text-sm mt-2" style={{ color: "var(--color-muted)" }}>
          {mode === "magic"
            ? "Kein Passwort — wir senden dir einen Anmelde-Link per E-Mail."
            : "Lege ein Konto mit E-Mail und Passwort an."}
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

      {sent ? (
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
            {mode === "magic"
              ? "Prüfe dein Postfach — der Link führt dich direkt in die Plattform."
              : "Bestätige deine E-Mail-Adresse über den Link, den wir dir gerade gesendet haben. Danach kannst du dich mit Passwort anmelden."}
          </p>
        </div>
      ) : mode === "magic" ? (
        <form onSubmit={handleMagicLink} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="min-h-[44px] px-3 rounded-lg text-sm"
              style={{
                border: "1px solid var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              placeholder="Max Mustermann"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              E-Mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="min-h-[44px] px-3 rounded-lg text-sm"
              style={{
                border: "1px solid var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              placeholder="name@beispiel.de"
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
            {loading ? "Wird gesendet..." : "Anmelde-Link senden"}
          </button>
        </form>
      ) : (
        <form onSubmit={handlePasswordSignup} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              className="min-h-[44px] px-3 rounded-lg text-sm"
              style={{
                border: "1px solid var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              placeholder="Max Mustermann"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              E-Mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
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
            <label className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="min-h-[44px] px-3 rounded-lg text-sm"
              style={{
                border: "1px solid var(--color-line)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              placeholder="Mindestens 8 Zeichen"
            />
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              Mindestens {MIN_PASSWORD_LENGTH} Zeichen.
            </p>
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
            {loading ? "Wird erstellt..." : "Konto erstellen"}
          </button>
        </form>
      )}

      <p className="text-center text-sm mt-4" style={{ color: "var(--color-muted)" }}>
        Bereits ein Konto?{" "}
        <Link href="/auth/anmelden" className="font-medium" style={{ color: "var(--color-accent)" }}>
          Anmelden
        </Link>
      </p>
    </div>
  );
}
