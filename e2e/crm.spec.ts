import { test, expect, type Page } from "@playwright/test";

// CRM (Twenty) end-to-end against the sandbox org's mock integration
// (base_url mock://twenty, wired by scripts/dev-loop/setup-test-org.mjs).
// Covers: no-access state -> grant via /admin/crm -> invited badge ->
// reconcile -> synced -> revoke (cleanup).
//
// Self-skipping: until the crm_workspace migrations are pushed, /crm
// redirects to / (feature flag off) and the suite skips.

const TESTER_EMAIL = "claude-tester@bernwald.net";

async function login(page: Page, next: string) {
  const response = await page.goto(`/api/dev/test-login?user=claude-tester&next=${next}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBeLessThan(400);
}

function testerRow(page: Page) {
  return page.locator("li", { hasText: TESTER_EMAIL }).first();
}

async function setLevel(page: Page, level: string) {
  const row = testerRow(page);
  await row.locator('select[name="level"]').selectOption(level);
  await row.getByRole("button", { name: /Übernehmen|Synchronisiere/ }).click();
  await page.waitForLoadState("networkidle");
}

test.describe.serial("CRM access lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "/crm");
    if (!page.url().includes("/crm")) {
      test.skip(true, "crm_workspace feature not enabled — push the crm migrations first");
    }
  });

  test("without a grant the launch page shows the no-access card", async ({ page }) => {
    // Ensure a clean start: revoke any leftover grant from earlier runs.
    await page.goto("/admin/crm");
    const row = testerRow(page);
    if (await row.locator('select[name="level"]').isVisible()) {
      const current = await row.locator('select[name="level"]').inputValue();
      if (current !== "none") await setLevel(page, "none");
    }

    await page.goto("/crm");
    await expect(page.getByText("Kein CRM-Zugriff")).toBeVisible();
  });

  test("granting a level invites the member and reconcile syncs it", async ({ page }) => {
    await page.goto("/admin/crm");
    await expect(page.getByRole("heading", { name: "CRM-Zugänge (Twenty)" })).toBeVisible();
    await expect(page.getByText("Verbunden").first()).toBeVisible();

    await setLevel(page, "member");
    await expect(testerRow(page).getByText("Einladung offen")).toBeVisible();

    // Launch page now shows the pending state instead of the no-access card.
    await page.goto("/crm");
    await expect(page.getByText("Einladung offen")).toBeVisible();
    await expect(page.getByText("Test-Modus (mock)")).toBeVisible();

    // Reconcile finalizes the mock invitation.
    await page.goto("/admin/crm");
    await page.getByRole("button", { name: /Jetzt abgleichen|Gleiche ab/ }).click();
    await page.waitForLoadState("networkidle");
    await expect(testerRow(page).getByText("Synchronisiert")).toBeVisible();

    await page.goto("/crm");
    await expect(page.getByText("Zugriff aktiv")).toBeVisible();
  });

  test("revoking removes access again (cleanup)", async ({ page }) => {
    await page.goto("/admin/crm");
    await setLevel(page, "none");

    await page.goto("/crm");
    await expect(page.getByText("Kein CRM-Zugriff")).toBeVisible();
  });
});
