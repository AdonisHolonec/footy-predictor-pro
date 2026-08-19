import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConsumerShell from "./ConsumerShell";
import { MOBILE_TAB_ITEMS } from "./appNav";

/**
 * The shell owns navigation, and above `lg` it is the only thing that does: the
 * bottom tab bar is `lg:hidden`, and the Home performance card that used to
 * carry a History link hides itself on a first run. A desktop account with no
 * settled picks was therefore left with no way into its own history — caught
 * only by the post-merge smoke, days later. These tests pin the invariant here,
 * where it fails in seconds.
 */

function renderShell(overrides: Record<string, unknown> = {}) {
  const onNavigate = vi.fn();
  render(
    <ConsumerShell
      activeNav="home"
      onNavigate={onNavigate}
      date="2026-08-11"
      onDateChange={() => {}}
      search=""
      onSearchChange={() => {}}
      onOpenLeagues={() => {}}
      onRefresh={() => {}}
      onToggleFavorites={() => {}}
      onOpenNotifications={() => {}}
      onOpenProfile={() => {}}
      onOpenSettings={() => {}}
      {...overrides}
    >
      <div>content</div>
    </ConsumerShell>
  );
  return { onNavigate };
}

describe("ConsumerShell navigation", () => {
  afterEach(cleanup);

  it("exposes a control for every primary destination", () => {
    renderShell();
    // Romanian is the default catalogue, so these are the labels users read.
    for (const label of ["Acasă", "Meciuri", "Live", "Istoric", "Profil"]) {
      expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0);
    }
  });

  it("keeps a History route even when no other surface offers one", () => {
    // The regression: this control did not exist, and the only alternative was
    // a Home card that renders nothing until the account has history.
    const { onNavigate } = renderShell();
    screen.getAllByRole("button", { name: "Istoric" })[0].click();
    expect(onNavigate).toHaveBeenCalledWith("history");
  });

  it("marks the active destination for assistive tech", () => {
    renderShell({ activeNav: "history" });
    const current = screen
      .getAllByRole("button", { name: "Istoric" })
      .filter((el) => el.getAttribute("aria-current") === "page");
    expect(current.length).toBeGreaterThan(0);
  });

  it("stays in step with the mobile tab bar's destinations", () => {
    // One source of truth: if MOBILE_TAB_ITEMS changes, this test says so.
    expect(MOBILE_TAB_ITEMS.map((i) => i.id)).toEqual(["home", "matches", "live", "history", "profile"]);
  });
});

describe("ConsumerShell touch targets", () => {
  afterEach(cleanup);

  /**
   * Predict is the shell's critical action, and IconButton records the rule it
   * has to meet: "md = 44px (--fp-touch, the default for critical actions);
   * sm = 36px, allowed in dense toolbars only". It stays visually `sm` so the
   * toolbar keeps its 36px rhythm — the mobile header measured 139px and
   * growing the box pushed it to 155px — and `touch-target` supplies the 44px
   * pointer area instead.
   */
  it("gives the Predict action a 44px pointer target without growing its box", () => {
    renderShell({ onPredict: () => {} });
    const predict = screen.getAllByRole("button", { name: /Generează predicții pentru/ })[0];
    expect(predict.className).toContain("touch-target");
    // Still the dense-toolbar size: this is a hit-area fix, not a layout change.
    expect(predict.className).toContain("min-h-9");
    expect(predict.className).not.toContain("min-h-[var(--fp-touch)]");
  });
  /**
   * Predict's neighbours in the same toolbar row were left at the dense size
   * without the pointer pad, so the row mixed a 44px target with two 36px ones.
   * Same rule, same fix, no visual change.
   */
  it("gives the league filter and refresh the same 44px pointer target", () => {
    renderShell({ onPredict: () => {} });
    for (const name of [/Filtreaza|ligi/i, /Reincarca picks|picks salvate/i]) {
      const el = screen.getAllByRole("button", { name })[0];
      expect(el, `no control matched ${name}`).toBeTruthy();
      expect(el.className, `${el.getAttribute("aria-label")} lacks the pad`).toContain("touch-target");
    }
  });

  it("keeps every padded control visually dense", () => {
    renderShell({ onPredict: () => {} });
    // The pad is invisible: nothing in the row may adopt the 44px BOX, or the
    // mobile header grows (it measured 139px, and a box change pushed it 155px).
    const padded = Array.from(document.querySelectorAll("button.touch-target"));
    expect(padded.length).toBeGreaterThanOrEqual(3);
    for (const el of padded) {
      expect(el.className, "a padded control grew its box").not.toContain("min-h-[var(--fp-touch)]");
    }
  });
});
