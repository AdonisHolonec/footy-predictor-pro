/**
 * Overlay engine (PR 5) — the behaviour contracts every overlay now inherits.
 *
 * These tests exercise the PUBLIC contracts (portal, stack, ESC, focus, scroll
 * lock, isolation, backdrop, busy), not implementation details: if a future PR
 * swaps the internals but keeps these passing, every migrated surface —
 * Dialog, MatchModal, Auth, palette, drawer, prompt, onboarding — still works.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Overlay from "./Overlay";
import Toast from "./Toast";
import {
  acquireScrollLock,
  overlayStackSize,
  pushOverlay
} from "./overlayInfra";

function appRoot(): HTMLElement {
  let el = document.getElementById("root");
  if (!el) {
    el = document.createElement("div");
    el.id = "root";
    document.body.appendChild(el);
  }
  return el;
}

beforeEach(() => {
  appRoot();
});

afterEach(() => {
  cleanup();
  document.getElementById("overlay-root")?.replaceChildren();
});

/* ---------------- portal + roles ---------------- */

describe("Overlay portal & semantics", () => {
  it("renders into #overlay-root, OUTSIDE #root", () => {
    render(
      <Overlay open onClose={() => {}} aria-label="Test">
        <p>conținut</p>
      </Overlay>
    );
    const dialog = screen.getByRole("dialog");
    expect(document.getElementById("overlay-root")?.contains(dialog)).toBe(true);
    expect(document.getElementById("root")?.contains(dialog)).toBe(false);
  });

  it("panel is role=dialog aria-modal with the given labels", () => {
    render(
      <Overlay open onClose={() => {}} aria-label="Filtru ligi" aria-describedby="x-desc">
        <p id="x-desc">desc</p>
      </Overlay>
    );
    const dialog = screen.getByRole("dialog", { name: "Filtru ligi" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBe("x-desc");
  });

  it("renders nothing when closed", () => {
    render(
      <Overlay open={false} onClose={() => {}} aria-label="Nimic">
        <p>ascuns</p>
      </Overlay>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("each presentation applies its layout class", () => {
    const layouts: Record<string, string> = {
      center: "items-center",
      sheet: "items-end",
      drawer: "justify-end",
      palette: "items-start"
    };
    for (const [presentation, marker] of Object.entries(layouts)) {
      const { unmount } = render(
        <Overlay open onClose={() => {}} presentation={presentation as never} aria-label={presentation}>
          <p>x</p>
        </Overlay>
      );
      const backdrop = screen.getByRole("dialog").parentElement;
      expect(backdrop?.className).toContain(marker);
      unmount();
    }
  });
});

/* ---------------- background isolation ---------------- */

describe("Background isolation", () => {
  it("#root goes inert + aria-hidden while open, restored on close", () => {
    const { unmount } = render(
      <Overlay open onClose={() => {}} aria-label="Izolare">
        <p>x</p>
      </Overlay>
    );
    const root = document.getElementById("root")!;
    expect(root.hasAttribute("inert")).toBe(true);
    expect(root.getAttribute("aria-hidden")).toBe("true");
    unmount();
    expect(root.hasAttribute("inert")).toBe(false);
    expect(root.hasAttribute("aria-hidden")).toBe(false);
  });

  it("nested overlays keep isolation until the LAST one closes", () => {
    const { unmount: unmountTop } = render(
      <Overlay open onClose={() => {}} aria-label="Jos">
        <p>a</p>
      </Overlay>
    );
    const { unmount: unmountSecond } = render(
      <Overlay open onClose={() => {}} aria-label="Sus">
        <p>b</p>
      </Overlay>
    );
    const root = document.getElementById("root")!;
    unmountSecond();
    expect(root.hasAttribute("inert")).toBe(true);
    unmountTop();
    expect(root.hasAttribute("inert")).toBe(false);
  });
});

/* ---------------- ESC stack ---------------- */

describe("Escape stack", () => {
  it("Escape closes the single open overlay", () => {
    const onClose = vi.fn();
    render(
      <Overlay open onClose={onClose} aria-label="Unu">
        <p>x</p>
      </Overlay>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("nested: ONLY the top overlay consumes Escape (the audit's MatchModal/UpgradePrompt collision)", () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <Overlay open onClose={closeBottom} aria-label="MatchModal">
        <p>a</p>
      </Overlay>
    );
    render(
      <Overlay open onClose={closeTop} aria-label="UpgradePrompt">
        <p>b</p>
      </Overlay>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });

  it("closeOnEscape=false SWALLOWS Escape — it must not fall through to the overlay beneath", () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <Overlay open onClose={closeBottom} aria-label="Dedesubt">
        <p>a</p>
      </Overlay>
    );
    render(
      <Overlay open onClose={closeTop} closeOnEscape={false} aria-label="Blocant">
        <p>b</p>
      </Overlay>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeTop).not.toHaveBeenCalled();
    expect(closeBottom).not.toHaveBeenCalled();
  });

  it("after the top closes, Escape reaches the next overlay down", () => {
    const closeBottom = vi.fn();
    render(
      <Overlay open onClose={closeBottom} aria-label="Rămas">
        <p>a</p>
      </Overlay>
    );
    const { unmount } = render(
      <Overlay open onClose={() => {}} aria-label="Temporar">
        <p>b</p>
      </Overlay>
    );
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeBottom).toHaveBeenCalledTimes(1);
  });

  it("the stack registry drains to zero after all overlays unmount", () => {
    const { unmount } = render(
      <Overlay open onClose={() => {}} aria-label="Numărat">
        <p>x</p>
      </Overlay>
    );
    expect(overlayStackSize()).toBe(1);
    unmount();
    expect(overlayStackSize()).toBe(0);
  });

  it("busy refuses Escape without letting it fall through", () => {
    const onClose = vi.fn();
    render(
      <Overlay open onClose={onClose} busy aria-label="Ocupat">
        <p>x</p>
      </Overlay>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pushOverlay reads busy LIVE — flipping busy off re-enables Escape without re-registering", () => {
    let busy = true;
    const onClose = vi.fn();
    const pop = pushOverlay({ closeOnEscape: true, isBusy: () => busy, onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    busy = false;
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    pop();
  });
});

/* ---------------- backdrop ---------------- */

describe("Backdrop clicks", () => {
  it("closeOnBackdrop: click on the backdrop closes, click INSIDE the panel does not", () => {
    const onClose = vi.fn();
    render(
      <Overlay open onClose={onClose} closeOnBackdrop aria-label="Fundal">
        <p>interior</p>
      </Overlay>
    );
    fireEvent.click(screen.getByText("interior"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("default (closeOnBackdrop=false): backdrop clicks are ignored", () => {
    const onClose = vi.fn();
    render(
      <Overlay open onClose={onClose} aria-label="Strict">
        <p>x</p>
      </Overlay>
    );
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("busy refuses backdrop even when closeOnBackdrop is on", () => {
    const onClose = vi.fn();
    render(
      <Overlay open onClose={onClose} closeOnBackdrop busy aria-label="Trimitere">
        <p>x</p>
      </Overlay>
    );
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* ---------------- focus ---------------- */

describe("Focus management", () => {
  it("initialFocusRef wins; without it the panel itself takes focus", () => {
    function WithRef() {
      const ref = useRef<HTMLButtonElement | null>(null);
      return (
        <Overlay open onClose={() => {}} initialFocusRef={ref} aria-label="Țintit">
          <button ref={ref}>țintă</button>
        </Overlay>
      );
    }
    const first = render(<WithRef />);
    expect(document.activeElement?.textContent).toBe("țintă");
    first.unmount();

    render(
      <Overlay open onClose={() => {}} aria-label="Implicit">
        <button>oarecare</button>
      </Overlay>
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("Tab wraps forward and Shift+Tab wraps backward inside the panel", () => {
    render(
      <Overlay open onClose={() => {}} aria-label="Capcană">
        <button>primul</button>
        <button>ultimul</button>
      </Overlay>
    );
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("button", { name: "primul" });
    const last = screen.getByRole("button", { name: "ultimul" });

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("focus returns to the opener on close (when it is still connected)", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>deschide</button>
          <Overlay open={open} onClose={() => setOpen(false)} aria-label="Înapoi">
            <button onClick={() => setOpen(false)}>închide</button>
          </Overlay>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "deschide" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "închide" }));
    expect(document.activeElement).toBe(opener);
  });
});

/* ---------------- scroll lock ---------------- */

describe("Scroll lock", () => {
  it("locks body scroll while open and restores the exact prior value", () => {
    document.body.style.overflow = "scroll";
    const { unmount } = render(
      <Overlay open onClose={() => {}} aria-label="Blocat">
        <p>x</p>
      </Overlay>
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });

  it("nested locks: body stays locked until the LAST overlay closes; release is idempotent", () => {
    const release1 = acquireScrollLock();
    const release2 = acquireScrollLock();
    expect(document.body.style.overflow).toBe("hidden");
    release2();
    release2(); // double-release must not corrupt the ref-count
    expect(document.body.style.overflow).toBe("hidden");
    release1();
    expect(document.body.style.overflow).toBe("");
  });
});

/* ---------------- Toast: container yes, stack no ---------------- */

describe("Toast × overlay engine", () => {
  it("shares #overlay-root but does NOT join the stack, lock scroll or take Escape", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Copiat" onDismiss={onDismiss} dismissLabel="Închide" durationMs={null} />);
    const status = screen.getByRole("status");
    expect(document.getElementById("overlay-root")?.contains(status)).toBe(true);
    expect(overlayStackSize()).toBe(0);
    expect(document.body.style.overflow).not.toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
