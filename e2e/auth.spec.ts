import { expect, test } from "@playwright/test";
import { hasCreds, loginViaUi } from "./helpers";

test.describe("authentication", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("login lands in the workspace, logout returns to the public site", async ({ page }) => {
    await loginViaUi(page);

    const logout = page
      .getByRole("button", { name: /deconectare/i })
      .or(page.getByText("Deconectare"))
      .first();
    await logout.click();

    await expect(page.getByRole("link", { name: "Autentificare" }).first()).toBeVisible({
      timeout: 15_000
    });
  });
});
