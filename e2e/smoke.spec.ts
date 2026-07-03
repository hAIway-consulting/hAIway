import { test, expect } from "@playwright/test";
import { loginAsTester } from "./helpers/login";

// Baseline smoke that proves the autonomous dev loop is wired up:
// 1. Dev-only test-login endpoint accepts the tester credential
//    (claude-tester, or claude-tester-<TEST_CUSTOMER> when set)
// 2. After login the middleware does not bounce us back to /auth/anmelden
// Per-feature specs should live next to this file (e.g. chat.spec.ts);
// customer-specific specs live in e2e/customers/<slug>/.

test("test-login endpoint logs in the tester and lands on /", async ({ page }) => {
  await loginAsTester(page, "/");
  await expect(page).toHaveURL(/\/$/);
  // Middleware would redirect anonymous users to /auth/anmelden — assert we did
  // not land there.
  await expect(page).not.toHaveURL(/\/auth\/anmelden/);
});
