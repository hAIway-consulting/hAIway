import { test } from "@playwright/test";

// Schnell-Screenshot der neuen Workspace-Home als Max (role=member).
// Wird nicht im normalen Smoke-Lauf benötigt — gezielt über
// `npx playwright test e2e/screenshot-workspace.spec.ts` aufrufen.
test("workspace home screenshot — member persona", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=member&next=/", { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "test-results/workspace-home.png", fullPage: true });
});
