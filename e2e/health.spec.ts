import { expect, test } from "@playwright/test";
import { ADMIN_STATE, gotoWorkspace, hasAdminCreds, hasCreds } from "./helpers";

test.describe("health dashboard authorization", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("a regular account does NOT see the admin observatory", async ({ page }) => {
    await gotoWorkspace(page);

    await expect(page.getByText("Enterprise Monitoring")).toHaveCount(0);
    await expect(page.getByText("Performance Observatory", { exact: false })).toHaveCount(0);
  });
});

test.describe("admin health dashboard", () => {
  test.use({ storageState: ADMIN_STATE });
  test.skip(!hasAdminCreds, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not configured");

  test("an admin account reaches the Health dashboard", async ({ page }) => {
    await gotoWorkspace(page);

    await page.getByText("Health", { exact: true }).first().click();
    await expect(page.getByText(/Health Dashboard/i).first()).toBeVisible({ timeout: 20_000 });
    // The health bundle loads async; the tri-state status or its loaded
    // metrics are both proof the dashboard actually rendered data.
    await expect(
      page.getByText(/degraded|healthy|critical|latency|uptime/i).first()
    ).toBeVisible({ timeout: 20_000 });
  });
});
