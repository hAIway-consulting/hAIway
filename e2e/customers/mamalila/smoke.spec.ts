import { test, expect } from "@playwright/test";
import { loginAsTester } from "../../helpers/login";

// mamalila sandbox smoke — runs only in the mamalila dev loop:
//   TEST_CUSTOMER=mamalila DEV_PORT=$(node scripts/dev-loop/dev-port.mjs) \
//     npx playwright test e2e/smoke.spec.ts e2e/customers/mamalila
// Requires the claude-test-mamalila sandbox org + tester
// (scripts/dev-loop/setup-test-org.mjs --customer mamalila).

test.skip(
  process.env.TEST_CUSTOMER !== "mamalila",
  "customer spec — set TEST_CUSTOMER=mamalila to run",
);

test("mamalila tester logs in and reaches the workspace", async ({ page }) => {
  await loginAsTester(page, "/");
  await expect(page).not.toHaveURL(/\/auth\/anmelden/);
});

test("mamalila tester reaches quellen (org-scoped data loads)", async ({ page }) => {
  await loginAsTester(page, "/quellen");
  await expect(page).toHaveURL(/\/quellen/);
  await expect(page).not.toHaveURL(/\/auth\/anmelden/);
});
