// Shopware App-System — confirmation endpoint (step 2 of the handshake).
//
// After a successful registration, Shopware POSTs the per-shop Admin-API
// credentials (apiKey/secretKey = client_id/client_secret) signed with the
// shop secret we minted in /register. We verify the signature, store the
// credentials per org, and flip the integration to active. From here the
// existing connector-shopware backend works unchanged.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/db/supabase-server";
import { isFreshTimestamp, verifyShopSignature } from "@/lib/shopware/app-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ShopwareConfig {
  shop_id?:     string;
  shop_url?:    string;
  shop_secret?: string;
}

interface ConfirmBody {
  apiKey?:    string;
  secretKey?: string;
  shopId?:    string;
  shopUrl?:   string;
  timestamp?: string | number;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("shopware-shop-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 });
  }

  let body: ConfirmBody;
  try {
    body = JSON.parse(rawBody) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { apiKey, secretKey, shopId, shopUrl, timestamp } = body;
  if (!apiKey || !secretKey || !shopId) {
    return NextResponse.json({ error: "missing apiKey/secretKey/shopId" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: row } = await db
    .from("organization_integrations")
    .select("organization_id, config")
    .eq("provider_id", "shopware")
    .eq("config->>shop_id", shopId)
    .maybeSingle<{ organization_id: string; config: ShopwareConfig }>();

  if (!row?.config?.shop_secret) {
    return NextResponse.json({ error: "no pending registration for this shop" }, { status: 404 });
  }

  if (timestamp !== undefined && !isFreshTimestamp(timestamp)) {
    return NextResponse.json({ error: "stale timestamp" }, { status: 401 });
  }
  if (!verifyShopSignature(rawBody, signature, row.config.shop_secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const baseUrl = String(shopUrl ?? row.config.shop_url ?? "").replace(/\/+$/, "");
  const { error } = await db
    .from("organization_integrations")
    .update({
      credentials:   { base_url: baseUrl, client_id: apiKey, client_secret: secretKey },
      status:        "active",
      error_message: null,
    })
    .eq("organization_id", row.organization_id)
    .eq("provider_id", "shopware");
  if (error) {
    return NextResponse.json({ error: "failed to persist credentials" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
