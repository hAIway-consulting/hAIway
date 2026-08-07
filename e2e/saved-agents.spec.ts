import { test, expect } from "@playwright/test";

// Saved agents (docs/spec-cockpit.md §9). The agent tiles come exclusively
// from the `saved_agents` table — the seed in the migration
// 20260611122000_cockpit_flags_and_seeds.sql is a precondition for this spec.
// Uses the "member" persona (sandbox, member role) because only members see the
// Workspace-Home with agent tiles.

test("workspace home renders agent tiles and a click starts a conversation", async ({ page }) => {
  // The tile click runs the full send pipeline server-side before redirecting.
  test.setTimeout(120_000);

  const response = await page.goto("/api/dev/test-login?user=member&next=/", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status(), "test-login must succeed (404 means NODE_ENV != development)").toBeLessThan(400);
  await expect(page).not.toHaveURL(/\/auth\/anmelden/);

  // Fail loudly with a readable message when the seed is missing instead of
  // running into a bare selector timeout.
  await expect(
    page.getByText("Noch keine Agenten hinterlegt"),
    "saved_agents seed missing — run the migrations against the test DB",
  ).toHaveCount(0);

  // At least one agent tile renders (seeded saved_agents row).
  const tile = page.getByRole("button", { name: /Angebot entwerfen/ });
  await expect(tile).toBeVisible();

  // One-click start: the tile posts to the start action and redirects to the
  // new conversation. Without ANTHROPIC_API_KEY the German error/fallback
  // bubble inside the chat is acceptable — we only assert the navigation.
  await tile.click();
  await page.waitForURL(/\/chat\//, { timeout: 90_000 });
  await expect(page).toHaveURL(/\/chat\//);
});
