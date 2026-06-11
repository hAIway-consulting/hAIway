"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/db/supabase-browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // Supabase appends `?code=…` to this URL. The existing /auth/callback
      // route exchanges the code for a session, then redirects to `next`.
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/passwort-zuruecksetzen`,
    });

    if (error) {
      setError("Versand fehlgeschlagen. Bitte prüfe die E-Mail-Adresse und versuche es erneut.");
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
          Passwort zurücksetzen
        </h1>
        <p className="text-sm mt-2" style={{ color: "var(--color-muted)" }}>
          Wir senden dir einen Link, mit dem du ein neues Passwort setzen kannst.
        </p>
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
            Prüfe dein Postfach — der Link führt dich auf eine Seite, auf der du ein neues
            Passwort vergibst.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            {loading ? "Wird gesendet..." : "Reset-Link senden"}
          </button>
        </form>
      )}

      <p className="text-center text-sm mt-4" style={{ color: "var(--color-muted)" }}>
        <Link href="/auth/anmelden" className="font-medium" style={{ color: "var(--color-accent)" }}>
          Zurück zur Anmeldung
        </Link>
      </p>
    </div>
  );
}
