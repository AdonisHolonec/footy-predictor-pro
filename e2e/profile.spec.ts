import { expect, test } from "@playwright/test";
import { CREDS, gotoWorkspace, hasCreds, openAccount } from "./helpers";

test.describe("profile & account surface", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the shell shows the logged-in identity and the free tier", async ({ page }) => {
    await gotoWorkspace(page);

    // The shell surfaces who is logged in and on what plan — the two facts a
    // user needs to trust the workspace is really theirs. Both come from the
    // profile fetch, which lands after the shell paints, so the default 5s
    // expect timeout races a cold serverless call (CI, 2026-08-10).
    // The redesign moved BOTH facts out of the persistent shell onto
    // /workspace/account, so this asserts them where the product now shows
    // them rather than where it once did.
    await openAccount(page);
    await expect(page.getByText(CREDS.email).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^free$/i).first()).toBeVisible({ timeout: 15_000 });
  });

  /*
    Subscriptions are temporarily unavailable behind a product gate, so this
    test asserts the gated contract rather than the purchasable one it was
    written for.

    The distinction it has to keep straight: the gate suspends BUYING a plan.
    It is not entitlement and it does not downgrade anyone — the tier shown
    above stays the account's real tier, and both paid plans are still
    presented here. What changed is that none of it can be acted on.
  */
  test("the profile view still presents both paid plans, gated and inert", async ({ page }) => {
    await gotoWorkspace(page);
    await openAccount(page);

    // Gated, not deleted — the section keeps its heading. It lives inside the
    // aria-hidden wrapper, so it needs includeHidden for the same reason the
    // controls below do: absent from the accessibility tree, present on the
    // page, and that is precisely what we mean to assert.
    await expect(
      page.getByRole("heading", { name: /abonament/i, includeHidden: true }).first()
    ).toBeVisible({ timeout: 15_000 });

    // Both paid tiers are still PRESENTED. The product did not stop offering
    // Premium and Ultra; it stopped selling them for the moment.
    const content = page.getByTestId("subscription-content");
    await expect(content).toContainText(/premium/i);
    await expect(content).toContainText(/ultra/i);

    // ...and neither can be bought right now, nor billing self-managed.
    const byName = (name: RegExp) => page.getByRole("button", { name, includeHidden: true }).first();
    await expect(byName(/abonează-te premium/i)).toBeDisabled();
    await expect(byName(/abonează-te ultra/i)).toBeDisabled();
    await expect(byName(/gestionează facturarea/i)).toBeDisabled();

    // The explanation the user is actually left with.
    const gate = page.getByTestId("subscription-gate");
    await expect(gate).toBeVisible();
    await expect(gate).toContainText(/indisponibil/i);

    /*
      The one thing the user CAN still do, and the only control in this card
      that has to stay reachable. Queried through the accessibility tree on
      purpose — unlike everything above, it must be findable there.

      `toBeEnabled()` is the assertion that matters, and it is not redundant
      with the attribute checks below it. The gate shipped with
      aria-disabled="true" on the card, and because ARIA-aware consumers treat
      a disabled ancestor as disabling its descendants, this CTA was announced
      as unavailable while its own attributes looked perfectly correct. An
      element-only assertion passed the entire time it was broken; this one did
      not, which is how the defect surfaced.
    */
    const supportCta = page.getByRole("button", { name: /contactează administratorul/i }).first();
    await expect(supportCta).toBeEnabled();
    await expect(supportCta).not.toHaveAttribute("disabled", /.*/);

    // Walking up is the part an element-scoped check cannot do.
    const ctaState = await supportCta.evaluate((el) => ({
      insideAriaDisabled: Boolean(el.closest("[aria-disabled='true']")),
      insideAriaHidden: Boolean(el.closest("[aria-hidden='true']")),
      tabIndex: (el as { tabIndex: number }).tabIndex
    }));
    expect(ctaState.insideAriaDisabled).toBe(false);
    // Inside the aria-hidden region it would be unreachable outright, rather
    // than merely mislabelled — a worse bug than the one above.
    expect(ctaState.insideAriaHidden).toBe(false);
    expect(ctaState.tabIndex).toBe(0);

    // Reachable by keyboard, which is exactly what the disabled controls
    // around it deliberately skip.
    await supportCta.focus();
    await expect(supportCta).toBeFocused();

    /*
      The intended path out of the gate: unavailable → contact the
      administrator → the support dialog the app already had. No new route, no
      new endpoint, no mailto. We open it and stop there — the message is never
      filled in and never sent.
    */
    await supportCta.click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(/raportează o problemă/i);

    // Closed again, so this leaves nothing behind for the assertions after it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // And the escape hatch back out of a subscription must exist too.
    await expect(page.getByRole("button", { name: /deconectare/i }).first()).toBeVisible();
  });
});
