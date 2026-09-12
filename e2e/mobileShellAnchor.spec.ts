import { expect, test, type Page } from "@playwright/test";
import { gotoWorkspace, hasCreds } from "./helpers";
import { scanHorizontalOverflow } from "./overflowScan";

/**
 * The mobile shell must be IMPOSSIBLE to drag sideways, and the top bar must
 * stay anchored when it is tried.
 *
 * mobileOverflow.spec.ts already asserts that the document is not WIDER than a
 * 390px viewport. This asserts the two things that width check cannot see:
 *
 *   1. whether the page can be scrolled horizontally AT ALL — the width check
 *      passes on the one viewport it measures, and a document that overflows
 *      only at 320 or 430 is invisible to it;
 *   2. whether the TOP BAR rides along when it happens. The bar is
 *      `sticky top-0`, which anchors only on the scroll container's block axis:
 *      a sticky box still translates with horizontal scroll. The bottom nav is
 *      `fixed inset-x-0`, anchored on BOTH axes, which is why users see the
 *      bottom bar hold still while the top bar slides away.
 *
 * Horizontal scroll is provoked with `scrollTo`, not a synthetic swipe: a drag
 * measures the gesture plumbing, whereas the defect is whether a horizontal
 * scroll POSITION is reachable at all. If `scrollX` cannot leave 0, no swipe,
 * fling or trackpad gesture can move the page either.
 */

/** Widths a phone actually reports: small Android, iPhone, Pro Max. */
const PHONE_WIDTHS = [320, 390, 430] as const;

type Anchor = {
  view: string;
  width: number;
  innerWidth: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  /** How far the page can be scrolled sideways; 0 means it cannot. */
  maxScrollX: number;
  /** `window.scrollX` after asking for 500px of horizontal scroll. */
  scrolledX: number;
  /** The top bar's left edge after that attempt; 0 means it held. */
  headerLeft: number;
  headerPosition: string;
  /** The bottom nav's left edge after that attempt, for comparison. */
  navLeft: number | null;
  navPosition: string | null;
  offenders: string[];
  inkOverflow: string[];
};

/**
 * Asks for horizontal scroll and reports what the shell did about it.
 * Restores the scroll position so the next measurement starts clean.
 */
async function measureAnchor(page: Page, view: string, width: number): Promise<Anchor> {
  const scan = await page.evaluate(scanHorizontalOverflow);
  const measured = await page.evaluate(() => {
    const doc = globalThis.document;
    const de = doc.documentElement;
    const header = doc.querySelector("header");
    const bottomNav = doc.querySelector("nav.fixed");
    const maxScrollX = de.scrollWidth - de.clientWidth;
    globalThis.scrollTo(500, globalThis.scrollY);
    const scrolledX = globalThis.scrollX;
    const headerRect = header ? header.getBoundingClientRect() : null;
    const navRect = bottomNav ? bottomNav.getBoundingClientRect() : null;
    const out = {
      innerWidth: globalThis.innerWidth,
      documentScrollWidth: de.scrollWidth,
      documentClientWidth: de.clientWidth,
      maxScrollX,
      scrolledX,
      headerLeft: headerRect ? Math.round(headerRect.left) : NaN,
      headerPosition: header ? globalThis.getComputedStyle(header).position : "none",
      navLeft: navRect ? Math.round(navRect.left) : null,
      navPosition: bottomNav ? globalThis.getComputedStyle(bottomNav).position : null
    };
    globalThis.scrollTo(0, globalThis.scrollY);
    return out;
  });
  return {
    view,
    width,
    ...measured,
    offenders: scan.offenders,
    inkOverflow: scan.inkOverflow
  };
}

/**
 * Every route the mobile shell can reach, by slug (see appNav.ts). Reached by
 * URL rather than by clicking the nav: a label change must not silently reduce
 * this to the two views the earlier scan happened to cover, which is how the
 * reported overflow stayed unmeasured.
 */
const ROUTES = [
  "today",
  "matches",
  "results",
  "performance",
  "account",
  "tickets",
  "notifications",
  "settings"
] as const;

/**
 * The zoom bound, asserted on the served document — no account needed, because
 * the tag is in index.html and is identical on every route.
 *
 * This is a CONFIGURATION assertion, and deliberately so: a browser's pinch
 * scale is not reachable from Playwright (setViewportSize changes the layout
 * viewport, which is a different thing), so the behaviour it buys — a page that
 * cannot be shrunk below its own width and panned — cannot be driven here. The
 * companion measurement, that nothing overflows AT scale 1, is the credentialed
 * test below.
 */
test.describe("the served document cannot be zoomed below fit width", () => {
  test("viewport meta clamps zoom-out without restricting zoom-in", async ({ page }) => {
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content, "no viewport meta on the served document").toBeTruthy();

    const directives = new Map(
      (content || "").split(",").map((part) => {
        const [key, value = ""] = part.split("=");
        return [key.trim().toLowerCase(), value.trim().toLowerCase()];
      })
    );

    expect(directives.get("width"), "the layout viewport must follow the device").toBe("device-width");
    expect(
      Number(directives.get("minimum-scale")),
      `minimum-scale must clamp at 1 or the page can be shrunk below its own width and panned — got "${content}"`
    ).toBe(1);

    // Accessibility: clamping zoom-OUT is the fix; clamping zoom-IN is a WCAG
    // 1.4.4 failure. Anyone reaching for these to "fix" zoom has gone too far.
    expect(directives.has("maximum-scale"), "maximum-scale would cap zoom-in (WCAG 1.4.4)").toBe(false);
    expect(directives.get("user-scalable"), "user-scalable=no would forbid zoom entirely (WCAG 1.4.4)").not.toBe("no");
  });
});

test.describe("mobile shell cannot be dragged sideways", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("no phone width lets the page scroll horizontally, and the top bar never moves", async ({ page }) => {
    await gotoWorkspace(page);

    const results: Anchor[] = [];
    for (const slug of ROUTES) {
      await page.goto(`/workspace/${slug}`);
      // The shell's own chrome, not a route heading: this walks eight routes and
      // must not encode eight separate ready selectors.
      await page.locator("nav.fixed, header").first().waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      for (const width of PHONE_WIDTHS) {
        await page.setViewportSize({ width, height: 844 });
        results.push(await measureAnchor(page, slug, width));
      }
    }

    /*
      The match detail modal, on the route that lists matches. It is the widest
      thing the shell renders (charts and stat tables) and it paints through the
      #overlay-root portal, so it is not covered by any route measurement above.
      Best-effort: an account with no listed match must not fail the suite, and
      the scan over the eight routes is the part that has to hold.
    */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/workspace/matches");
    await page.waitForLoadState("networkidle").catch(() => {});
    const dialogOpener = page.locator("[data-fixture-id], [data-testid^='match']").first();
    if (await dialogOpener.count()) {
      await dialogOpener.click({ timeout: 10_000 }).catch(() => {});
      const dialog = page.locator("[role=dialog]").first();
      if (await dialog.count()) {
        for (const width of PHONE_WIDTHS) {
          await page.setViewportSize({ width, height: 844 });
          results.push(await measureAnchor(page, "matches+modal", width));
        }
      }
    }

    // Printed unconditionally: when this fails, the numbers for every width are
    // what say WHICH viewport and view are broken, and a failed expect below
    // would otherwise stop before reporting the rest.
    console.log("MOBILE-ANCHOR-SCAN " + JSON.stringify(results, null, 2));

    for (const r of results) {
      const where = `${r.view} @ ${r.width}px`;
      expect(r.offenders, `${where}: element(s) overhang the viewport`).toEqual([]);
      expect(
        r.maxScrollX,
        `${where}: the page can be scrolled ${r.maxScrollX}px sideways ` +
          `(document ${r.documentScrollWidth} vs viewport ${r.documentClientWidth})`
      ).toBe(0);
      expect(r.scrolledX, `${where}: the page moved sideways to scrollX=${r.scrolledX}`).toBe(0);
      expect(
        r.headerLeft,
        `${where}: the top bar (position: ${r.headerPosition}) moved to left=${r.headerLeft} ` +
          `while the bottom nav (position: ${r.navPosition}) sat at left=${r.navLeft}`
      ).toBe(0);
    }
  });
});
