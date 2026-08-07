import { test, expect } from "@playwright/test";

// History sidebar in the Cockpit (spec §2): the conversation history lives in
// the Cockpit (left sidebar with mode tabs), not on the overview page.

test("member sees the history sidebar with mode tabs in the cockpit", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=member&next=/chat", {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(/\/chat\//);

  const tablist = page.getByRole("tablist", { name: "Verlauf filtern" });
  await expect(tablist).toBeVisible();
  await expect(tablist.getByRole("tab", { name: "Alle" })).toBeVisible();
  await expect(tablist.getByRole("tab", { name: "Chat" })).toBeVisible();
});

test("overview no longer lists the history, only the cockpit link", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=member&next=/", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Cockpit-Verlauf öffnen")).toBeVisible();
  await expect(page.getByText("Alle öffnen")).toHaveCount(0);
});
