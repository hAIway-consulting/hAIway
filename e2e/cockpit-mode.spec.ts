import { test, expect } from "@playwright/test";

// Chat/Agent mode toggle (docs/spec-cockpit.md §12). The toggle only renders
// when the agent_mode flag is seeded AND a provider is configured — until the
// foundation migration is pushed this spec asserts the regression baseline
// (chat keeps working) and exercises the toggle conditionally.

test("chat conversation page renders with composer", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=claude-tester&next=/chat", {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(/\/chat\//);
  await expect(page.locator("textarea, input[placeholder*='Frage']").first()).toBeVisible();
});

test("mode toggle (when available) starts a new agent conversation with badge", async ({ page }) => {
  await page.goto("/api/dev/test-login?user=claude-tester&next=/chat", {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(/\/chat\//);

  const agentButton = page.getByRole("button", { name: "Agent", exact: true });
  const available = await agentButton.isVisible().catch(() => false);
  test.skip(!available, "agent_mode flag not seeded yet (foundation migration pending)");

  const before = page.url();
  await agentButton.click();
  await page.waitForURL((url) => url.toString() !== before);
  await expect(page.getByText("Agent", { exact: true }).first()).toBeVisible();
});
