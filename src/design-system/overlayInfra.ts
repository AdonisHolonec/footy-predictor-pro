/**
 * Overlay infrastructure (PR 5) — the ONE mechanism behind every overlay.
 *
 * Before this module the app had one complete Dialog and seven local shells:
 * five independent document-level ESC listeners (so Escape over a stacked
 * UpgradePrompt closed the MatchModal underneath it), scroll-lock in exactly
 * one of eight surfaces, three copy-pasted focus traps, zero portals and zero
 * background isolation. Everything here is shared, ref-counted and
 * stack-aware; components never touch document listeners or body styles.
 */

export type OverlayEntry = {
  id: number;
  closeOnEscape: boolean;
  isBusy: () => boolean;
  onClose: () => void;
};

let nextId = 1;
const stack: OverlayEntry[] = [];
let keydownBound = false;

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || stack.length === 0) return;
  // ONLY the top overlay may consume Escape. If it opted out (or is busy),
  // Escape is swallowed — it must NOT fall through and close the one beneath.
  const top = stack[stack.length - 1];
  event.stopPropagation();
  if (top.closeOnEscape && !top.isBusy()) top.onClose();
}

/** Register an open overlay; returns its unregister function. */
export function pushOverlay(entry: Omit<OverlayEntry, "id">): () => void {
  const record: OverlayEntry = { id: nextId++, ...entry };
  stack.push(record);
  if (!keydownBound) {
    document.addEventListener("keydown", onDocumentKeydown);
    keydownBound = true;
  }
  return () => {
    const index = stack.indexOf(record);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0 && keydownBound) {
      document.removeEventListener("keydown", onDocumentKeydown);
      keydownBound = false;
    }
  };
}

/** Exposed for tests/diagnostics. */
export function overlayStackSize(): number {
  return stack.length;
}

/* ---------------- scroll lock (ref-counted) ---------------- */

let lockCount = 0;
let savedOverflow = "";
let savedPaddingRight = "";

/** Lock page scroll; nested overlays share one lock via ref-count, and the
 *  last release restores the exact prior state (with scrollbar compensation
 *  so the page does not shift when the bar disappears). */
export function acquireScrollLock(): () => void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    savedPaddingRight = document.body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow;
      document.body.style.paddingRight = savedPaddingRight;
    }
  };
}

/* ---------------- background isolation (ref-counted) ---------------- */

let isolationCount = 0;

/** While any overlay is open, the app root (#root) is inert + aria-hidden —
 *  the overlay itself lives in the portal root OUTSIDE #root, so the rule
 *  "never aria-hide an ancestor of the focused element" holds by layout. */
export function acquireBackgroundIsolation(): () => void {
  const appRoot = document.getElementById("root");
  if (appRoot && isolationCount === 0) {
    appRoot.setAttribute("inert", "");
    appRoot.setAttribute("aria-hidden", "true");
  }
  isolationCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    isolationCount -= 1;
    const root = document.getElementById("root");
    if (root && isolationCount === 0) {
      root.removeAttribute("inert");
      root.removeAttribute("aria-hidden");
    }
  };
}

/* ---------------- portal root ---------------- */

const OVERLAY_ROOT_ID = "overlay-root";

/** One stable portal container for every overlay (and the Toast, which shares
 *  the container but NOT the ESC/focus stack). Created lazily, reused forever. */
export function getOverlayRoot(): HTMLElement {
  let root = document.getElementById(OVERLAY_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = OVERLAY_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

/* ---------------- focus helpers ---------------- */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}
