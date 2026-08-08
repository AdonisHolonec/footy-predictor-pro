import { expect, test } from "@playwright/test";
import { gotoWorkspace, hasCreds } from "./helpers";

test.describe("history", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the history section renders entries or an honest empty state", async ({ page }) => {
    await gotoWorkspace(page);

    // The board's "Istoric & Încredere" block exposes an "Istoric" control —
    // that is the user's route into their history.
    const historyButton = page.getByRole("button", { name: "Istoric", exact: true }).first();
    await historyButton.scrollIntoViewIfNeeded();
    await historyButton.click();

    // Entries or a real empty state are both correct products of a working
    // flow; an error banner is not.
    await expect(page.getByText(/win|loss|pending|cotă|nicio|istoric/i).first()).toBeVisible({
      timeout: 20_000
    });
    await expect(page.getByText(/eroare|a eșuat/i)).toHaveCount(0);
  });
});
