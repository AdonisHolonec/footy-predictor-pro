import { expect, test } from "@playwright/test";
import { CREDS, gotoWorkspace, hasCreds, openProfile } from "./helpers";

test.describe("profile & account surface", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the shell shows the logged-in identity and the free tier", async ({ page }) => {
    await gotoWorkspace(page);

    // The shell surfaces who is logged in and on what plan — the two facts a
    // user needs to trust the workspace is really theirs. Both come from the
    // profile fetch, which lands after the shell paints, so the default 5s
    // expect timeout races a cold serverless call (CI, 2026-08-10).
    await expect(page.getByText(CREDS.email).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^free$/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("the profile view exposes the subscription surface with both paid plans", async ({ page }) => {
    await gotoWorkspace(page);
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
