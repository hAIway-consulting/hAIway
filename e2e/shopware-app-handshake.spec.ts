import { test, expect, type APIRequestContext } from "@playwright/test";
import crypto from "node:crypto";

// Exercises the full Shopware App-System registration handshake without a real
// shop: the test plays Shopware, computing the same HMAC signatures Shopware
// would. It proves register + confirm verify signatures correctly, map the
// claim/shop back to the org, and flip the integration to active.

const SHOP_ID = "claude-test-shop-001";
const SHOP_URL = "https://claude-test-shop.example.com";

function hmac(message: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

async function fetchManifest(request: APIRequestContext): Promise<{ appSecret: string; appName: string; claim: string }> {
  // `?format=xml` returns the raw manifest; the default download is a ZIP.
  const res = await request.get("/api/shopware/app/manifest?format=xml");
  expect(res.status(), "manifest download must succeed (SHOPWARE_APP_SECRET set?)").toBe(200);
  const xml = await res.text();
  const appSecret = xml.match(/<secret>([^<]+)<\/secret>/)?.[1];
  const appName   = xml.match(/<name>([^<]+)<\/name>/)?.[1];
  const regUrl    = xml.match(/<registrationUrl>([^<]+)<\/registrationUrl>/)?.[1];
  expect(appSecret, "manifest must contain <secret>").toBeTruthy();
  expect(appName, "manifest must contain <name>").toBeTruthy();
  const claim = regUrl ? new URL(regUrl).searchParams.get("claim") : null;
  expect(claim, "registrationUrl must carry a claim token").toBeTruthy();
  return { appSecret: appSecret!, appName: appName!, claim: claim! };
}

test.beforeEach(async ({ page }) => {
  const res = await page.goto("/api/dev/test-login?user=claude-tester&next=/admin/integrationen", {
    waitUntil: "domcontentloaded",
  });
  expect(res?.status(), "test-login must succeed (404 means NODE_ENV != development)").toBeLessThan(400);
});

test("manifest download exposes registrationUrl with a claim token", async ({ page }) => {
  const { claim } = await fetchManifest(page.request);
  expect(claim.length).toBeGreaterThan(20);
});

test("default download is an upload-ready ZIP with <AppName>/manifest.xml", async ({ page }) => {
  const { appName } = await fetchManifest(page.request);
  const res = await page.request.get("/api/shopware/app/manifest");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/zip");
  expect(res.headers()["content-disposition"]).toContain(".zip");

  const buf = await res.body();
  // ZIP local-file-header magic: bytes 80 75 3 4 (the "PK" signature).
  expect([...buf.subarray(0, 4)]).toEqual([80, 75, 3, 4]);
  // Manifest must sit inside a root folder named after the app — a bare
  // manifest.xml at the archive root is what Shopware rejects.
  expect(buf.includes(Buffer.from(`${appName}/manifest.xml`, "utf8"))).toBe(true);
});

test("full handshake: register + confirm flips the integration to active", async ({ page }) => {
  const { appSecret, appName, claim } = await fetchManifest(page.request);
  const ts = Math.floor(Date.now() / 1000).toString();

  // --- Step 1: registration (Shopware → us). Sign the exact query string. ---
  const qs = `claim=${claim}&shop-id=${SHOP_ID}&shop-url=${encodeURIComponent(SHOP_URL)}&timestamp=${ts}`;
  const regRes = await page.request.get(`/api/shopware/app/register?${qs}`, {
    headers: { "shopware-app-signature": hmac(qs, appSecret) },
  });
  expect(regRes.status(), "register must accept a valid signature").toBe(200);
  const reg = await regRes.json() as { proof: string; secret: string; confirmation_url: string };

  // proof = HMAC(shopId + shopUrl + appName, appSecret)
  expect(reg.proof).toBe(hmac(`${SHOP_ID}${SHOP_URL}${appName}`, appSecret));
  expect(reg.secret.length).toBeGreaterThanOrEqual(64);
  expect(reg.confirmation_url).toContain("/api/shopware/app/confirm");

  // --- Step 2: confirmation (Shopware → us). Sign the raw body with shop secret. ---
  const body = JSON.stringify({ apiKey: "SWIATESTKEYID", secretKey: "test-secret-access-key", shopId: SHOP_ID, shopUrl: SHOP_URL, timestamp: ts });
  const confirmRes = await page.request.post("/api/shopware/app/confirm", {
    headers: { "shopware-shop-signature": hmac(body, reg.secret), "content-type": "application/json" },
    data: body,
  });
  expect(confirmRes.status(), "confirm must accept a valid shop signature").toBe(200);

  // --- Step 3: the org's Shopware integration is now active. ---
  await page.goto("/admin/integrationen/shopware/app", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Shopware ist über das App-System verbunden", { exact: false })).toBeVisible();
  await expect(page.getByText(SHOP_URL, { exact: false })).toBeVisible();
});

test("register rejects an invalid signature", async ({ page }) => {
  const { claim } = await fetchManifest(page.request);
  const ts = Math.floor(Date.now() / 1000).toString();
  const qs = `claim=${claim}&shop-id=${SHOP_ID}&shop-url=${encodeURIComponent(SHOP_URL)}&timestamp=${ts}`;
  const res = await page.request.get(`/api/shopware/app/register?${qs}`, {
    headers: { "shopware-app-signature": "deadbeef".repeat(8) },
  });
  expect(res.status()).toBe(401);
});
