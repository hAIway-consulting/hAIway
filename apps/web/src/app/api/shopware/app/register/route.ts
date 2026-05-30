// Shopware App-System — registration endpoint (step 1 of the handshake).
//
// Shopware calls this GET with shop-id / shop-url / timestamp and signs the
// query string with the app secret. We verify, map the one-time `claim` token
// back to an organization, mint a per-shop secret, persist it, and return the
// proof + secret + confirmation_url. The shop credentials themselves arrive
// later at /confirm.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/db/supabase-server";
import { getAppUrl } from "@/lib/app-url";
import {
  appSecret,
  buildProof,
  generateShopSecret,
  isFreshTimestamp,
  verifyRegistrationSignature,
} from "@/lib/shopware/app-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ShopwareConfig {
  provisioning?: string;
  claim_token?:  string;
  shop_id?:      string;
  shop_url?:     string;
  shop_secret?:  string;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const queryString = url.search.startsWith("?") ? url.search.slice(1) : url.search;

  const signature = request.headers.get("shopware-app-signature");
  const shopId    = url.searchParams.get("shop-id");
  const shopUrl   = url.searchParams.get("shop-url");
  const timestamp = url.searchParams.get("timestamp");
  const claim     = url.searchParams.get("claim");

  if (!signature || !shopId || !shopUrl || !timestamp || !claim) {
    return NextResponse.json({ error: "missing registration parameters" }, { status: 400 });
  }

  // Fail clearly if the platform app secret is not configured.
  try {
    appSecret();
  } catch {
    return NextResponse.json({ error: "shopware app not configured on the platform" }, { status: 500 });
  }

  if (!isFreshTimestamp(timestamp)) {
    return NextResponse.json({ error: "stale timestamp" }, { status: 401 });
  }
  if (!verifyRegistrationSignature(queryString, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const db = createServiceClient();
  const { data: row } = await db
    .from("organization_integrations")
    .select("organization_id, config")
    .eq("provider_id", "shopware")
    .eq("config->>claim_token", claim)
    .maybeSingle<{ organization_id: string; config: ShopwareConfig }>();

  if (!row) {
    return NextResponse.json({ error: "unknown claim token" }, { status: 404 });
  }

  const shopSecret = generateShopSecret();
  const nextConfig: ShopwareConfig = {
    ...(row.config ?? {}),
    provisioning: "app_system",
    claim_token:  claim,
    shop_id:      shopId,
    shop_url:     shopUrl,
    shop_secret:  shopSecret,
  };

  const { error: upErr } = await db
    .from("organization_integrations")
    .update({ config: nextConfig, status: "configuring", error_message: null })
    .eq("organization_id", row.organization_id)
    .eq("provider_id", "shopware");
  if (upErr) {
    return NextResponse.json({ error: "failed to persist registration" }, { status: 500 });
  }

  const appUrl = await getAppUrl();
  return NextResponse.json({
    proof:            buildProof(shopId, shopUrl),
    secret:           shopSecret,
    confirmation_url: `${appUrl}/api/shopware/app/confirm`,
  });
}
