"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Wordmark } from "./wordmark";
import type { OrgBranding } from "@/lib/db/queries/organization";

type WorkspaceShellProps = {
  children: ReactNode;
  branding?: OrgBranding;
  userName?: string | null;
  userEmail?: string | null;
  /** Optionaler Hinweis-Tag in der Top-Bar — Org-Name beim Berater oder "Intern" bei HAIway. */
  contextLabel?: string | null;
  /** Link zu den Organisationseinstellungen im Profil-Dropdown — null blendet den Eintrag aus. */
  orgSettingsHref?: string | null;
  /**
   * Persona-spezifische Sidebar-Navigation. Desktop: dauerhaft links.
   * Mobile: als Drawer von links — geöffnet via Hamburger in der Top-Bar.
   */
  sidebar?: ReactNode;
};

/**
 * Universelle Top-Bar-Shell mit optionaler Sidebar (Desktop) +
 * Mobile-Drawer. Wird von allen drei Personas genutzt — Inhalt und
 * Navigation steuern die Caller.
 */
export function WorkspaceShell({
  children,
  branding,
  userName,
  userEmail,
  contextLabel,
  orgSettingsHref,
  sidebar,
}: WorkspaceShellProps) {
  const displayName = branding?.displayName ?? "hAIway";
  const shortName = branding?.shortName ?? "HA";
  // Custom-branded orgs without their own logo keep the shortName badge.
  const logoUrl = branding ? branding.logoUrl : "/brand/logo-tile.png";
  const cleanedName = userName ? userName.replace(/^\[[^\]]+\]\s*/, "").trim() : null;
  const initials = cleanedName ? initialsOf(cleanedName) : "?";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ background: "var(--color-bg)" }}>
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 md:px-6"
        style={{
          height: "var(--header-h)",
          borderBottom: "1px solid var(--color-line-soft)",
          background: "color-mix(in srgb, var(--color-panel) 88%, transparent)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {sidebar && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Navigation öffnen"
              className="md:hidden inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg shrink-0"
              style={{ color: "var(--color-text)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant logo URLs can be external; next/image would require remotePatterns per host
              <img
                src={logoUrl}
                alt={displayName}
                width={32}
                height={32}
                className="w-8 h-8 rounded-xl shrink-0"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-bold gradient-accent shrink-0"
                style={{ color: "var(--color-accent-text)" }}
              >
                {shortName}
              </div>
            )}
            <Wordmark
              name={displayName}
              className="text-[15px] font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
            />
            {contextLabel && (
              <span
                className="hidden sm:inline-flex items-center px-2 py-0.5 ml-1 rounded-full text-[10px] font-semibold uppercase tracking-widest truncate"
                style={{
                  background: "var(--color-bg-elevated)",
                  color: "var(--color-muted)",
                  border: "1px solid var(--color-line-soft)",
                }}
              >
                {contextLabel}
              </span>
            )}
          </Link>
        </div>

        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Profilmenü öffnen"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg"
            >
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold"
                style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
              >
                {initials}
              </span>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 w-64 rounded-2xl p-1.5 shadow-lg"
                  style={{
                    background: "var(--color-panel)",
                    border: "1px solid var(--color-line)",
                  }}
                >
                  <div className="px-3 py-2.5">
                    <p
                      className="text-sm font-semibold truncate"
                      style={{ color: "var(--color-text)" }}
                    >
                      {cleanedName ?? "Profil"}
                    </p>
                    {userEmail && (
                      <p className="text-xs truncate mt-0.5" style={{ color: "var(--color-muted)" }}>
                        {userEmail}
                      </p>
                    )}
                  </div>
                  <div style={{ borderTop: "1px solid var(--color-line-soft)" }} />
                  {orgSettingsHref && (
                    <Link
                      href={orgSettingsHref}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 min-h-[44px] px-3 rounded-lg text-sm"
                      style={{ color: "var(--color-text)" }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
                      </svg>
                      Organisationseinstellungen
                    </Link>
                  )}
                  <form action="/auth/abmelden" method="POST">
                    <button
                      type="submit"
                      role="menuitem"
                      className="flex items-center gap-2.5 w-full min-h-[44px] px-3 rounded-lg text-sm"
                      style={{ color: "var(--color-muted)" }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Abmelden
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-w-0">
        {/* Desktop sidebar */}
        {sidebar && (
          <aside
            className="hidden md:flex shrink-0 flex-col sticky top-[var(--header-h)] self-start h-[calc(100dvh-var(--header-h))] overflow-y-auto"
            style={{
              width: "var(--sidebar-w)",
              borderRight: "1px solid var(--color-line-soft)",
              background: "var(--color-panel)",
            }}
          >
            {sidebar}
          </aside>
        )}

        {/* Mobile drawer */}
        {sidebar && drawerOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.4)" }}
              onClick={() => setDrawerOpen(false)}
            />
            <aside
              className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-72 flex flex-col overflow-y-auto animate-slide-in-left"
              style={{
                background: "var(--color-panel)",
                borderRight: "1px solid var(--color-line-soft)",
              }}
              onClick={() => setDrawerOpen(false)}
            >
              {sidebar}
            </aside>
          </>
        )}

        <main className="flex-1 min-w-0 pb-[env(safe-area-inset-bottom)]">{children}</main>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const cleaned = name.replace(/^\[[^\]]+\]\s*/, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
