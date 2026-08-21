import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MatchModal from "../MatchModal";
import { LocaleProvider } from "../../context/LocaleContext";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";
import {
  RUNNING_SCORE_WINDOW_AFTER_MS,
  RUNNING_SCORE_WINDOW_BEFORE_MS,
  TERMINAL_NON_FINAL_STATUSES,
  hasRunningScore,
  isFixtureInPlay,
  isTerminalOrAbandonedStatus
} from "../../utils/appUtils";
import { shouldPollFixtureScore } from "../../hooks/useLiveFixtureScorePoll";
import { deriveLiveWinProbability } from "../../utils/liveWinProbability";

/**
 * LIVE STATE CONSISTENCY — the state matrix.
 *
 * Two questions, asserted separately for every state:
 *   SCORE  — does a running score exist / print?         (hasRunningScore)
 *   LIVE   — is the match being played?                  (isFixtureInPlay)
 * plus what each answer unlocks: the LIVE label / colour / dot, the Live layer,
 * Momentum, events, stats, the win-probability strip, polling, final rendering.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`${esc(E[ns][key])}|${esc(R[ns][key])}`);

const HOUR = 60 * 60 * 1000;
const MOMENTUM = { homeMomentum: 64, awayMomentum: 36, dominantTeam: "home", trend: "up", confidence: 80 } as const;
const EVENTS = [{ minute: 12, team: "home", type: "goal", player: "Saka" }];

function row(overrides: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 777,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Arsenal", away: "Chelsea" },
    kickoff: new Date(Date.now() - HOUR).toISOString(),
    status: "1H",
    score: { home: 1, away: 0, minute: 33 },
    lambdas: { home: 1.6, away: 1.1 },
    momentum: MOMENTUM,
    liveEvents: EVENTS,
    probs: { p1: 50, pX: 28, p2: 22, pGG: 50, pO25: 55, pU35: 70, pO15: 78 },
    predictions: { oneXtwo: "1", gg: "GG", over25: "Peste 2.5", correctScore: "1-0" },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 72, odd: 1.8 },
    ...overrides
  } as unknown as PredictionRow;
}

afterEach(cleanup);

function mount(r: PredictionRow) {
  render(
    <LocaleProvider>
      <MatchModal match={r} logoColors={{}} onClose={() => {}} hashColor={() => "rgb(120,120,120)"} />
    </LocaleProvider>
  );
  // UX-D: Momentum, events and stats sit behind the Live layer's disclosures;
  // open whichever exist so the slots can be observed (their presence is the
  // assertion, never the disclosure itself).
  for (const key of ["momentum"]) {
    const btn = screen.queryAllByRole("button", { name: either("card", key) })[0];
    if (btn) fireEvent.click(btn);
  }
  for (const key of ["eventsTitle", "statsTitle"]) {
    const btn = screen.queryAllByRole("button", { name: either("detail", key) })[0];
    if (btn) fireEvent.click(btn);
  }
}

const q = (sel: string) => document.querySelector(sel);
const header = () => q('[data-layer="header"]');
const centre = () => header()?.querySelector('[data-slot="centre"]') ?? null;
const statusSlot = () => header()?.querySelector('[data-slot="status"]') ?? null;
const obs = (r: PredictionRow, nowMs = Date.now()) => ({
  runningScore: hasRunningScore(r, nowMs),
  scorePrinted: /\d+–\d+/.test(centre()?.textContent || ""),
  liveLabel: Boolean(statusSlot() && (either("card", "live").test(statusSlot()!.textContent || "") || /\d+'/.test(statusSlot()!.textContent || ""))),
  liveColour: /--fp-live/.test(centre()?.className || ""),
  liveDot: Boolean(statusSlot()?.querySelector("[class*='animate-pulse']")),
  liveLayer: Boolean(q('[data-layer="live"]')),
  momentum: screen.queryAllByTestId("momentum-root").length > 0 || screen.queryAllByText(either("match", "momentumUnavailable")).length > 0,
  events: Boolean(q('[data-slot="live-events"]')) || screen.queryAllByText(either("detail", "eventsTitle")).length > 0,
  stats: Boolean(q('[data-slot="live-stats"]')) || screen.queryAllByText(either("detail", "statsTitle")).length > 0,
  winProbability: deriveLiveWinProbability(r) != null,
  polling: shouldPollFixtureScore(r),
  finalLabel: either("list", "fullTimeShort").test(statusSlot()?.textContent || ""),
  vsPrinted: either("common", "vs").test(centre()?.textContent || ""),
  kickoffTimePrinted: /\d{1,2}:\d{2}/.test(centre()?.textContent || "")
});

type Expect = Partial<ReturnType<typeof obs>>;
const cases: Array<{ name: string; build: () => PredictionRow; expect: Expect }> = [
  {
    name: "1 · pre-kickoff NS (no score)",
    build: () => row({ status: "NS", kickoff: new Date(Date.now() + 3 * HOUR).toISOString(), score: { home: null, away: null }, momentum: null, liveEvents: [] }),
    expect: { runningScore: false, scorePrinted: false, vsPrinted: false, kickoffTimePrinted: true, liveLabel: false, liveColour: false, liveDot: false, liveLayer: false, momentum: false, events: false, stats: false, winProbability: false, polling: false, finalLabel: false }
  },
  {
    name: "2 · NS inside the kickoff window + score",
    build: () => row({ status: "NS", kickoff: new Date(Date.now() - HOUR).toISOString(), momentum: null, liveEvents: [] }),
    expect: { runningScore: true, scorePrinted: true, liveLabel: false, liveColour: false, liveDot: false, liveLayer: true, momentum: false, events: false, stats: false, winProbability: false, polling: true, finalLabel: false }
  },
  {
    name: "2b · TBD inside the kickoff window + score",
    build: () => row({ status: "TBD", kickoff: new Date(Date.now() - HOUR).toISOString(), momentum: null, liveEvents: [] }),
    expect: { runningScore: true, scorePrinted: true, liveLabel: false, liveColour: false, liveDot: false, momentum: false, polling: true }
  },
  {
    name: "3 · NS beyond kickoff + 4h + score",
    build: () => row({ status: "NS", kickoff: new Date(Date.now() - 5 * HOUR).toISOString(), momentum: null, liveEvents: [] }),
    expect: { runningScore: false, scorePrinted: false, liveLabel: false, liveColour: false, liveDot: false, liveLayer: false, momentum: false, events: false, stats: false, winProbability: false, polling: false, finalLabel: false }
  },
  {
    name: "4 · 1H + score",
    build: () => row({ status: "1H" }),
    expect: { runningScore: true, scorePrinted: true, liveLabel: true, liveColour: true, liveDot: true, liveLayer: true, momentum: true, events: true, stats: false, winProbability: true, polling: true, finalLabel: false }
  },
  {
    name: "5 · 1H + null score",
    build: () => row({ status: "1H", score: { home: null, away: null, minute: 12 } }),
    expect: { runningScore: false, scorePrinted: false, vsPrinted: true, kickoffTimePrinted: false, liveLabel: true, liveColour: true, liveDot: true, liveLayer: true, momentum: true, events: true, winProbability: false, polling: true, finalLabel: false }
  },
  {
    name: "6 · HT + score",
    // minute 45 as the provider sends it at the break — the timeline plots from minute samples.
    build: () => row({ status: "HT", score: { home: 1, away: 0, minute: 45 } }),
    expect: { runningScore: true, scorePrinted: true, liveLabel: true, liveColour: true, liveDot: true, liveLayer: true, momentum: true, winProbability: true, polling: true }
  },
  {
    name: "7 · 2H + score",
    build: () => row({ status: "2H", score: { home: 2, away: 1, minute: 70 } }),
    expect: { runningScore: true, scorePrinted: true, liveLabel: true, liveColour: true, liveDot: true, momentum: true, winProbability: true, polling: true }
  },
  {
    name: "8 · 2H + null score",
    build: () => row({ status: "2H", score: { home: null, away: null, minute: 70 } }),
    expect: { runningScore: false, scorePrinted: false, vsPrinted: true, kickoffTimePrinted: false, liveLabel: true, liveColour: true, liveDot: true, liveLayer: true, momentum: true, winProbability: false, polling: true }
  },
  {
    name: "9 · ET + score",
    build: () => row({ status: "ET", score: { home: 2, away: 2, minute: 100 } }),
    expect: { runningScore: true, scorePrinted: true, liveLabel: true, liveColour: true, liveDot: true, momentum: true, winProbability: false, polling: true }
  },
  {
    name: "10 · FT + score",
    build: () => row({ status: "FT", score: { home: 2, away: 1 }, momentum: null }),
    expect: { runningScore: false, scorePrinted: true, liveLabel: false, liveColour: false, liveDot: false, liveLayer: false, momentum: false, events: false, winProbability: false, polling: false, finalLabel: true }
  },
  {
    name: "11 · FT + null score",
    build: () => row({ status: "FT", score: { home: null, away: null }, momentum: null }),
    expect: { runningScore: false, scorePrinted: false, liveLabel: false, liveColour: false, liveDot: false, liveLayer: false, momentum: false, winProbability: false, polling: false }
  },
  ...(["CANC", "PST", "ABD", "AWD", "WO"] as const).map((status, i) => ({
    name: `${12 + i} · ${status} + score`,
    build: () => row({ status, score: { home: 1, away: 0 } }),
    expect: { runningScore: false, scorePrinted: false, liveLabel: false, liveColour: false, liveDot: false, liveLayer: false, momentum: false, events: false, stats: false, winProbability: false, polling: false, finalLabel: false } as Expect
  }))
];

describe("live state matrix — SCORE and LIVE answered separately for every state", () => {
  for (const c of cases) {
    it(c.name, () => {
      const r = c.build();
      mount(r);
      const o = obs(r);
      for (const [key, want] of Object.entries(c.expect)) {
        expect(o[key as keyof typeof o], `${c.name} → ${key}`).toBe(want);
      }
    });
  }
});

describe("hasRunningScore — the predicate itself", () => {
  const ko = Date.parse("2026-08-21T19:00:00Z");
  const at = (offsetMs: number) => ko + offsetMs;
  const ns = (score: PredictionRow["score"]) => ({ status: "NS", kickoff: new Date(ko).toISOString(), score });

  it("null stays null: a null or missing score is never a running score", () => {
    expect(hasRunningScore(ns({ home: null, away: null }), at(HOUR))).toBe(false);
    expect(hasRunningScore(ns({ home: 1, away: null }), at(HOUR))).toBe(false);
    expect(hasRunningScore({ status: "1H", kickoff: new Date(ko).toISOString() }, at(HOUR))).toBe(false);
    expect(hasRunningScore({ status: "1H", kickoff: new Date(ko).toISOString(), score: null }, at(HOUR))).toBe(false);
  });

  it("0 is a real score", () => {
    expect(hasRunningScore(ns({ home: 0, away: 0 }), at(HOUR))).toBe(true);
    expect(hasRunningScore({ status: "1H", kickoff: new Date(ko).toISOString(), score: { home: 0, away: 0 } }, at(HOUR))).toBe(true);
  });

  it("score presence is an explicit numeric check, not truthiness", () => {
    expect(hasRunningScore(ns({ home: "1" as unknown as number, away: 0 }), at(HOUR))).toBe(false);
    expect(hasRunningScore(ns({ home: Number.NaN, away: 0 }), at(HOUR))).toBe(false);
  });

  it("the grace window is kickoff − 15 min … kickoff + 4 h, inclusive at both ends", () => {
    const s = ns({ home: 0, away: 0 });
    expect(hasRunningScore(s, at(-RUNNING_SCORE_WINDOW_BEFORE_MS - 1))).toBe(false);
    expect(hasRunningScore(s, at(-RUNNING_SCORE_WINDOW_BEFORE_MS))).toBe(true);
    expect(hasRunningScore(s, at(RUNNING_SCORE_WINDOW_AFTER_MS))).toBe(true);
    expect(hasRunningScore(s, at(RUNNING_SCORE_WINDOW_AFTER_MS + 1))).toBe(false);
    expect(RUNNING_SCORE_WINDOW_BEFORE_MS).toBe(15 * 60 * 1000);
    expect(RUNNING_SCORE_WINDOW_AFTER_MS).toBe(4 * HOUR);
  });

  it("in play ignores the window; terminal / abandoned / final never qualify, even inside it", () => {
    expect(hasRunningScore({ status: "2H", kickoff: new Date(ko).toISOString(), score: { home: 1, away: 0 } }, at(9 * HOUR))).toBe(true);
    for (const status of ["FT", "AET", "PEN", ...TERMINAL_NON_FINAL_STATUSES]) {
      expect(hasRunningScore({ status, kickoff: new Date(ko).toISOString(), score: { home: 1, away: 0 } }, at(HOUR)), status).toBe(false);
      expect(isTerminalOrAbandonedStatus(status), status).toBe(true);
      expect(isFixtureInPlay(status), status).toBe(false);
    }
    expect(hasRunningScore({ status: " abd ", kickoff: new Date(ko).toISOString(), score: { home: 1, away: 0 } }, at(HOUR))).toBe(false);
  });

  it("an unparseable kickoff gives no grace (status alone must carry it)", () => {
    expect(hasRunningScore({ status: "NS", kickoff: "nope", score: { home: 0, away: 0 } }, at(HOUR))).toBe(false);
    expect(hasRunningScore({ status: "1H", kickoff: "nope", score: { home: 0, away: 0 } }, at(HOUR))).toBe(true);
  });

  it("the poller and the predicate share one terminal set", () => {
    expect([...TERMINAL_NON_FINAL_STATUSES].sort()).toEqual(["ABD", "AWD", "CANC", "PST", "WO"]);
    for (const status of TERMINAL_NON_FINAL_STATUSES) {
      expect(shouldPollFixtureScore(row({ status }) as PredictionRow), status).toBe(false);
    }
  });
});
