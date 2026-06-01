// Shopware App-System registration handshake — signature helpers.
//
// Shopware authenticates the registration handshake with HMAC-SHA256:
//   - Registration request (Shopware → us): header `shopware-app-signature`
//     is HMAC(queryString, APP_SECRET). We re-sign the full received query
//     string, exactly like shopware/app-php-sdk does.
//   - Registration response (us → Shopware): we return `proof` =
//     HMAC(shopId + shopUrl + appName, APP_SECRET) plus a freshly generated
//     per-shop secret.
//   - Confirmation request (Shopware → us): header `shopware-shop-signature`
//     is HMAC(rawBody, shopSecret) — signed with the secret we just handed out.
//
// APP_SECRET is the platform-wide app secret embedded in the manifest's
// <setup><secret>. It never leaves the server.

import crypto from "node:crypto";

const DEFAULT_APP_NAME = "hAIwayOrchestrator";

export function appName(): string {
  return process.env.SHOPWARE_APP_NAME || DEFAULT_APP_NAME;
}

export function appSecret(): string {
  const secret = process.env.SHOPWARE_APP_SECRET;
  if (!secret) {
    // Most common cause: the env var was added on Vercel AFTER this deployment
    // was built — env vars are baked in at deploy time, so a fresh redeploy is
    // required for an existing deployment to see a newly added variable.
    throw new Error("SHOPWARE_APP_SECRET is not set on this deployment (add it on Vercel, then redeploy)");
  }
  if (secret.length < 16) {
    throw new Error(`SHOPWARE_APP_SECRET is too short (${secret.length} chars; need at least 16)`);
  }
  return secret;
}

function hmacSha256Hex(message: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

// Constant-time comparison of two hex strings of equal length.
function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Verify the `shopware-app-signature` header against the raw query string. */
export function verifyRegistrationSignature(queryString: string, signature: string): boolean {
  return timingSafeEqualHex(hmacSha256Hex(queryString, appSecret()), signature);
}

/** proof = HMAC-SHA256(shopId + shopUrl + appName, APP_SECRET). */
export function buildProof(shopId: string, shopUrl: string): string {
  return hmacSha256Hex(`${shopId}${shopUrl}${appName()}`, appSecret());
}

/** A random per-shop secret (Shopware requires 64–255 chars). */
export function generateShopSecret(): string {
  return crypto.randomBytes(48).toString("hex"); // 96 hex chars
}

/** A random one-time claim token used to map a shop install back to an org. */
export function generateClaimToken(): string {
  return crypto.randomBytes(24).toString("hex"); // 48 hex chars
}

/** Verify the `shopware-shop-signature` header against the raw request body. */
export function verifyShopSignature(rawBody: string, signature: string, shopSecret: string): boolean {
  return timingSafeEqualHex(hmacSha256Hex(rawBody, shopSecret), signature);
}

/** Reject stale timestamps to blunt replay attacks. Shopware sends unix seconds. */
export function isFreshTimestamp(ts: string | number | null | undefined, toleranceSec = 300): boolean {
  if (ts === null || ts === undefined) return false;
  const t = typeof ts === "string" ? Number.parseInt(ts, 10) : ts;
  if (!Number.isFinite(t)) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - t) <= toleranceSec;
}
