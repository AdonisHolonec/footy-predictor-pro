import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import StatusBadge from "./StatusBadge";
import { ensureCatalog } from "../i18n/translate";

/**
 * The mobile outcome badge.
 *
 * jsdom applies no Tailwind, so "is it hidden at 390px" is not observable here —
 * what is observable, and what actually matters, is that each status renders the
 * right artwork under the right accessible name, that the icon and the text are
 * on opposite sides of the `sm` switch, and that an unknown status still shows
 * something truthful. Those are asserted against rendered DOM, never source text.
 *
 * Artwork identity is checked by the fill colours the supplied SVGs actually
 * carry, because that is what catches the failure that matters: a mapping swap
 * that shows a green check for a lost bet would keep every label correct.
 */

const GREEN = "rgb(40,201,55)";
const RED = "rgb(236,0,0)";
const YELLOW = "rgb(242,195,0)";
const ORANGE = "rgb(242,140,0)";
const SLATE = "rgb(130,140,155)";

function setLocale(locale: "ro" | "en") {
  localStorage.setItem("footy:locale", locale);
}

function renderBadge(status: string | null | undefined, label = "LABEL") {
  return render(<StatusBadge status={status} tone="neutral" label={label} />);
}

/** Every fill colour present in the rendered glyph. */
function fills(el: Element): string[] {
  return [...el.querySelectorAll("[fill]")].map((n) => n.getAttribute("fill") || "");
}

function icon(): Element {
  return screen.getByRole("img");
}

afterEach(() => {
  cleanup();
  setLocale("ro");
});

beforeAll(async () => {
  await ensureCatalog("en");
  setLocale("ro");
});

/* -- artwork ---------------------------------------------------------------- */

describe("each status renders its own artwork", () => {
  const CASES: Array<[string, string, string]> = [
    ["win", GREEN, "Câștigător"],
    ["loss", RED, "Pierdut"],
    ["pending", YELLOW, "În așteptare"],
    ["push", SLATE, "Egal"],
    ["half_win", GREEN, "Jumătate câștigătoare"],
    ["half_loss", ORANGE, "Jumătate pierdută"],
    ["void", SLATE, "Anulat"]
  ];

  test.each(CASES)("%s uses its colour and announces its name", (status, colour, name) => {
    renderBadge(status);
    expect(fills(screen.getByRole("img", { name }))).toContain(colour);
  });

  test("a half outcome is visually distinct from the full outcome of the same colour", () => {
    renderBadge("win");
    expect(icon().querySelector("[opacity]")).toBeNull();
    cleanup();

    renderBadge("half_win");
    // The knocked-back half is what separates half-win from win; both are green.
    expect(icon().querySelector("[opacity]")).not.toBeNull();
  });

  test("push and void share a neutral colour but not a glyph", () => {
    renderBadge("push");
    expect(icon().querySelectorAll("rect")).toHaveLength(2);
    cleanup();

    renderBadge("void");
    expect(icon().querySelectorAll("rect")).toHaveLength(0);
  });

  test("the glyph scales from CSS, not from the artwork's intrinsic 256px box", () => {
    renderBadge("win");
    expect(icon().getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon().getAttribute("width")).not.toBe("256");
  });
});

/* -- GSB mapping ------------------------------------------------------------ */

describe("Global Special Bet statuses map onto the shared glyphs", () => {
  test.each([
    ["won", GREEN, "Câștigător"],
    ["lost", RED, "Pierdut"],
    ["pending", YELLOW, "În așteptare"],
    ["void", SLATE, "Anulat"]
  ])("%s", (status, colour, name) => {
    renderBadge(status);
    expect(fills(screen.getByRole("img", { name }))).toContain(colour);
  });

  test("won and win are the same glyph, not two drawings of one idea", () => {
    renderBadge("won");
    const won = icon().innerHTML;
    cleanup();

    renderBadge("win");
    expect(icon().innerHTML).toBe(won);
  });
});

/* -- accessibility ---------------------------------------------------------- */

describe("accessible names come from the catalogue", () => {
  test.each([
    ["win", "Câștigător", "Winner"],
    ["loss", "Pierdut", "Lost"],
    ["pending", "În așteptare", "Pending"],
    ["push", "Egal", "Push"],
    ["half_win", "Jumătate câștigătoare", "Half win"],
    ["half_loss", "Jumătate pierdută", "Half loss"],
    ["void", "Anulat", "Void"]
  ])("%s resolves in both locales", (status, ro, en) => {
    setLocale("ro");
    renderBadge(status);
    expect(icon().getAttribute("aria-label")).toBe(ro);
    cleanup();

    setLocale("en");
    renderBadge(status);
    expect(icon().getAttribute("aria-label")).toBe(en);
  });

  test("the visible label is not announced alongside the icon", () => {
    renderBadge("win", "WIN");
    // Both exist in the DOM; the `sm` switch decides which one a viewport shows,
    // and display:none removes the other from the accessibility tree entirely.
    const label = screen.getByText("WIN");
    expect(label.className).toContain("hidden");
    expect(label.className).toContain("sm:inline");
    expect(icon().getAttribute("class")).toContain("sm:hidden");
  });
});

/* -- fallback and styling --------------------------------------------------- */

describe("unmodelled statuses and existing styling", () => {
  test.each([["surprise"], [""], [null], [undefined]])(
    "%s falls back to text with no glyph",
    (status) => {
      renderBadge(status as string | null | undefined, "FALLBACK");
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByText("FALLBACK")).toBeTruthy();
    }
  );

  test("the fallback text is visible at every width, not hidden with the desktop label", () => {
    renderBadge("surprise", "FALLBACK");
    expect(screen.getByText("FALLBACK").className).not.toContain("hidden");
  });

  test("the badge keeps the shared pill styling", () => {
    const { container } = renderBadge("win", "WIN");
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("rounded-full");
    expect(badge?.className).toContain("border");
  });

  test("the caller's tone is passed through untouched", () => {
    const { container } = render(<StatusBadge status="win" tone="success" label="WIN" />);
    expect(container.querySelector("span")?.className).toContain("--fp-success");
  });
});
