import { test, expect } from "@playwright/test";

// Berater-Cockpit-Verwaltung (docs/spec-berater-dashboard.md §8):
// /admin/cockpit redirects to the Agenten tab and renders the two remaining
// section tabs for Berater (org admin/owner); members are bounced by the
// existing /admin layout gate.

test("berater lands on the Agenten tab with both tabs", async ({ page }) => {
  const response = await page.goto("/api/dev/test-login?user=claude-tester&next=/admin/cockpit", {
    waitUntil: "domcontentloaded",
  });
  expect(
    response?.status(),
    "test-login must succeed (404 means NODE_ENV != development)",
  ).toBeLessThan(400);

  // /admin/cockpit redirects to the default tab.
  await page.waitForURL(/\/admin\/cockpit\/agenten$/);
  await expect(page.getByRole("heading", { name: "Cockpit-Verwaltung" })).toBeVisible();

  // Both remaining tabs render (scoped by href).
  await expect(page.locator('a[href="/admin/cockpit/agenten"]')).toBeVisible();
  await expect(page.locator('a[href="/admin/cockpit/modelle"]')).toBeVisible();
});

test("member is redirected away from /admin/cockpit", async ({ page }) => {
  const response = await page.goto("/api/dev/test-login?user=max&next=/admin/cockpit", {
    waitUntil: "domcontentloaded",
  });
  expect(
    response?.status(),
    "test-login must succeed (404 means NODE_ENV != development)",
  ).toBeLessThan(400);

  // The /admin layout gate redirects non-admin members to /.
  await page.waitForURL((url) => !url.pathname.startsWith("/admin"));
  await expect(page).not.toHaveURL(/\/admin\/cockpit/);
});
