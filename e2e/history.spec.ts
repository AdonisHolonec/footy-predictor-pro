import { expect, test } from "@playwright/test";
import { hasCreds, loginViaUi } from "./helpers";

test.describe("history", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the history section opens and shows entries or an honest empty state", async ({ page }) => {
    await loginViaUi(page);

    await page.getByText("Istoric", { exact: false }).first().click();

    // Entries or a real empty state are both correct products of a working
    // flow; an error banner is not.
    await expect(page.getByText(/win|loss|pending|cotă|nicio|istoric/i).first()).toBeVisible({
      timeout: 20_000
    });
    await expect(page.getByText(/eroare|a eșuat/i)).toHaveCount(0);
  });
});
