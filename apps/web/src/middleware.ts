import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { pathname, searchParams } = request.nextUrl;

  // Magic-Link safety net: Supabase sometimes redirects with `?code=...` to
  // the bare Site URL (e.g. `/?code=xxx`) instead of `/auth/callback?code=xxx`,
  // depending on the Additional Redirect URLs config. Forward any `?code=`
  // arriving outside the callback route to the handler so the session can be
  // exchanged — otherwise the user lands on `/`, middleware sees no session
  // yet, and bounces them to /auth/anmelden.
  const hasOtpCode = searchParams.has("code");
  const isCallbackPath =
    pathname === "/auth/callback" || pathname.startsWith("/auth/callback/");
  if (hasOtpCode && !isCallbackPath) {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/callback";
    // Preserve original destination as `next` so the callback can return users
    // to where the deep-link pointed.
    if (!searchParams.has("next") && pathname !== "/") {
      target.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(target);
  }

  // Same safety net for the token_hash flow (preferred over PKCE for magic
  // links because it works across devices and browsers — no code_verifier
  // required). Forward `?token_hash=...&type=...` to /auth/confirm.
  const hasTokenHash = searchParams.has("token_hash");
  const isConfirmPath = pathname === "/auth/confirm";
  if (hasTokenHash && !isConfirmPath) {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/confirm";
    if (!searchParams.has("next") && pathname !== "/") {
      target.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(target);
  }

  // Dev-only test-login endpoint must bypass the auth gate so it can run the
  // sign-in itself. The route handler hard-disables outside development.
  if (pathname.startsWith("/api/dev/")) {
    return supabaseResponse;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isDedicated = process.env.INSTANCE_MODE === "dedicated";

  // OAuth callback routes must always pass through, regardless of auth state
  const isOAuthCallback = pathname.startsWith("/auth/callback/");

  // Magic-link exchange routes must run even if the user is (still) logged in
  // — e.g. reusing a link should not bounce them back to `/` before the token
  // has been verified/rotated.
  const isAuthExchange =
    pathname === "/auth/callback" || pathname === "/auth/confirm";

  // Logout route must always pass through — otherwise middleware redirects the
  // POST to `/` before the handler can clear the session cookie.
  const isLogout = pathname === "/auth/abmelden";

  // Not authenticated → redirect to login (except auth pages)
  if (!user && !pathname.startsWith("/auth")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/anmelden";
    return NextResponse.redirect(url);
  }

  // Authenticated but on auth pages → redirect to home (but never on OAuth
  // callbacks, magic-link exchanges, or the logout handler).
  if (
    user &&
    pathname.startsWith("/auth") &&
    !isOAuthCallback &&
    !isAuthExchange &&
    !isLogout
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Dedicated mode: block admin and onboarding routes
  if (isDedicated && (pathname.startsWith("/admin") || pathname.startsWith("/onboarding"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
