import { test, expect } from "@playwright/test";

// Saved agents (docs/spec-cockpit.md §9). Until the foundation migration is
// pushed, the workspace home falls back to the four STUB_AGENTS — this spec
// asserts the tile grid renders and that a tile click starts a conversation.
// Uses the "max" persona (member role) because only members see the
// Workspace-Home with agent tiles.

test("workspace home renders agent tiles and a click starts a conversation", async ({ page }) => {
  // The tile click runs the full send pipeline server-side before redirecting.
  test.setTimeout(120_000);

  const response = await page.goto("/api/dev/test-login?user=max&next=/", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status(), "test-login must succeed (404 means NODE_ENV != development)").toBeLessThan(400);
  await expect(page).not.toHaveURL(/\/auth\/anmelden/);

  // At least one agent tile renders (stub fallback pre-migration, DB rows after).
  const tile = page.getByRole("button", { name: /Angebot entwerfen/ });
  await expect(tile).toBeVisible();

  // One-click start: the tile posts to the start action and redirects to the
  // new conversation. Without ANTHROPIC_API_KEY the German error/fallback
  // bubble inside the chat is acceptable — we only assert the navigation.
  await tile.click();
  await page.waitForURL(/\/chat\//, { timeout: 90_000 });
  await expect(page).toHaveURL(/\/chat\//);
});
