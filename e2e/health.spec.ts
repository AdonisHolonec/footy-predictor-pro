import { expect, test } from "@playwright/test";
import { ADMIN_CREDS, hasAdminCreds, hasCreds, loginViaUi } from "./helpers";

test.describe("health dashboard authorization", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("a regular account does NOT see the admin observatory", async ({ page }) => {
    await loginViaUi(page);

    await expect(page.getByText("Enterprise Monitoring")).toHaveCount(0);
    await expect(page.getByText("Performance Observatory", { exact: false })).toHaveCount(0);
  });

  test("an admin account reaches the Health dashboard", async ({ page }) => {
    test.skip(!hasAdminCreds, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not configured");
    await loginViaUi(page, ADMIN_CREDS);

    await page.getByText("Health", { exact: true }).first().click();
    await expect(page.getByText(/Health Dashboard/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/DEGRADED|HEALTHY|CRITICAL/i).first()).toBeVisible();
  });
});
