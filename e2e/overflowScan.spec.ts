import { expect, test, type Page } from "@playwright/test";
import { scanHorizontalOverflow } from "./overflowScan";

/**
 * Regression tests for the overflow scan itself, on synthetic pages.
 *
 * These never touch the app: `setContent` builds the exact DOM shape under
 * test, so the scan's behaviour is pinned independently of whatever the shell
 * happens to render, of the account, and of the deployed build. That matters
 * because the bug these guard against is invisible to the obvious check — the
 * production failure on 7d3fa61d listed zero offending elements while the
 * document was 43px too wide, and stayed unexplained across three red runs.
 *
 * Same 390px viewport as mobileOverflow.spec.ts, so the numbers below read
 * against the width the suite actually defends.
 */
test.use({ viewport: { width: 390, height: 844 } });

/** A line that cannot fit 390px in any font, sized in a font that never varies. */
const LONG_LINE = "OVERFLOW".repeat(12);

/**
 * Renders a fixed-width box holding one long line, and returns the scan.
 * `extraStyle` is what each test varies — nothing else differs between them.
 */
async function scanBoxedLine(page: Page, extraStyle: string) {
  await page.setContent(`
    <style>
      body { margin: 0; }
      #cap { width: 200px; font: 16px/1.2 monospace; ${extraStyle} }
    </style>
    <div id="cap" aria-label="capped box">${LONG_LINE}</div>
  `);
  return page.evaluate(scanHorizontalOverflow);
}

test.describe("horizontal overflow scan", () => {
  test("names the container when ink escapes a box that itself fits", async ({ page }) => {
    const scan = await scanBoxedLine(page, "white-space: nowrap;");

    // The premise: the document IS too wide.
    expect(scan.documentScrollWidth, "the nowrap line must widen the document").toBeGreaterThan(
      scan.documentClientWidth
    );

    // ...and the rectangle scan cannot see why. This is the whole point: the
    // 200px box fits inside 390px, and the text spilling out of it is an
    // anonymous inline box that `querySelectorAll` never returns. Without the
    // ink pass, a real failure here reports nothing at all to act on.
    expect(scan.offenders, "no element rect overhangs — that is exactly the blind spot").toEqual([]);

    // The ink pass names it, and names it precisely.
    expect(scan.inkOverflow).toHaveLength(1);
    const [report] = scan.inkOverflow;
    expect(report).toContain("div#cap");
    expect(report).toContain('[aria-label="capped box"]');
    expect(report).toContain("overflow-x:visible");
    expect(report).toContain("white-space:nowrap");
    expect(report).toContain("scrollW=");
    expect(report).toContain("clientW=200");
    expect(report, "the report should carry a rect and a path to the node").toMatch(/rect=\[.+\] .+ @ /);
  });

  test("reports the deepest container, not every ancestor of it", async ({ page }) => {
    const scan = await scanBoxedLine(page, "white-space: nowrap;");

    // <body> and any wrapper overflow too, by inheritance of the same ink.
    // Listing the whole chain would bury the one node worth looking at.
    expect(scan.inkOverflow.join("\n")).not.toContain("body");
  });

  test("stays quiet when the same line is allowed to wrap", async ({ page }) => {
    const scan = await scanBoxedLine(page, "white-space: normal; overflow-wrap: anywhere;");

    expect(scan.documentScrollWidth).toBe(scan.documentClientWidth);
    expect(scan.inkOverflow, "wrapped text escapes nothing").toEqual([]);
    expect(scan.offenders).toEqual([]);
  });

  test("stays quiet when the container clips its own overflow", async ({ page }) => {
    const scan = await scanBoxedLine(page, "white-space: nowrap; overflow-x: hidden;");

    // Clipped ink never reaches the document's scrollable area, so reporting it
    // would send the next reader after an element that is not the cause.
    expect(scan.documentScrollWidth).toBe(scan.documentClientWidth);
    expect(scan.inkOverflow).toEqual([]);
  });

  test("still catches a box that overhangs the viewport", async ({ page }) => {
    // The original detection, unchanged: a 900px box on a 390px viewport.
    await page.setContent(`
      <style>body { margin: 0; }</style>
      <div id="wide" style="width: 900px; height: 20px;">wide</div>
    `);
    const scan = await page.evaluate(scanHorizontalOverflow);

    expect(scan.offenders).toHaveLength(1);
    expect(scan.offenders[0]).toContain("div");
    expect(scan.documentScrollWidth).toBeGreaterThan(scan.documentClientWidth);
  });
});

/**
 * A 300px strip holding a 1200px row — the shape of a horizontally scrolling
 * control (the dashboard day strip was the first one on a scanned page, and
 * the post-merge smoke on 095b510d flagged its scrolled row). The strip is
 * scrolled where it can be, so the row crosses BOTH viewport edges.
 */
async function scanStrip(page: Page, stripStyle: string) {
  await page.setContent(`
    <style>
      body { margin: 0; }
      .strip { margin-left: 40px; width: 300px; ${stripStyle} }
      .row { display: flex; width: 1200px; height: 40px; }
      .cell { flex: 0 0 100px; }
    </style>
    <div class="strip"><div class="row">${Array.from({ length: 12 }, (_, i) => `<button class="cell">${i}</button>`).join("")}</div></div>
  `);
  await page.evaluate(() => {
    const strip = globalThis.document.querySelector(".strip");
    if (strip) strip.scrollLeft = 200;
  });
  return page.evaluate(scanHorizontalOverflow);
}

test.describe("horizontal overflow scan · clipping ancestors", () => {
  for (const overflowX of ["auto", "hidden", "clip"] as const) {
    test(`stays quiet for content clipped by an overflow-x: ${overflowX} ancestor that fits`, async ({ page }) => {
      const scan = await scanStrip(page, `overflow-x: ${overflowX};`);

      // The premise: the row's own box really does cross the viewport edge.
      const row = await page.locator(".row").boundingBox();
      expect(row!.x + row!.width, "the row must extend past the right edge").toBeGreaterThan(390);

      // ...but only inside the strip, which clips it. Nothing is visible past
      // the viewport and the document does not widen, so there is no offender.
      expect(scan.offenders).toEqual([]);
      expect(scan.documentScrollWidth).toBe(scan.documentClientWidth);
    });
  }

  test("still reports a scroller that itself overhangs the viewport", async ({ page }) => {
    const scan = await scanStrip(page, "overflow-x: auto; width: 900px;");

    // Clipping protects what is inside the strip, never the strip's own box.
    expect(scan.offenders.some((o) => o.startsWith("div") && o.endsWith(".strip"))).toBe(true);
    expect(scan.documentScrollWidth).toBeGreaterThan(scan.documentClientWidth);
  });

  test("still reports an absolutely positioned element that escapes a non-positioned clipping ancestor", async ({ page }) => {
    // overflow clips only descendants whose containing block lies inside the
    // clipping box. This one's containing block is .anchor, OUTSIDE .clipper,
    // so it paints past the viewport — exactly how an overhanging tooltip does.
    await page.setContent(`
      <style>
        body { margin: 0; }
        .anchor { position: relative; }
        .clipper { width: 200px; overflow-x: hidden; }
        .escapee { position: absolute; left: 0; top: 0; width: 900px; height: 20px; }
      </style>
      <div class="anchor"><div class="clipper"><div class="escapee">tooltip</div></div></div>
    `);
    const scan = await page.evaluate(scanHorizontalOverflow);

    expect(scan.offenders.some((o) => o.includes(".escapee"))).toBe(true);
    expect(scan.documentScrollWidth).toBeGreaterThan(scan.documentClientWidth);
  });
});
