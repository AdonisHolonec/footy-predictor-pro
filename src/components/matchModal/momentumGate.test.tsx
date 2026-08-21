import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MatchModal from "../MatchModal";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";

/**
 * Momentum visibility is gated on real in-play status, not on `hasLiveScore`.
 *
 * `hasLiveScore` is deliberately loose: it also fires for a fixture still reported
 * NS/TBD past the kickoff poll window, so the live score strip keeps updating while
 * upstream status lags. `isFinalStatus` only knows FT/AET/PEN, so that looseness also
 * swept in PST/CANC/ABD/AWD/WO — fixtures that are decidedly not being played — and
 * rendered a live Momentum block for them.
 *
 * These tests drive the real MatchModal (not OverviewHero in isolation) so `hasLiveScore`
 * is computed by useMatchModalModel from the same status under test. That is what makes
 * the NS-past-kickoff case meaningful: it must show a score and hide Momentum, which is
 * only observable when both predicates are derived rather than injected.
 *
 * Momentum mathematics and visual design are out of scope here — see
 * MatchMomentumTimeline.test.tsx and tests/momentumEngine.test.js.
 */

afterEach(cleanup);

/** Whichever locale the environment resolves to, the copy is one of these. */
function eitherLocale(ns: "match", key: string): RegExp {
  const leaf = (d: typeof en) => (d[ns] as unknown as Record<string, string>)[key];
  const variants = [leaf(en), leaf(ro as unknown as typeof en)]
    .filter(Boolean)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(variants.join("|"));
}

const HOUR = 60 * 60 * 1000;

const MOMENTUM: NonNullable<PredictionRow["momentum"]> = {
  homeMomentum: 64,
  awayMomentum: 36,
  dominantTeam: "home",
  trend: "up",
  confidence: 80
};

function buildMatch(overrides: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 4242,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Arsenal", away: "Chelsea" },
    // An hour ago: past the kickoff poll window, so hasLiveScore turns on status alone.
    kickoff: new Date(Date.now() - HOUR).toISOString(),
    status: "1H",
    score: { home: 1, away: 0, minute: 33 },
    // Present so LiveWinProbabilityStrip can actually derive a strip — without lambdas
    // it returns null for every status and stops discriminating between the two gates.
    lambdas: { home: 1.6, away: 1.1 },
    momentum: MOMENTUM,
    probs: { p1: 50, pX: 28, p2: 22, pGG: 50, pO25: 55, pU35: 70, pO15: 78 },
    predictions: { oneXtwo: "1", gg: "GG", over25: "Peste 2.5", correctScore: "1-0" },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 72, odd: 1.8 },
    ...overrides
  } as PredictionRow;
}

function renderModal(overrides: Partial<PredictionRow> = {}) {
  render(
    <MatchModal
      match={buildMatch(overrides)}
      logoColors={{}}
      onClose={() => {}}
      hashColor={() => "rgb(120,120,120)"}
    />
  );
  // UX-C: Momentum lives behind the Live layer's one disclosure. The gate under
  // test is unchanged (OverviewHero still decides on isFixtureInPlay); the tests
  // open the disclosure when the layer exists so the slot can be observed.
  const card = (d: typeof en) => (d.card as unknown as Record<string, string>).momentum;
  const momentumTitle = new RegExp(`^(${card(en)}|${card(ro as unknown as typeof en)})`);
  const liveDetails = screen.queryAllByRole("button", { name: momentumTitle })[0];
  if (liveDetails) fireEvent.click(liveDetails);
}

/** The Momentum slot = the timeline when data exists, the "unavailable" note when it does not. */
function momentumSlotShown(): boolean {
  return (
    screen.queryAllByTestId("momentum-root").length > 0 ||
    screen.queryAllByText(eitherLocale("match", "momentumUnavailable")).length > 0
  );
}

/** Live score in the compact header — gated on hasLiveScore, untouched here. */
function liveScoreChipShown(): boolean {
  const centre = document.querySelector('[data-layer="header"] [data-slot="centre"]');
  return Boolean(centre && /--fp-live/.test(centre.className) && /\d/.test(centre.textContent || ""));
}

/** LiveWinProbabilityStrip — the OverviewHero line directly above the Momentum gate. */
function winProbabilityStripShown(): boolean {
  return screen.queryAllByText(eitherLocale("match", "liveWinTitle")).length > 0;
}

// ---------------------------------------------------------------------------
// Status matrix — the gate itself
// ---------------------------------------------------------------------------

/** Every status API-Football reports while a fixture is being played. */
const IN_PLAY_STATUSES = ["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT", "SUSP", "VAR"];

/** Finished, or never going to be played — Momentum is meaningless for all of them. */
const NOT_IN_PLAY_STATUSES = ["FT", "AET", "PEN", "NS", "TBD", "PST", "CANC", "ABD", "AWD", "WO"];

describe("Momentum gate — in-play statuses allow the Momentum slot", () => {
  for (const status of IN_PLAY_STATUSES) {
    it(`renders Momentum for ${status}`, () => {
      renderModal({ status });
      expect(momentumSlotShown(), `Momentum hidden for in-play status ${status}`).toBe(true);
    });
  }
});

describe("Momentum gate — non-in-play statuses hide the Momentum slot", () => {
  for (const status of NOT_IN_PLAY_STATUSES) {
    it(`hides Momentum for ${status}, even with momentum data and a numeric score`, () => {
      // Momentum data present and score numeric: only the status may hide the block.
      renderModal({ status });
      expect(momentumSlotShown(), `Momentum shown for non-in-play status ${status}`).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// The two branches of the gate move together
// ---------------------------------------------------------------------------

describe("Momentum gate — both branches share the predicate", () => {
  it("shows the unavailable note in-play when momentum data is missing", () => {
    renderModal({ status: "2H", momentum: null });
    expect(screen.queryAllByTestId("momentum-root").length).toBe(0);
    expect(
      screen.queryAllByText(eitherLocale("match", "momentumUnavailable")).length,
      "in-play fixture without momentum should explain the gap"
    ).toBeGreaterThan(0);
  });

  it("shows no note at all when the fixture is not in play and momentum is missing", () => {
    // The old gate leaked here too: an NS-past-kickoff fixture with no momentum
    // rendered "momentum unavailable" for a match that had not started.
    renderModal({ status: "NS", momentum: null });
    expect(
      screen.queryAllByText(eitherLocale("match", "momentumUnavailable")).length,
      "unavailable note shown for a fixture that is not in play"
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regression — the live score UI still keys off hasLiveScore
// ---------------------------------------------------------------------------

describe("live score strip is unaffected by the Momentum gate", () => {
  it("still shows a live score for an NS fixture past kickoff while hiding Momentum", () => {
    // This is the behaviour the loose hasLiveScore exists to protect: upstream status
    // lags behind reality, so a numeric score must still surface. Only Momentum waits
    // for a real in-play status.
    renderModal({ status: "NS" });
    expect(liveScoreChipShown(), "live score chip lost for NS past kickoff").toBe(true);
    expect(momentumSlotShown(), "Momentum shown for a fixture reported NS").toBe(false);
  });

  it("still shows a live score for a TBD fixture past kickoff while hiding Momentum", () => {
    renderModal({ status: "TBD" });
    expect(liveScoreChipShown(), "live score chip lost for TBD past kickoff").toBe(true);
    expect(momentumSlotShown()).toBe(false);
  });

  it("shows both the live score and Momentum for a genuinely in-play fixture", () => {
    renderModal({ status: "1H" });
    expect(liveScoreChipShown()).toBe(true);
    expect(momentumSlotShown()).toBe(true);
  });

  it("keeps the live score hidden for a final fixture, as before", () => {
    renderModal({ status: "FT" });
    expect(liveScoreChipShown(), "final fixture must not read as live").toBe(false);
    expect(momentumSlotShown()).toBe(false);
  });

  it("does not show a live score before the kickoff poll window opens", () => {
    renderModal({ status: "NS", kickoff: new Date(Date.now() + 3 * HOUR).toISOString() });
    expect(liveScoreChipShown()).toBe(false);
    expect(momentumSlotShown()).toBe(false);
  });

  /**
   * The win-probability strip sits on the line directly above the Momentum gate and is the
   * easiest thing to convert by accident. Its JSX guard is not independently observable,
   * though: deriveLiveWinProbability returns null unless the status is in play AND both
   * scores are numbers, and in exactly that state hasLiveScore is true by construction —
   * so swapping its guard for isFixtureInPlay (or removing it) changes no output. These
   * tests therefore pin the strip's rendered behaviour, which is what a regression would
   * actually break; the guard itself is pinned by review, not by assertion.
   */
  it("shows the win-probability strip for a genuinely live fixture", () => {
    renderModal({ status: "1H" });
    expect(winProbabilityStripShown()).toBe(true);
  });

  it("keeps the win-probability strip absent when there is no numeric score to derive from", () => {
    renderModal({ status: "1H", score: { home: null, away: null, minute: 20 } });
    expect(winProbabilityStripShown()).toBe(false);
    // ...while Momentum, on the new predicate, is visible for that very same fixture.
    expect(momentumSlotShown(), "Momentum should not wait for a score").toBe(true);
  });

  it("keeps the win-probability strip absent once the fixture is final", () => {
    renderModal({ status: "FT" });
    expect(winProbabilityStripShown()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The gate reads status, not score presence
// ---------------------------------------------------------------------------

describe("Momentum gate is independent of score availability", () => {
  it("shows Momentum for an in-play fixture whose score has not arrived yet", () => {
    // hasLiveScore is false here (no numeric score), so the old gate hid Momentum
    // for a match that is demonstrably being played.
    renderModal({ status: "1H", score: { home: null, away: null, minute: 12 } });
    expect(liveScoreChipShown(), "no numeric score means no live chip").toBe(false);
    expect(momentumSlotShown(), "Momentum hidden for an in-play fixture missing a score").toBe(true);
  });

  it("opens the Momentum slot in-play even with no score object at all", () => {
    // No score means hasLiveScore is false outright, so the old gate closed the slot.
    // Asserted via the unavailable note: MatchMomentumTimeline has its own separate
    // `!history.length` return (it needs a minute to accumulate history), which this
    // PR deliberately does not touch — so the note is the observable proof the slot
    // itself is open on status alone.
    renderModal({ status: "2H", score: undefined, momentum: null });
    expect(
      screen.queryAllByText(eitherLocale("match", "momentumUnavailable")).length,
      "Momentum slot closed for an in-play fixture with no score"
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Status normalisation the shared helper already guarantees
// ---------------------------------------------------------------------------

describe("Momentum gate normalises status like the rest of the app", () => {
  it("accepts lowercase and padded in-play statuses", () => {
    renderModal({ status: " 1h " });
    expect(momentumSlotShown(), "shared isFixtureInPlay normalisation not applied").toBe(true);
  });

  it("hides Momentum for an empty status", () => {
    renderModal({ status: "" });
    expect(momentumSlotShown()).toBe(false);
  });
});
