import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";
import RecommendationDialog, { shouldOpenRecommendationAfterPredict } from "./RecommendationDialog";

/**
 * The post-Predict recommendation dialog: the Featured card's content inside the
 * design-system Dialog. Pins the chrome (semantics, close paths, focus), the
 * reuse of the existing card, and every recommendation state the card already
 * had — available, masked tier, empty — arriving unchanged through the dialog.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})$`);

afterEach(cleanup);

function row(overrides: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 7,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Arsenal", away: "Chelsea" },
    kickoff: "2026-08-25T17:30:00.000Z",
    status: "NS",
    probs: { p1: 0.5, pX: 0.25, p2: 0.25 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 81, odd: 1.9 },
    ...overrides
  } as unknown as PredictionRow;
}

function mount(props: Partial<Parameters<typeof RecommendationDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onOpenAnalysis = vi.fn();
  const utils = render(
    <LocaleProvider>
      <RecommendationDialog open match={row()} onClose={onClose} onOpenAnalysis={onOpenAnalysis} {...props} />
    </LocaleProvider>
  );
  return { onClose, onOpenAnalysis, ...utils };
}

describe("shouldOpenRecommendationAfterPredict", () => {
  it("opens only for a run that produced rows", () => {
    expect(shouldOpenRecommendationAfterPredict([row()])).toBe(true);
    expect(shouldOpenRecommendationAfterPredict([])).toBe(false);
    expect(shouldOpenRecommendationAfterPredict(undefined as unknown as unknown[])).toBe(false);
  });
});

describe("RecommendationDialog", () => {
  it("renders nothing while closed", () => {
    mount({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Arsenal")).toBeNull();
  });

  it("is a labelled modal dialog with an accessible close control", () => {
    mount();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = screen.getByRole("heading", { level: 2, name: either("dash", "recommendationTitle") });
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("shows the existing Featured card content — teams, kicker, the why-confident toggle", () => {
    mount();
    const body = screen.getByTestId("recommendation-dialog");
    expect(body.textContent).toMatch(/Arsenal/);
    expect(body.textContent).toMatch(/Chelsea/);
    expect(screen.getByText(either("dash", "featuredKicker"))).toBeTruthy();
    expect(screen.getByRole("button", { name: either("dash", "featuredWhyConfident") })).toBeTruthy();
  });

  it("keeps the card's masked-tier state: confidence category instead of an exact number", () => {
    // A masked plan carries no exact confidence, only the category the card
    // reveals under "why confident". Same row shape, same card, same output.
    mount({
      match: row({ recommended: { pick: "Over 2.5", family: "Over/Under", confidenceCategory: "High" } } as never)
    });
    fireEvent.click(screen.getByRole("button", { name: either("dash", "featuredWhyConfident") }));
    expect(screen.getByText("High")).toBeTruthy();
  });

  it("shows the empty state when the run left nothing to recommend", () => {
    mount({ match: null });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(either("dash", "emptyPicksTitle"))).toBeTruthy();
    expect(screen.queryByText("Arsenal")).toBeNull();
  });

  it("closes from the X button", () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const { onClose } = mount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click", () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opening the analysis closes the dialog first, then hands the row over", () => {
    const { onClose, onOpenAnalysis } = mount();
    const calls: string[] = [];
    onClose.mockImplementation(() => calls.push("close"));
    onOpenAnalysis.mockImplementation(() => calls.push("open"));
    // The whole verdict area is the card's primary action (teams are one text
    // node split by a <br>, so the button is found by its accessible name).
    fireEvent.click(screen.getByRole("button", { name: /Arsenal/ }));
    expect(calls).toEqual(["close", "open"]);
    expect(onOpenAnalysis).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it("moves focus into the dialog on open and restores it on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = mount();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
