import { expect, test } from "@playwright/test";
import { CREDS, hasCreds, loginViaUi, openProfile } from "./helpers";

test.describe("profile & account surface", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the shell shows the logged-in identity and the free tier", async ({ page }) => {
    await loginViaUi(page);

    // The shell surfaces who is logged in and on what plan — the two facts a
    // user needs to trust the workspace is really theirs.
    await expect(page.getByText(CREDS.email).first()).toBeVisible();
    await expect(page.getByText(/^free$/i).first()).toBeVisible();
  });

  test("the profile view exposes the subscription surface with both paid plans", async ({ page }) => {
    await loginViaUi(page);
    await openProfile(page);

    await expect(page.getByRole("heading", { name: /abonament/i }).first()).toBeVisible({
      timeout: 15_000
    });
    // Both paid tiers must be purchasable from here.
    await expect(page.getByRole("button", { name: /abonează-te premium/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /abonează-te ultra/i }).first()).toBeVisible();
    // And the escape hatch back out of a subscription must exist too.
    await expect(page.getByRole("button", { name: /deconectare/i }).first()).toBeVisible();
  });
});
