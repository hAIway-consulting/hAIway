import { test } from "@playwright/test";

// Schnell-Screenshot der Chat-Detail-Seite im Workspace-Look (Max).
test("workspace chat detail screenshot — member persona", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=member&next=/chat", { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  // Wir sind auf /chat (redirect zu jüngster Konversation oder leerer Stub)
  await page.screenshot({ path: "test-results/workspace-chat.png", fullPage: false });
});
