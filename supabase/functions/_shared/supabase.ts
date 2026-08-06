// Shared Supabase client for Edge Functions (service role — bypasses RLS)

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

let client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (client) return client;

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}

// JSON response helper
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Error response helper
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// Service-role gate for Edge Functions.
//
// verify_jwt=true only proves that SOME valid Supabase JWT was presented — the
// public anon key and every logged-in end user's token qualify. Functions that
// act on an arbitrary organization_id taken from the request body, and that do
// all their DB work through getServiceClient() (which bypasses RLS), must
// additionally prove that the caller IS the trusted server.
//
// Returns null when the caller is authorized, otherwise the Response the
// handler must return immediately.
export function requireServiceRole(req: Request): Response | null {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    console.error("[requireServiceRole] SUPABASE_SERVICE_ROLE_KEY not set");
    return errorResponse("server misconfigured", 500);
  }

  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!constantTimeEqual(token, serviceKey)) {
    return errorResponse("unauthorized", 401);
  }
  return null;
}

// Constant-time compare so a wrong token cannot be probed byte by byte.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
