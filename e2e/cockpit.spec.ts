import { test, expect } from "@playwright/test";

// Cockpit rename + search removal (docs/spec-cockpit.md §1, §4):
// 1. The workspace nav shows "hAIway Cockpit" instead of "Chats" and no
//    "Suchen" entry anymore.
// 2. The old /search route permanently redirects into the Cockpit (/chat)
//    so existing bookmarks keep working.

test("workspace nav shows hAIway Cockpit and no search entry", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=member&next=/", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/auth\/anmelden/);

  const nav = page.locator("nav").first();
  await expect(nav.getByText("hAIway Cockpit")).toBeVisible();
  await expect(nav.getByText("Suchen", { exact: true })).toHaveCount(0);
});

test("/search redirects into the cockpit", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=member&next=/search", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/chat/);
});
