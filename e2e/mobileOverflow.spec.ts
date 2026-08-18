import { expect, test } from "@playwright/test";
import { gotoWorkspace, hasCreds } from "./helpers";
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
    await page.getByRole("button", { name: /^Profil$/ }).first().click();
    await expect(page.getByRole("heading", { name: /^Profil$/ }).first()).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page, "profile");
  });

  test("the trailing toolbar tooltip stays inside the viewport when shown", async ({ page }) => {
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
