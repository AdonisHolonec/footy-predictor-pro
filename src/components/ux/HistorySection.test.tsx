import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import HistorySection from "./HistorySection";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";

afterEach(cleanup);

/** The one performance block. Its content is irrelevant here — its count is not. */
const TRACKER = <div data-testid="tracker">performance tracker</div>;

/** Whichever locale the environment resolves to, the copy must be one of these. */
function eitherLocale(pick: (d: typeof en) => string): RegExp {
  const variants = [pick(en), pick(ro as unknown as typeof en)].map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(variants.join("|"));
}

describe("HistorySection", () => {
  it("shows the performance tracker once, with no stat row repeating it", () => {
    render(<HistorySection history={[]} trackerSlot={TRACKER} />);

    expect(screen.getAllByTestId("tracker")).toHaveLength(1);

    // "W / L" was the hardcoded label of the duplicate StatTile row that sat
    // directly beneath the tracker, restating wins and losses the tracker had
    // just shown. It is the locale-independent fingerprint of that row: if it
    // ever comes back, the view is repeating itself again.
    expect(screen.queryByText("W / L")).toBeNull();
  });

  it("explains an empty history instead of stating it", () => {
    render(<HistorySection history={[]} trackerSlot={TRACKER} />);

    // EmptyState gives the user a heading plus a reason. The old bare Card gave
    // one muted line that named "sync" — an internal concept, not a user action.
    expect(screen.getByText(eitherLocale((d) => d.history.emptyTitle))).toBeTruthy();
    expect(screen.getByText(eitherLocale((d) => d.history.empty))).toBeTruthy();
    expect(screen.queryByText(/sync/i)).toBeNull();
  });

  it("still renders match rows when history has entries", () => {
    const history = [
      {
        id: 1,
        kickoff: "2026-08-17T18:00:00Z",
        teams: { home: "Rapid", away: "Farul" },
        validation: "win"
      }
    ] as unknown as Parameters<typeof HistorySection>[0]["history"];

    render(<HistorySection history={history} trackerSlot={TRACKER} />);

    expect(screen.getByText(/Rapid/)).toBeTruthy();
    expect(screen.getAllByTestId("tracker")).toHaveLength(1);
  });
});
