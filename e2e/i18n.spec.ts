import { expect, test } from "@playwright/test";
import { gotoWorkspace, hasCreds, setLanguage } from "./helpers";

test.describe("language switch", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the RO/EN toggle actually re-languages the workspace", async ({ page }) => {
    await gotoWorkspace(page);

    // The RO/EN controls are no longer global - they live on the account
    // route, which is why the old workspace-level toggle found nothing.
    await setLanguage(page, "EN");
    // The Predict button's accessible name is the i18n contract under test.
    await expect(
      page.getByRole("button", { name: /generate predictions/i }).first()
    ).toBeVisible({ timeout: 15_000 });

    await setLanguage(page, "RO");
    await expect(
      page.getByRole("button", { name: /generează predicții/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
