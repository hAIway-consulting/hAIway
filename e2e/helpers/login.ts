import { expect, type Page } from "@playwright/test";

// Resolves the dev-loop test user from TEST_CUSTOMER:
//   (unset)              → claude-tester           (core sandbox claude-test)
//   TEST_CUSTOMER=<slug> → claude-tester-<slug>    (sandbox claude-test-<slug>)
// The user must exist in the TEST_USERS map of /api/dev/test-login.
export function testUserKey(): string {
  const customer = process.env.TEST_CUSTOMER;
  return customer ? `claude-tester-${customer}` : "claude-tester";
}

export async function loginAsTester(page: Page, next = "/"): Promise<void> {
  const user = testUserKey();
  const response = await page.goto(
    `/api/dev/test-login?user=${encodeURIComponent(user)}&next=${encodeURIComponent(next)}`,
    { waitUntil: "domcontentloaded" },
  );
  expect(
    response?.status(),
    `test-login for "${user}" must succeed (404 = NODE_ENV != development, 401 = user missing — run setup-test-org)`,
  ).toBeLessThan(400);
}
