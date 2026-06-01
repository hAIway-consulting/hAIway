// Shopware App-System — per-org manifest download.
//
// Generates the manifest.xml the merchant uploads into their shop. The
// registrationUrl carries a one-time `claim` token so the inbound handshake
// (which only knows shop-id/shop-url) can be mapped back to this org. Calling
// this endpoint (re)creates the pending claim row; it never clobbers already
// active credentials (e.g. from the manual wizard fallback).

import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db/org-context";
import { createServiceClient } from "@/lib/db/supabase-server";
import { getAppUrl } from "@/lib/app-url";
import { appName, appSecret, generateClaimToken } from "@/lib/shopware/app-signature";
import { createStoredZip } from "@/lib/shopware/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ShopwareConfig {
  provisioning?: string;
  claim_token?:  string;
  [k: string]: unknown;
}

function buildManifest(opts: { name: string; secret: string; registrationUrl: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://raw.githubusercontent.com/shopware/shopware/trunk/src/Core/Framework/App/Manifest/Schema/manifest-3.0.xsd">
    <meta>
        <name>${opts.name}</name>
        <label>hAIway Orchestrator</label>
        <label lang="de-DE">hAIway Orchestrator</label>
        <description>Verbindet diesen Shop mit der hAIway-Plattform.</description>
        <author>hAIway</author>
        <copyright>(c) hAIway</copyright>
        <version>1.0.0</version>
        <license>proprietary</license>
    </meta>
    <setup>
        <registrationUrl>${opts.registrationUrl}</registrationUrl>
        <secret>${opts.secret}</secret>
    </setup>
    <permissions>
        <read>order</read>
        <read>customer</read>
        <create>order_return</create>
    </permissions>
</manifest>
`;
}

export async function GET(request: Request) {
  const orgId = await requireOrgId();

  try {
    appSecret();
  } catch (err) {
    // Surface the precise reason (missing vs. too short) in both the response
    // and the runtime logs — the previous generic message hid which it was.
    const reason = err instanceof Error ? err.message : "SHOPWARE_APP_SECRET unavailable";
    console.error("[shopware] manifest blocked:", reason);
    return NextResponse.json({ error: reason }, { status: 500 });
  }

  const db = createServiceClient();
  const { data: existing } = await db
    .from("organization_integrations")
    .select("config, status")
    .eq("organization_id", orgId)
    .eq("provider_id", "shopware")
    .maybeSingle<{ config: ShopwareConfig; status: string }>();

  // Reuse an existing claim so a re-download keeps the same manifest valid.
  const claim = existing?.config?.claim_token ?? generateClaimToken();
  const nextConfig: ShopwareConfig = { ...(existing?.config ?? {}), provisioning: "app_system", claim_token: claim };

  if (existing) {
    // Never downgrade an already-active connection to pending.
    const nextStatus = existing.status === "active" ? existing.status : "pending";
    await db
      .from("organization_integrations")
      .update({ config: nextConfig, status: nextStatus })
      .eq("organization_id", orgId)
      .eq("provider_id", "shopware");
  } else {
    await db.from("organization_integrations").insert({
      organization_id: orgId,
      provider_id:     "shopware",
      status:          "pending",
      credential_mode: "customer",
      config:          nextConfig,
    });
  }

  const appUrl = await getAppUrl();
  const registrationUrl = `${appUrl}/api/shopware/app/register?claim=${claim}`;
  const name = appName();
  const xml = buildManifest({ name, secret: appSecret(), registrationUrl });

  // `?format=xml` returns the raw manifest for inspection/testing. The default
  // download is the upload-ready ZIP: Shopware needs `<AppName>/manifest.xml`
  // inside an archive, not a bare manifest.xml ("No manifest.xml found").
  if (new URL(request.url).searchParams.get("format") === "xml") {
    return new NextResponse(xml, {
      headers: {
        "Content-Type":  "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const zip = createStoredZip([
    { name: `${name}/`, data: Buffer.alloc(0) },
    { name: `${name}/manifest.xml`, data: Buffer.from(xml, "utf8") },
  ]);

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type":        "application/zip",
      "Content-Disposition": `attachment; filename="${name}.zip"`,
      "Cache-Control":       "no-store",
    },
  });
}
