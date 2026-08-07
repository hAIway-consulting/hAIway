import { test } from "@playwright/test";

// Screenshots der drei Persona-Dashboards. Wird über
// `npx playwright test e2e/screenshot-personas.spec.ts` aufgerufen.

test("workspace home — member persona (Max)", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=member&next=/", { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "test-results/persona-workspace.png", fullPage: true });
});

test("berater overview — admin persona (claude-tester)", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=claude-tester&next=/", { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "test-results/persona-berater.png", fullPage: true });
});
