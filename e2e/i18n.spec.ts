import { expect, test } from "@playwright/test";
import { gotoWorkspace, hasCreds } from "./helpers";

test.describe("language switch", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the RO/EN toggle actually re-languages the workspace", async ({ page }) => {
    await gotoWorkspace(page);

    await page.getByRole("button", { name: "EN", exact: true }).first().click();
    // The Predict button's accessible name is the i18n contract under test.
    await expect(
      page.getByRole("button", { name: /generate predictions/i }).first()
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "RO", exact: true }).first().click();
    await expect(
      page.getByRole("button", { name: /generează predicții/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
