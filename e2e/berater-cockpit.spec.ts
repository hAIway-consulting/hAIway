import { test, expect } from "@playwright/test";

// Berater-Cockpit-Verwaltung (docs/spec-berater-dashboard.md §8):
// /admin/cockpit redirects to the Automatisierungen tab and renders the four
// section tabs for Berater (org admin/owner); members are bounced by the
// existing /admin layout gate.

test("berater lands on the Automatisierungen tab with all four tabs", async ({ page }) => {
  const response = await page.goto("/api/dev/test-login?user=claude-tester&next=/admin/cockpit", {
    waitUntil: "domcontentloaded",
  });
  expect(
    response?.status(),
    "test-login must succeed (404 means NODE_ENV != development)",
  ).toBeLessThan(400);

  // /admin/cockpit redirects to the default tab.
  await page.waitForURL(/\/admin\/cockpit\/automatisierungen$/);
  await expect(page.getByRole("heading", { name: "Cockpit-Verwaltung" })).toBeVisible();

  // All four tabs render (scoped by href — "Automatisierungen" also exists in
  // the sidebar under /admin/automatisierungen).
  await expect(page.locator('a[href="/admin/cockpit/skills"]')).toBeVisible();
  await expect(page.locator('a[href="/admin/cockpit/automatisierungen"]')).toBeVisible();
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
