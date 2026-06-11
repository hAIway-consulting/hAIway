import { test, expect } from "@playwright/test";

// Customer automations page (spec-cockpit.md §10): login via the dev-only
// test-login endpoint, then assert the page renders with the saved-time KPI
// header. Works without the foundation migration applied — listAutomations
// falls back to the legacy registry (minutesSavedPerRun = 0 → "—").

test("automatisierungen page renders the saved-time KPI", async ({ page }) => {
  const response = await page.goto(
    "/api/dev/test-login?user=claude-tester&next=/automatisierungen",
    { waitUntil: "domcontentloaded" },
  );
  expect(
    response?.status(),
    "test-login must succeed (404 means NODE_ENV != development)",
  ).toBeLessThan(400);
  await expect(page).toHaveURL(/\/automatisierungen$/);
  await expect(page).not.toHaveURL(/\/auth\/anmelden/);
  await expect(page.getByText("Eingesparte Zeit").first()).toBeVisible();
});
