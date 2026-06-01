// Resolve the base URL of the currently running deployment.
//
// Why this exists:
//   On Vercel Preview deployments the URL changes per branch. If OAuth
//   redirect_uris are built from a hardcoded NEXT_PUBLIC_APP_URL pointing
//   at production, the OAuth provider redirects the user back to production
//   after consent and the preview never receives the code → login loop.
//
// Resolution order:
//
//   In `next dev` (NODE_ENV === "development"):
//     1. Request headers (`x-forwarded-host` / `host`) — always wins. Lets
//        the user run on any port/host without changing config; ignores any
//        NEXT_PUBLIC_APP_URL the user might have pulled from Vercel.
//     2. localhost:3000 fallback (when no request context exists).
//
//   In Vercel preview / production:
//     1. NEXT_PUBLIC_APP_URL — explicit override for Custom-Domains.
//     2. Request headers — works for branch previews without configuration.
//     3. VERCEL_URL — auto-injected by Vercel (no protocol, prefix https://).
//     4. localhost fallback.
//
//   This split prevents a common foot-gun: `vercel env pull` brings the
//   Production NEXT_PUBLIC_APP_URL into the local `.env.local`, which then
//   builds OAuth redirect_uris pointing at production while the user is on
//   localhost. Result: login loop. Headers in dev mode sidestep that.

import { headers } from "next/headers";

const isDev = process.env.NODE_ENV === "development";

async function fromHeaders(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return null;
    const proto =
      h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

function fromVercelUrl(): string | null {
  const vercel = process.env.VERCEL_URL;
  if (vercel && vercel.length > 0) return `https://${vercel}`;
  return null;
}

function fromExplicit(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/$/, "");
  return null;
}

/**
 * Async — preferred in Server Actions and Route Handlers. Returns the URL
 * the user is currently visiting, even when running locally on a non-default
 * port (worktrees, parallel dev servers).
 */
export async function getAppUrl(): Promise<string> {
  if (isDev) {
    const fromReq = await fromHeaders();
    if (fromReq) return fromReq;
    return "http://localhost:3000";
  }

  // Prod/Preview: explicit > headers > VERCEL_URL > localhost.
  return fromExplicit() ?? (await fromHeaders()) ?? fromVercelUrl() ?? "http://localhost:3000";
}

/**
 * Synchronous fallback for places without a request context (cron-job
 * scaffolding, build-time constants). Skips header lookup; if you have a
 * request, prefer `getAppUrl()`.
 */
export function getAppUrlSync(): string {
  return fromExplicit() ?? fromVercelUrl() ?? "http://localhost:3000";
}
