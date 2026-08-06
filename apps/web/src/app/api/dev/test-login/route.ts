import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

// Dev-only test-login endpoint used by the Claude autonomous dev loop and
// Playwright smoke tests. Hard-disabled outside development — production
// returns 404 even if the file ships.

// Test users for local persona validation. These are real accounts in a real
// Supabase project, so the credentials live ONLY in the environment
// (apps/web/.env.local, gitignored) — the code carries variable names, never
// values. There are deliberately NO defaults: a missing variable produces a 503
// instead of silently falling back to a well-known password.
//
//  claude-tester  → role 'admin' in claude-test sandbox  → persona "berater"
//  max            → role 'member' in time-keeper prod    → persona "workspace"
//  anna           → role 'member' in time-keeper prod    → persona "workspace"
const TEST_USER_ENV = {
  "claude-tester": {
    email: "TEST_LOGIN_CLAUDE_TESTER_EMAIL",
    password: "TEST_LOGIN_CLAUDE_TESTER_PASSWORD",
  },
  max: {
    email: "TEST_LOGIN_MAX_EMAIL",
    password: "TEST_LOGIN_MAX_PASSWORD",
  },
  anna: {
    email: "TEST_LOGIN_ANNA_EMAIL",
    password: "TEST_LOGIN_ANNA_PASSWORD",
  },
} as const;

type TestUserKey = keyof typeof TEST_USER_ENV;

function isTestUserKey(key: string): key is TestUserKey {
  return key in TEST_USER_ENV;
}

function readCredentials(key: TestUserKey): { email: string; password: string } | null {
  const names = TEST_USER_ENV[key];
  const email = process.env[names.email];
  const password = process.env[names.password];
  if (!email || !password) return null;
  return { email, password };
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const userParam = request.nextUrl.searchParams.get("user") ?? "claude-tester";
  if (!isTestUserKey(userParam)) {
    return NextResponse.json(
      { error: `unknown test user "${userParam}"`, available: Object.keys(TEST_USER_ENV) },
      { status: 400 },
    );
  }

  const credentials = readCredentials(userParam);
  if (!credentials) {
    return NextResponse.json(
      {
        error: `test user "${userParam}" is not configured`,
        hint: `set ${TEST_USER_ENV[userParam].email} and ${TEST_USER_ENV[userParam].password} in apps/web/.env.local`,
      },
      { status: 503 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  const { error } = await supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });

  if (error) {
    return NextResponse.json({ error: error.message, user: userParam }, { status: 401 });
  }

  const next = request.nextUrl.searchParams.get("next") ?? "/";
  return NextResponse.redirect(new URL(next, request.url));
}
