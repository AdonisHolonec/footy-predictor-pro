import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { buildPredictAction } from "./predictState";
import { afterEach, describe, expect, it, vi } from "vitest";
import MatchesSection from "./MatchesSection";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";

/**
 * "Top picks" used to be a nav destination of its own — `navView ===
 * "predictions"` — that neither the tab bar nor the desktop rail ever listed,
 * because both build from MOBILE_TAB_ITEMS. Only ⌘K reached it, so on mobile it
 * could not be opened at all. These tests pin it to a surface that has a
 * pointer route, and pin the empty state that tells a user how to leave it.
 */

/** Whichever locale the environment resolves to, the copy is one of these. */
function eitherLocale(ns: "dash" | "shell", key: string): RegExp {
  const leaf = (d: typeof en) => (d[ns] as unknown as Record<string, string>)[key];
  const variants = [leaf(en), leaf(ro as unknown as typeof en)]
    .filter(Boolean)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(${variants.join("|")})$`);
}

afterEach(cleanup);

function renderMatches(overrides: Record<string, unknown> = {}) {
  const onSetFilter = vi.fn();
  const onPredict = vi.fn();
  /*
    MatchesSection no longer takes a bare onPredict — it consumes the shared
    Predict contract, so the surface cannot disagree with the header about
    whether the action is available. An idle contract is the "Predict is
    offered" case this suite exercises.
  */
  const predictAction = buildPredictAction({
    state: "idle",
    labels: { label: "Generează Predicții", hint: "hint", busy: "busy", quotaSpent: "spent" },
    run: onPredict
  });
  render(
    <MatchesSection
      matches={[] as unknown as PredictionRow[]}
      accessTier="free"
      marketValidationsByFixtureId={new Map()}
      isWatched={() => false}
      onToggleWatch={() => {}}
      onOpenMatch={() => {}}
      onUpgradeRequired={() => {}}
      predictAction={predictAction}
      matchesFilter="all"
      onSetFilter={onSetFilter}
      valueOnly={false}
      onToggleValueOnly={() => {}}
      loading={false}
      {...overrides}
    />
  );
  return { onSetFilter, onPredict };
}

function picksControl(): HTMLElement {
  return screen.getAllByRole("button", { name: eitherLocale("dash", "filterPicks") })[0];
}

describe("MatchesSection top picks filter", () => {
  it("offers picks as a filter beside all and favorites", () => {
    // The pointer route the old nav destination never had.
    const { onSetFilter } = renderMatches();
    expect(picksControl(), "no Top picks control").toBeTruthy();

    fireEvent.click(picksControl());
    expect(onSetFilter).toHaveBeenCalledWith("picks");
  });

  it("marks picks as the selected filter when it is active", () => {
    renderMatches({ matchesFilter: "picks" });
    // SegmentedControl in "toggle" mode is a FILTER, so selection reads as
    // aria-pressed; aria-selected would mean it swaps panels instead.
    expect(picksControl().getAttribute("aria-pressed")).toBe("true");
  });

  it("explains an empty picks list without offering to regenerate it", () => {
    // Empty picks does not mean the slate is missing — it means nothing on it
    // carries a recommendation. Predict would regenerate the same unbacked
    // rows, so the way out is back to the full list.
    const { onSetFilter, onPredict } = renderMatches({ matchesFilter: "picks" });

    expect(screen.getByText(eitherLocale("dash", "emptyPicksTitle"))).toBeTruthy();
    expect(screen.getByText(eitherLocale("dash", "emptyPicksDesc"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: eitherLocale("dash", "showAll") }));
    expect(onSetFilter).toHaveBeenCalledWith("all");
    expect(onPredict).not.toHaveBeenCalled();
  });

  it("still offers Predict when the unfiltered slate is empty", () => {
    // The original empty state must keep its original action.
    const { onPredict } = renderMatches({ matchesFilter: "all" });
    fireEvent.click(screen.getByRole("button", { name: eitherLocale("shell", "predict") }));
    expect(onPredict).toHaveBeenCalled();
  });

  it("carries the picks copy in both catalogues", () => {
    for (const key of ["filterPicks", "emptyPicksTitle", "emptyPicksDesc"] as const) {
      const enLeaf = (en.dash as unknown as Record<string, string>)[key];
      const roLeaf = (ro.dash as unknown as Record<string, string>)[key];
      expect(enLeaf, `en.dash.${key} missing`).toBeTruthy();
      expect(roLeaf, `ro.dash.${key} missing`).toBeTruthy();
    }
    // The prose must actually be translated; the short label may share a term.
    expect((ro.dash as unknown as Record<string, string>).emptyPicksDesc).not.toBe(
      (en.dash as unknown as Record<string, string>).emptyPicksDesc
    );
  });
});

/*
  MATCHES REFRESH — resolved deliberately, and NOT a Predict surface.

  `restoreOrPredict` serves cached picks when they are good and only falls
  through to a run when they are not, so it is a DATA action whose fallback
  happens to reach Predict. That distinction decides its wiring:

   - BLOCKED does not reach it. Refusing Refresh because the daily allowance is
     spent would refuse a cache reload the quota does not govern; the Predict
     fallthrough is still covered, by the gate inside warmAndPredict.
   - BUSY does reach it, because concurrency is a shared concern: a refresh
     while a run is in flight is meaningless and could enter a second time.
*/
describe("Matches Refresh is a data action, not a Predict surface", () => {
  // Named by its aria-label (shell.refreshPredictions), not its visible word.
  const refresh = () =>
    screen.getByRole("button", {
      name: eitherLocale("shell", "refreshPredictions")
    }) as HTMLButtonElement;

  it("stays available while Predict is BLOCKED — cached picks are not quota-governed", () => {
    const onRefresh = vi.fn();
    renderMatches({
      onRefresh,
      refreshBusy: false,
      predictAction: buildPredictAction({
        state: "blocked",
        labels: { label: "Generează Predicții", hint: "hint", busy: "busy", quotaSpent: "spent" },
        run: vi.fn()
      })
    });
    const btn = refresh();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("is inert while a run is in flight, so it cannot enter a second time", () => {
    const onRefresh = vi.fn();
    renderMatches({ onRefresh, refreshBusy: true });
    const btn = refresh();
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("carries no Predict state attribute — it is not a Predict surface", () => {
    renderMatches({ onRefresh: vi.fn(), refreshBusy: false });
    expect(refresh().getAttribute("data-predict-state")).toBeNull();
  });
});
