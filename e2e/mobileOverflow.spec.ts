import { expect, test, type Page } from "@playwright/test";
import { gotoWorkspace, hasCreds } from "./helpers";

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
 */
test.use({ viewport: { width: 390, height: 844 } });

/** Nothing inside #root may extend past the viewport on a 390px screen. */
async function expectNoHorizontalOverflow(page: Page, view: string) {
  // Browser globals are reached through globalThis on purpose: e2e/ is linted
  // with node globals and `no-undef` deliberately left ON (eslint.config.js),
  // and this body runs in the page, not in Node.
  const result = await page.evaluate(() => {
    const doc = globalThis.document;
    const de = doc.documentElement;
    const vw = globalThis.innerWidth;
    const offenders: string[] = [];
    // Whole document, not just #root: overlays render in #overlay-root, which is
    // a sibling. A scan rooted at #root can report "no offenders" while the page
    // is visibly scrolling sideways — which is exactly what the post-merge smoke
    // did on 2026-08-18, leaving a red run with nothing to act on.
    for (const el of Array.from(doc.querySelectorAll("body *"))) {
      const r = el.getBoundingClientRect();
      // Only skip boxes that render nothing at all. A zero-HEIGHT element can be
      // arbitrarily wide and still scroll the document, so height alone is never
      // a reason to ignore one.
      if (r.width === 0 && r.height === 0) continue;
      // Fixed chrome is positioned against the viewport and does not expand the
      // document's scrollable area.
      if (globalThis.getComputedStyle(el).position === "fixed") continue;
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push(
          `${el.tagName.toLowerCase()} [${Math.round(r.left)}→${Math.round(r.right)}] ` +
            `${Math.round(r.width)}x${Math.round(r.height)} ` +
            `"${(el.textContent || "").trim().slice(0, 40)}" .${(el.className || "").toString().slice(0, 60)}`
        );
      }
    }
    // body.scrollWidth is the fallback clue for the case the rules above still
    // fail to explain: it says whether the overflow lives in the page at all.
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      bodyScrollWidth: doc.body.scrollWidth,
      offenders
    };
  });

  // The offender list is asserted first: when this regresses it names the
  // element, which a bare width comparison never would.
  expect(result.offenders, `${view}: element(s) overhang the 390px viewport`).toEqual([]);
  expect(
    result.scrollWidth,
    `${view}: document scrolls horizontally with no element overhanging — ` +
      `documentElement ${result.scrollWidth}/${result.clientWidth}, body ${result.bodyScrollWidth}`
  ).toBe(result.clientWidth);
}

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
