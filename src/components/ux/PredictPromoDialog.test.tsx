import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LocaleProvider } from "../../context/LocaleContext";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import PredictPromoDialog from "./PredictPromoDialog";

/**
 * The referral promo shown while Predict loads: a compact dialog with the
 * offer, one primary action (the existing referral flow) and every way out.
 * It carries no prediction content of any kind.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})$`);
const src = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const header = (loc: Leaves) => (loc.account as unknown as Record<string, Record<string, string>>).header;

afterEach(cleanup);

function mount(props: Partial<Parameters<typeof PredictPromoDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onRecommend = vi.fn();
  render(
    <LocaleProvider>
      <PredictPromoDialog open onClose={onClose} onRecommend={onRecommend} {...props} />
    </LocaleProvider>
  );
  return { onClose, onRecommend };
}

describe("PredictPromoDialog", () => {
  it("renders nothing while closed", () => {
    mount({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled modal with the title, the offer, its terms, and both actions", () => {
    mount();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = screen.getByRole("heading", { level: 2, name: either("dash", "predictPromoTitle") });
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(screen.getByText(either("dash", "predictPromoBody"))).toBeTruthy();
    // The reward promise is the product's existing wording, not a new one.
    const hint = new RegExp(`^(${esc(header(E).referralHint)}|${esc(header(R).referralHint)})$`);
    expect(screen.getByText(hint)).toBeTruthy();
    expect(screen.getByRole("button", { name: either("dash", "predictPromoCta") })).toBeTruthy();
    expect(screen.getByRole("button", { name: either("dash", "predictPromoLater") })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("carries no prediction content — no featured card, no pick, no analysis hand-off", () => {
    mount();
    const text = screen.getByRole("dialog").textContent || "";
    for (const key of ["featuredKicker", "featuredWhyConfident", "featuredOpenAnalysis"]) {
      expect(text).not.toMatch(new RegExp(`${esc(E.dash[key])}|${esc(R.dash[key])}`));
    }
    const source = src("PredictPromoDialog.tsx");
    expect(source).not.toMatch(/FeaturedPredictionCard|analysisMatch|PredictionRow|recommended\b|onOpenAnalysis/);
  });

  it("the primary action invokes the referral action, and only that", () => {
    const { onRecommend, onClose } = mount();
    fireEvent.click(screen.getByTestId("predict-promo-cta"));
    expect(onRecommend).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("'Later' closes", () => {
    const { onClose, onRecommend } = mount();
    fireEvent.click(screen.getByTestId("predict-promo-later"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRecommend).not.toHaveBeenCalled();
  });

  it("X closes", () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes", () => {
    const { onClose } = mount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop closes", () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open and restores it on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(
      <LocaleProvider>
        <PredictPromoDialog open onClose={() => {}} onRecommend={() => {}} />
      </LocaleProvider>
    );
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
