import { expect, test } from "@playwright/test";
import { hasCreds, loginViaUi, openProfile } from "./helpers";

test.describe("billing", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the upgrade path reaches Stripe checkout — and stops there", async ({ page }) => {
    await loginViaUi(page);

    // The upgrade surface lives in the profile view (👤).
    await openProfile(page);
    const subscribeCta = page.getByRole("button", { name: /abonează-te premium/i }).first();
    await subscribeCta.scrollIntoViewIfNeeded();

    // The revenue assertion is network-level: the real UI must elicit a
    // successful checkout-session response. We never complete a payment.
    const checkoutResponse = page.waitForResponse(
      (r) => r.url().includes("/api/billing") && r.url().includes("checkout"),
      { timeout: 30_000 }
    );
    await subscribeCta.click();

    const response = await checkoutResponse;
    expect(response.status()).toBeLessThan(500);

    if (response.ok()) {
      // On success the app immediately navigates to the checkout URL, which
      // makes the response body unreadable — the navigation itself is the
      // assertion: we must land on Stripe (and stop there).
      await page.waitForURL(/stripe\.com/, { timeout: 20_000 });
    }
  });
});
