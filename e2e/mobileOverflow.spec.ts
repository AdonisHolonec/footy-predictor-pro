import { expect, test } from "@playwright/test";
import { accountReady, gotoWorkspace, hasCreds, openAccount } from "./helpers";
import { expectNoHorizontalOverflow } from "./overflowScan";

/**
 * The authenticated shell used to scroll sideways on a phone: at 390px the
 * document measured 442px on EVERY signed-in view. The cause was the trailing
 * toolbar tooltip ("Reîncarcă picks salvate…") — 256px wide, centred on a
 * trigger sitting at the right edge, so it overhung the viewport and dragged
 * the whole document with it.
 *
 * A phone-width viewport must never scroll horizontally. This asserts the
 * measurement directly rather than the fix, so any future element that
 * overhangs the right edge fails here too — whatever causes it.
 *
 * The scan itself lives in ./overflowScan, which also names the OTHER way a
 * document scrolls sideways: content painting outside a box that fits. Its own
 * regression tests are in overflowScan.spec.ts.
 */
test.use({ viewport: { width: 390, height: 844 } });

test.describe("mobile shell fits a 390px viewport", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("no authenticated view scrolls sideways at 390px", async ({ page }) => {
    await gotoWorkspace(page);
    await expectNoHorizontalOverflow(page, "home");

    // Profile is the mobile route to the rest of the app, and it carries the
    // longest content in the shell — worth measuring on its own. Reached via
    // the bottom tab: the shell's "Profil și upgrade" icon is desktop-only.
    // Account is the mobile route to the rest of the app and carries the
    // longest content in the shell, so it is worth measuring on its own.
    // "Profil" was retired with the old shell; "Cont" is in the primary nav
    // at 390px, so no bottom-tab special case is needed any more.
    await openAccount(page);
    await accountReady(page);
    await expectNoHorizontalOverflow(page, "account");
  });

  /*
    KNOWN PRODUCT-DECISION BLOCKER - not a stale selector.

    This test hovers the trailing toolbar's "Reincarca picks salvate" button and
    asserts its tooltip stays inside a 390px viewport. Verified against
    production on 2026-08-26: at 390x844 that button returns ZERO nodes, so the
    tooltip it guards has no subject to render from. The control was removed
    from the mobile toolbar; the regression this test was written for (PR that
    re-anchored an overhanging tooltip) can no longer occur there.

    Left intact rather than rewritten or deleted. Inventing a different button
    to hover would assert a different thing and silently drop the coverage this
    was buying. `fixme` (not `skip`) on purpose: skip is this suite's signal for
    "environment lacks credentials", and burying a product question in that
    bucket is how it would get forgotten.

    Resolve by deciding whether the mobile toolbar should regain a refresh
    control. If yes, this test returns as-is once it does. If no, retarget it at
    whichever tooltip the mobile shell still renders, or retire it deliberately.
  */
  test.fixme("the trailing toolbar tooltip stays inside the viewport when shown", async ({ page }) => {
    await gotoWorkspace(page);

    const refresh = page.getByRole("button", { name: /Reîncarcă picks salvate/ }).first();
    await refresh.hover();

    const tip = page.getByRole("tooltip").filter({ hasText: /Reîncarcă picks salvate/ }).first();
    const box = await tip.boundingBox();
    expect(box, "tooltip should still render — the fix re-anchors it, it does not remove it").not.toBeNull();
    expect(box!.x, "tooltip overhangs the left edge").toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, "tooltip overhangs the right edge").toBeLessThanOrEqual(390);
  });
});
