// Verify Vapi webhook authentication via the shared serverUrlSecret.
//
// Vapi sends the configured `serverUrlSecret` as a plaintext header
// (`x-vapi-secret`, with `x-vapi-signature` as a legacy fallback).
// We compare it against VAPI_SECRET using a constant-time comparison.
//
// SECURITY: the phone-assistant functions run with `verify_jwt = false`
// (config.toml) because Vapi calls them as a plain webhook without a Supabase
// token. This secret is therefore the ONLY thing standing between the public
// internet and an endpoint that reads an organisation's knowledge base and
// books calendar appointments.
//
// This check used to return `true` when VAPI_SECRET was unset ("dev mode").
// That fail-open default is what turned a missing secret into an open door:
// the 2026-08-06 audit found VAPI_SECRET absent from the production project
// while both webhooks were live. The default is now fail-closed.
//
// Local development: set VAPI_SECRET in supabase/functions/.env, or — only if
// you really want to run without it — set VAPI_ALLOW_UNVERIFIED=true. That
// escape hatch is deliberately explicit so it cannot be reached by omission.

export async function verifyVapiSignature(
  _body: string,
  headerValue: string | null,
): Promise<boolean> {
  const secret = Deno.env.get("VAPI_SECRET");

  if (!secret) {
    if (Deno.env.get("VAPI_ALLOW_UNVERIFIED") === "true") {
      console.warn(
        "[vapi-verify] VAPI_SECRET not set and VAPI_ALLOW_UNVERIFIED=true — " +
          "accepting an UNVERIFIED webhook. Never do this outside local development.",
      );
      return true;
    }
    console.error(
      "[vapi-verify] VAPI_SECRET is not set — rejecting the webhook. " +
        "Set it via `supabase secrets set VAPI_SECRET=…` and make sure the same " +
        "value is configured as serverUrlSecret on the Vapi assistant.",
    );
    return false;
  }

  if (!headerValue) {
    console.error("[vapi-verify] Missing Vapi secret header");
    return false;
  }

  const match = timingSafeEqual(headerValue, secret);
  if (!match) {
    console.error("[vapi-verify] Secret header mismatch");
  }
  return match;
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
