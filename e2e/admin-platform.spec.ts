import { test, expect } from "@playwright/test";

// Security gate for the cross-tenant platform views (admin spec §7):
// claude-tester is an ORG admin (role 'admin' in the claude-test sandbox)
// but NOT a platform admin. The soft /admin layout gate lets org admins
// through — the new platform pages enforce their own STRICT
// profiles.is_platform_admin check and must redirect everyone else to /.

const PLATFORM_ADMIN_PAGES = [
  "/admin/ai-keys",
  "/admin/ai-kosten",
];

for (const target of PLATFORM_ADMIN_PAGES) {
  test(`strict gate: org admin is redirected from ${target} to /`, async ({ page }) => {
    const response = await page.goto(
      `/api/dev/test-login?user=claude-tester&next=${encodeURIComponent(target)}`,
      { waitUntil: "domcontentloaded" },
    );
    expect(
      response?.status(),
      "test-login must succeed (404 means NODE_ENV != development)",
    ).toBeLessThan(400);

    // The strict page gate must bounce the org admin to the root — never
    // render the cross-tenant view.
    await expect(page).toHaveURL(/\/$/);
    await expect(page).not.toHaveURL(new RegExp(target.replaceAll("/", "\\/")));
  });
}
