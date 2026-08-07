import { test, devices } from "@playwright/test";

// Mobile-Screenshot der Workspace-Home auf iPhone-13-Größe.
test.use({ ...devices["iPhone 13"] });

test("workspace home mobile screenshot — member persona", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=member&next=/", { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "test-results/workspace-home-mobile.png", fullPage: true });
});
