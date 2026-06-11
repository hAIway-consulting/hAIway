// Per-tenant AI provider keys (spec-cockpit.md §5.2/§16).
//
// Keys live encrypted in ai_provider_keys (deny-all RLS, service-role only).
// Encryption: app-side AES-256-GCM via WebCrypto — works identically in Next
// server actions and Deno edge functions; the env secret
// AI_KEYS_ENCRYPTION_SECRET is the key material. Losing the secret bricks
// stored keys; the env fallback chain keeps the platform alive.
//
// Resolution chain (spec §5.2): tenant key → platform key → env fallback.

import { createServiceClient } from "@/lib/db/supabase-server";
import { getOpenAIKeyForChat } from "@/lib/ai/embeddings";

const ALGO = "AES-GCM";
const IV_BYTES = 12;

async function cryptoKey(): Promise<CryptoKey> {
  const secret = process.env.AI_KEYS_ENCRYPTION_SECRET;
  if (!secret) throw new Error("AI_KEYS_ENCRYPTION_SECRET is not set");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, ALGO, false, ["encrypt", "decrypt"]);
}

/** Encrypts a raw provider key → base64(iv || ciphertext+tag). */
export async function encryptProviderKey(rawKey: string): Promise<string> {
  const key = await cryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    new TextEncoder().encode(rawKey),
  );
  const out = new Uint8Array(IV_BYTES + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), IV_BYTES);
  return Buffer.from(out).toString("base64");
}

export async function decryptProviderKey(encrypted: string): Promise<string> {
  const key = await cryptoKey();
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const cipher = buf.subarray(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

/** Last 4 chars for admin UI display — the raw key never reaches a browser. */
export function keyHint(rawKey: string): string {
  return rawKey.length > 4 ? `…${rawKey.slice(-4)}` : "…";
}

const ENV_FALLBACK: Record<string, () => string | undefined> = {
  anthropic: () => process.env.ANTHROPIC_API_KEY,
  openai:    () => getOpenAIKeyForChat(),
};

export interface ResolvedProviderKey {
  apiKey: string;
  /** where the key came from — drives admin display + debugging */
  source: "tenant" | "platform" | "env";
  constraints: Record<string, unknown>;
}

/**
 * Resolution chain: active tenant key → active platform key → env fallback.
 * Returns null when no key exists anywhere (caller decides availability).
 */
export async function resolveProviderKey(
  provider: string,
  orgId?: string,
): Promise<ResolvedProviderKey | null> {
  try {
    const db = createServiceClient();

    if (orgId) {
      const { data } = await db
        .from("ai_provider_keys")
        .select("encrypted_key, constraints")
        .eq("provider", provider)
        .eq("organization_id", orgId)
        .eq("status", "active")
        .maybeSingle();
      if (data?.encrypted_key) {
        return {
          apiKey: await decryptProviderKey(data.encrypted_key),
          source: "tenant",
          constraints: (data.constraints as Record<string, unknown>) ?? {},
        };
      }
    }

    const { data: platform } = await db
      .from("ai_provider_keys")
      .select("encrypted_key, constraints")
      .eq("provider", provider)
      .is("organization_id", null)
      .eq("status", "active")
      .maybeSingle();
    if (platform?.encrypted_key) {
      return {
        apiKey: await decryptProviderKey(platform.encrypted_key),
        source: "platform",
        constraints: (platform.constraints as Record<string, unknown>) ?? {},
      };
    }
  } catch (err) {
    // table missing (migration not pushed yet) or decryption issue → env
    console.error("[provider-keys] resolve failed, falling back to env:", err);
  }

  const envKey = ENV_FALLBACK[provider]?.();
  if (envKey) return { apiKey: envKey, source: "env", constraints: {} };
  return null;
}
