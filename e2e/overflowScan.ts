import { expect, type Page } from "@playwright/test";

/**
 * Horizontal-overflow diagnosis for a phone-width viewport.
 *
 * Two different things can scroll a document sideways, and only one of them is
 * visible to a scan over element rectangles:
 *
 *   1. BOX overflow — an element's own border box extends past the viewport.
 *      `getBoundingClientRect()` reports it, so walking the elements finds it.
 *
 *   2. INK overflow — an element's box fits, but its CONTENT paints outside it,
 *      because `overflow` is visible and the content cannot be narrowed (an
 *      unbreakable line, a `white-space: nowrap` label under a `max-width`).
 *      The spilled text is an anonymous inline box, NOT an element, so it is
 *      absent from `querySelectorAll` and adds nothing to any element's rect —
 *      yet it still counts toward `documentElement.scrollWidth`.
 *
 * Case 2 is why the post-merge smoke on 7d3fa61d failed with the document at
 * 433px on a 390px viewport and an EMPTY offender list: a tooltip label was
 * `whitespace-nowrap` under `max-w-16rem`, so it painted through the edge of
 * its own capped box (fixed in #96). The run was red with nothing to act on
 * because the scan could not describe what it had found.
 *
 * `inkOverflow` closes that gap: it names the container whose content escapes.
 */

/**
 * `Element`, reached through a value expression rather than by name.
 *
 * e2e/ is linted with node globals and `no-undef` deliberately left ON
 * (eslint.config.js), which rejects the bare DOM type — the same reason the
 * code below reaches `document` through `globalThis`. Type annotations are
 * erased before `page.evaluate` serializes the scan, so this costs nothing at
 * runtime.
 */
type DomElement = NonNullable<ReturnType<typeof globalThis.document.querySelector>>;

/** Measurements plus both classes of culprit, as reported from the page. */
export type OverflowScan = {
  viewportWidth: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  bodyScrollWidth: number;
  /** Elements whose own rect leaves the viewport (the original scan). */
  offenders: string[];
  /** Containers whose content paints outside a box that itself fits. */
  inkOverflow: string[];
};

/**
 * Runs IN THE PAGE via `page.evaluate`, so it is deliberately self-contained:
 * Playwright ships this function as source text, and any reference to a
 * module-level binding would be undefined by the time it executes.
 *
 * Browser globals go through `globalThis` because e2e/ is linted with node
 * globals and `no-undef` deliberately left ON (eslint.config.js).
 */
export function scanHorizontalOverflow(): OverflowScan {
  const doc = globalThis.document;
  const de = doc.documentElement;
  const vw = globalThis.innerWidth;
  /** Enough to identify a culprit; a full page dump helps nobody. */
  const MAX_REPORTED = 5;

  /** A short, pasteable identity: tag, id/classes, role, label, text. */
  const describe = (el: DomElement): string => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = (el.className || "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    const role = el.getAttribute("role");
    const label = el.getAttribute("aria-label");
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return (
      `${tag}${id}${cls ? `.${cls}` : ""}` +
      `${role ? ` [role=${role}]` : ""}` +
      `${label ? ` [aria-label="${label}"]` : ""}` +
      `${text ? ` "${text}"` : ""}`
    );
  };

  /** Best-effort CSS path — identity only, never used to re-query. */
  const selectorFor = (el: DomElement): string => {
    try {
      const parts: string[] = [];
      let node: DomElement | null = el;
      for (let depth = 0; node && node !== doc.body && depth < 4; depth += 1) {
        if (node.id) {
          parts.unshift(`#${node.id}`);
          break;
        }
        const parent: DomElement | null = node.parentElement;
        const index = parent ? Array.prototype.indexOf.call(parent.children, node) + 1 : 0;
        parts.unshift(index ? `${node.tagName.toLowerCase()}:nth-child(${index})` : node.tagName.toLowerCase());
        node = parent;
      }
      return parts.join(" > ");
    } catch {
      // Identity is a nicety; never let it fail the diagnosis it decorates.
      return "";
    }
  };

  const rectOf = (el: DomElement): string => {
    const r = el.getBoundingClientRect();
    return `rect=[${Math.round(r.left)}→${Math.round(r.right)}] ${Math.round(r.width)}x${Math.round(r.height)}`;
  };

  // --- 1. Box overflow: the part of each box that is VISIBLE past the edge. --
  //
  // A box that crosses the viewport only inside an ancestor that clips it — a
  // horizontal scroller (overflow-x: auto/scroll) or a clipping box
  // (hidden/clip) — paints nothing past the edge and cannot widen the document.
  // The dashboard day strip was the first such scroller on a scanned page: its
  // scrolled row failed the post-merge smoke on 095b510d while the page fit.
  // The clipping ancestor itself is still scanned on its own turn, so a
  // scroller that overhangs the viewport is still reported.
  //
  // An ancestor clips only descendants whose containing-block chain passes
  // through it: `absolute` skips non-positioned ancestors (an overhanging
  // tooltip anchored outside a clipping box still counts), and `fixed` escapes
  // all of them unless a transform/filter/perspective/contain ancestor contains
  // it. <body> and <html> are never treated as clips — their overflow applies
  // to the viewport, which is exactly what this scan measures.
  const createsFixedContainingBlock = (cs: ReturnType<typeof globalThis.getComputedStyle>): boolean =>
    cs.transform !== "none" ||
    cs.filter !== "none" ||
    cs.perspective !== "none" ||
    /\b(layout|paint|strict|content)\b/.test(cs.contain);

  /** `el`'s horizontal extent left visible by the ancestors that clip it; null when none is. */
  const visibleSpan = (el: DomElement, left: number, right: number): [number, number] | null => {
    let position = globalThis.getComputedStyle(el).position;
    for (let a: DomElement | null = el.parentElement; a && a !== doc.body && a !== de; a = a.parentElement) {
      const acs = globalThis.getComputedStyle(a);
      const onChain =
        position === "absolute"
          ? acs.position !== "static" || createsFixedContainingBlock(acs)
          : position === "fixed"
            ? createsFixedContainingBlock(acs)
            : true;
      if (!onChain) continue;
      // Inline and display:contents boxes clip nothing, whatever overflow says.
      if (acs.overflowX !== "visible" && acs.display !== "inline" && acs.display !== "contents") {
        const clipLeft = a.getBoundingClientRect().left + a.clientLeft;
        left = Math.max(left, clipLeft);
        right = Math.min(right, clipLeft + a.clientWidth);
        if (right <= left) return null;
      }
      position = acs.position;
    }
    return [left, right];
  };

  const offenders: string[] = [];
  // Whole document, not just #root: overlays render in #overlay-root, which is
  // a sibling. A scan rooted at #root can report "no offenders" while the page
  // is visibly scrolling sideways.
  for (const el of Array.from(doc.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    // Only skip boxes that render nothing at all. A zero-HEIGHT element can be
    // arbitrarily wide and still scroll the document, so height alone is never
    // a reason to ignore one.
    if (r.width === 0 && r.height === 0) continue;
    // Fixed chrome is positioned against the viewport and does not expand the
    // document's scrollable area.
    if (globalThis.getComputedStyle(el).position === "fixed") continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    const span = visibleSpan(el, r.left, r.right);
    if (span && (span[1] > vw + 1 || span[0] < -1)) {
      offenders.push(
        `${el.tagName.toLowerCase()} [${Math.round(r.left)}→${Math.round(r.right)}] ` +
          `${Math.round(r.width)}x${Math.round(r.height)} ` +
          `"${(el.textContent || "").trim().slice(0, 40)}" .${(el.className || "").toString().slice(0, 60)}`
      );
    }
  }

  // --- 2. Ink overflow: content escaping a box that fits. -------------------
  const spilling: DomElement[] = [];
  for (const el of [doc.body, ...Array.from(doc.querySelectorAll("body *"))]) {
    const cs = globalThis.getComputedStyle(el);
    // Anything other than `visible` clips or scrolls its own content, so that
    // content cannot reach the document's scrollable area.
    if (cs.overflowX !== "visible") continue;
    // Inline boxes report 0 for both, which reads as "no overflow" — correct
    // here, since their block container carries the escaping ink instead.
    if (el.scrollWidth - el.clientWidth <= 1) continue;
    // Ink is only the document's problem if nothing between here and the root
    // clips it away, and if it is not painted inside viewport-anchored chrome.
    let contained = false;
    for (let a: DomElement | null = el.parentElement; a && !contained; a = a.parentElement) {
      const acs = globalThis.getComputedStyle(a);
      if (acs.overflowX !== "visible" || acs.position === "fixed") contained = true;
    }
    if (contained) continue;
    spilling.push(el);
  }

  // Every ancestor of a spilling element spills too. Only the deepest ones say
  // anything useful — reporting the chain up to <body> buries the culprit.
  const deepest = spilling.filter((el) => !spilling.some((other) => other !== el && el.contains(other)));

  const inkOverflow = deepest.slice(0, MAX_REPORTED).map((el) => {
    const cs = globalThis.getComputedStyle(el);
    const over = el.scrollWidth - el.clientWidth;
    const selector = selectorFor(el);
    return (
      `${describe(el)} — content overflows by ${over}px ` +
      `(scrollW=${el.scrollWidth} clientW=${el.clientWidth}) ` +
      `${rectOf(el)} overflow-x:${cs.overflowX} white-space:${cs.whiteSpace} max-width:${cs.maxWidth}` +
      `${selector ? ` @ ${selector}` : ""}`
    );
  });
  if (deepest.length > MAX_REPORTED) {
    inkOverflow.push(`…and ${deepest.length - MAX_REPORTED} more container(s) with content overflow`);
  }

  return {
    viewportWidth: vw,
    documentScrollWidth: de.scrollWidth,
    documentClientWidth: de.clientWidth,
    // body.scrollWidth says whether the overflow lives in the page at all.
    bodyScrollWidth: doc.body.scrollWidth,
    offenders,
    inkOverflow
  };
}

/** The measurements every failure message repeats. */
function measurements(scan: OverflowScan): string {
  return (
    `documentElement ${scan.documentScrollWidth}/${scan.documentClientWidth}, ` +
    `body ${scan.bodyScrollWidth}, viewport ${scan.viewportWidth}`
  );
}

/**
 * Nothing may extend past the viewport — as a box, or as ink.
 *
 * Asserted in that order on purpose: a box that overhangs is both the more
 * common cause and the easier read, and naming it beats a bare width mismatch.
 */
export async function expectNoHorizontalOverflow(page: Page, view: string): Promise<void> {
  const scan = await page.evaluate(scanHorizontalOverflow);

  // The offender list is asserted first: when this regresses it names the
  // element, which a bare width comparison never would.
  expect(scan.offenders, `${view}: element(s) overhang the ${scan.viewportWidth}px viewport`).toEqual([]);

  const ink = scan.inkOverflow.length
    ? `\n  content overflow (box fits, ink does not):\n    ${scan.inkOverflow.join("\n    ")}`
    : "\n  no container reported content overflow either — check pseudo-elements and transforms";

  expect(
    scan.documentScrollWidth,
    `${view}: document scrolls horizontally with no element overhanging — ${measurements(scan)}${ink}`
  ).toBe(scan.documentClientWidth);
}
