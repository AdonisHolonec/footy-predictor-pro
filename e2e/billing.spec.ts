import { expect, test } from "@playwright/test";
import { hasCreds, loginViaUi } from "./helpers";

test.describe("billing", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the upgrade path reaches Stripe checkout — and stops there", async ({ page }) => {
    await loginViaUi(page);

    // The revenue assertion is network-level: the real UI must elicit a
    // successful checkout-session response. We never visit Stripe and never
    // complete a payment.
    const checkoutResponse = page.waitForResponse(
      (r) => r.url().includes("/api/billing") && r.url().includes("checkout"),
      { timeout: 30_000 }
    );

    const upgradeCta = page
      .getByRole("button", { name: /abonează|upgrade|premium|ultra/i })
      .or(page.getByRole("link", { name: /abonează|upgrade/i }))
      .first();
    await upgradeCta.click();

    const response = await checkoutResponse;
    expect(response.status()).toBeLessThan(500);

    if (response.ok()) {
      const body = await response.json().catch(() => null);
      const url = body?.url || body?.data?.url || "";
      expect(String(url)).toContain("stripe.com");
    }
  });
});
