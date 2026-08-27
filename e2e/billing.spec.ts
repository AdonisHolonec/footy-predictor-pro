import { expect, test } from "@playwright/test";
import { gotoWorkspace, hasCreds, openAccount } from "./helpers";

/*
  Subscriptions are temporarily unavailable — a deliberate product gate
  (src/constants/featureGates.ts), not a billing outage and not an entitlement
  change. Stripe, the billing API and every paid tier are untouched behind it.

  This spec used to prove the opposite: that Premium was one click from a real
  checkout session. That contract is gone, so the interesting question became
  its mirror image — the gate must actually hold. A blurred overlay is easy to
  ship and easy to get subtly wrong: `disabled` can be missed on one of three
  buttons, and a control that still fires would sell a plan the product has
  deliberately stopped selling.

  The assertion therefore stays network-level in the same spirit as before,
  only inverted: driving the real UI must elicit NO billing call at all.
*/

test.describe("billing", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the availability gate blocks checkout, and no billing call escapes", async ({ page }) => {
    await gotoWorkspace(page);

    // Armed before the account route paints, so a call fired during mount is
    // caught too — not just one provoked by the click below.
    const billingCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/billing")) billingCalls.push(`${r.method()} ${r.url()}`);
    });

    await openAccount(page);

    // The section is still there. Removing it would have been the easy fix and
    // the wrong one: people expect their plan controls to exist.
    const card = page.getByTestId("subscription-card");
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Deliberately NOT aria-disabled. The card is a plain div — role
    // `generic`, which does not support the attribute — and marking it
    // disabled leaked onto the support CTA inside it. See profile.spec.
    await expect(card).not.toHaveAttribute("aria-disabled", /.*/);

    // Its content is unavailable: hidden from assistive technology and visibly
    // blurred. `aria-hidden` is the half that actually blocks the section —
    // blur is decoration a screen reader cannot see.
    const content = page.getByTestId("subscription-content");
    await expect(content).toHaveAttribute("aria-hidden", "true");
    await expect(content).toHaveClass(/blur-/);
    await expect(page.getByTestId("subscription-gate")).toBeVisible();

    /*
      The three billing controls, addressed by accessible name.

      `includeHidden` is not a convenience here, it is the point: these buttons
      sit inside the aria-hidden subtree, so they are deliberately absent from
      the accessibility tree and a plain getByRole would report "not found" for
      a button that is still very much on the page. Asserting them this way
      proves the stronger thing — each control still EXISTS, still carries its
      real label, and is disabled — rather than merely that it vanished.
    */
    const byName = (name: RegExp) => page.getByRole("button", { name, includeHidden: true }).first();
    const premium = byName(/abonează-te premium/i);
    const ultra = byName(/abonează-te ultra/i);
    const portal = byName(/gestionează facturarea/i);

    await expect(premium).toBeDisabled();
    await expect(ultra).toBeDisabled();
    await expect(portal).toBeDisabled();

    /*
      The negative assertion, and the reason this spec still earns its place.

      A real mouse click, at the real coordinates of the Premium control: the
      overlay sits above it and the button is disabled underneath, so nothing
      should reach a handler by either route.

      We deliberately do NOT dispatchEvent() straight at the element. That
      bypasses both defences at once, and if the gate ever regressed it would
      open a genuine Stripe session against production — a smoke test must
      never be the thing that charges someone.
    */
    const box = await premium.boundingBox();
    expect(box, "the Premium control must still occupy space in the card").not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    // Absence is the claim, so it needs a settle window rather than something
    // to await: a leaked handler would reach the network well inside this.
    await page.waitForTimeout(2_000);

    expect(billingCalls, "a disabled billing control still reached /api/billing").toEqual([]);
    await expect(page).toHaveURL(/\/workspace\/account/);

    // The click may have landed on the support CTA in the middle of the
    // overlay. Leave the page as we found it either way.
    await page.keyboard.press("Escape");
  });
});
