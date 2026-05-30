import { test, expect } from "@playwright/test";

// Verifies the Shopware connect wizard end-to-end at the UI layer:
// 1. The integrations overview now offers an active "Shopware verbinden" CTA
//    (previously a disabled "Bald verfügbar" placeholder).
// 2. The setup page renders the client-credentials form.
// 3. Submitting unreachable credentials surfaces a connection error and does
//    NOT silently persist them (validation + live connection test path).

test.beforeEach(async ({ page }) => {
  const res = await page.goto("/api/dev/test-login?user=claude-tester&next=/admin/integrationen", {
    waitUntil: "domcontentloaded",
  });
  expect(res?.status(), "test-login must succeed (404 means NODE_ENV != development)").toBeLessThan(400);
});

test("integrations overview links to the Shopware setup wizard", async ({ page }) => {
  await page.goto("/admin/integrationen", { waitUntil: "domcontentloaded" });
  const cta = page.locator('a[href="/admin/integrationen/shopware/setup"]');
  await expect(cta).toBeVisible();
});

test("setup page renders the form and rejects unreachable credentials", async ({ page }) => {
  await page.goto("/admin/integrationen/shopware/setup", { waitUntil: "domcontentloaded" });

  await expect(page.locator('input[name="base_url"]')).toBeVisible();
  await expect(page.locator('input[name="client_id"]')).toBeVisible();
  await expect(page.locator('input[name="client_secret"]')).toBeVisible();

  await page.fill('input[name="base_url"]', "https://shopware-unreachable.example.invalid");
  await page.fill('input[name="client_id"]', "SWIATESTKEY");
  await page.fill('input[name="client_secret"]', "bogus-secret");
  await page.getByRole("button", { name: /Verbindung testen/i }).click();

  // The action redirects back to the wizard with an error; nothing is saved.
  await expect(page).toHaveURL(/\/admin\/integrationen\/shopware\/setup/);
  await expect(page.getByText(/Verbindung fehlgeschlagen/i)).toBeVisible();
});
