import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LiveLayer from "./LiveLayer";
import MatchMomentumTimeline, { mergeHistoryPoints, statLabel } from "../ux/MatchMomentumTimeline";
import { translate } from "../../i18n/translate";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { MomentumRawStats, PredictionRow } from "../../types";

/**
 * Live forensic fix — Frosinone 0–1 Juventus, 63'. Three independent root causes:
 *   1. the momentum chart drew the single reading taken at open as one 0'–63' slab;
 *   2. Momentum repeated the stat chips and the recent-event strip that the Live layer
 *      already shows as its own STATS / EVENTS disclosures;
 *   3. yellow/red card rows in LIVE STATS had no label (statLabel fell through to "").
 */

type Momentum = NonNullable<PredictionRow["momentum"]>;
type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const tr = (key: string, params?: Record<string, string | number>) => translate("ro", key, params);

const RAW: { home: MomentumRawStats; away: MomentumRawStats } = {
  home: { possession: 39, shotsTotal: 4, shotsOnTarget: 1, corners: 0, yellowCards: 1, redCards: 0 },
  away: { possession: 61, shotsTotal: 14, shotsOnTarget: 5, corners: 9, yellowCards: 0, redCards: 0 }
};
const MOMENTUM: Momentum = {
  homeMomentum: 24,
  awayMomentum: 76,
  dominantTeam: "away",
  trend: "stable",
  confidence: 70,
  raw: RAW
};
const EVENTS = [
  { minute: 22, team: "away", type: "goal", player: "Bremer" },
  { minute: 43, team: "home", type: "yellow", player: "R. Schmid" },
  { minute: 50, team: "away", type: "yellow", player: "Z. Celik" }
];

function frosinoneJuventus(extra: Partial<Momentum> = {}): PredictionRow {
  return {
    id: 1607999,
    leagueId: 135,
    league: "Serie A",
    teams: { home: "Frosinone", away: "Juventus" },
    kickoff: "2026-08-23T17:30:00.000Z",
    status: "2H",
    logos: { home: "https://img/h.png", away: "https://img/a.png" },
    score: { home: 0, away: 1, minute: 63 },
    probs: { p1: 20, pX: 28, p2: 52, pGG: 45, pO25: 50, pU35: 70, pO15: 78 },
    predictions: { oneXtwo: "2", gg: "NG", over25: "Under 2.5", correctScore: "0-1" },
    recommended: { pick: "Shots Under 30.5", family: "Shots", confidence: 91, odd: 1.5 },
    momentum: { ...MOMENTUM, ...extra },
    liveEvents: EVENTS
  } as unknown as PredictionRow;
}

function renderLive(match: PredictionRow) {
  return render(<LiveLayer match={match} tr={tr} hasLiveScore confidenceLabel="91%" recommendedPick="Shots Under 30.5" />);
}

const open = (title: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${title}`) }));
const bars = () => Array.from(screen.getByTestId("momentum-chart").querySelectorAll<HTMLElement>("[data-side]"));

afterEach(cleanup);

describe("A · momentum rendering — one reading is a point, not a 0'→now slab", () => {
  it("opened at 63' with a single reading: no bar spans kick-off to now, the unobserved lead stays blank", () => {
    renderLive(frosinoneJuventus({ history: [{ minute: 63, homeMomentum: 24, awayMomentum: 76 }] }));
    open(R.card.momentum);
    const [only] = bars();
    expect(bars()).toHaveLength(1);
    expect(only.dataset.side).toBe("away");
    expect(only.style.flexGrow).toBe("1");
    expect(screen.getByTestId("momentum-unobserved").style.flexGrow).toBe("63");
    expect(screen.queryByTestId("momentum-dominant-bracket")).toBeNull();
    // Opened at 63': the specific statement is "partial history from 63'", not the generic
    // "still collecting" — both are true, the more informative one wins.
    expect(screen.getByTestId("momentum-partial").textContent).toContain("63");
    expect(screen.queryByTestId("momentum-collecting")).toBeNull();
  });

  it("draws one bar per observed interval from the row history, home above and away below, in order", () => {
    renderLive(
      frosinoneJuventus({
        history: [
          { minute: 48, homeMomentum: 58, awayMomentum: 42 },
          { minute: 52, homeMomentum: 50, awayMomentum: 50 },
          { minute: 57, homeMomentum: 30, awayMomentum: 70 },
          { minute: 63, homeMomentum: 24, awayMomentum: 76 }
        ]
      })
    );
    open(R.card.momentum);
    const all = bars();
    expect(all.map((b) => b.dataset.side)).toEqual(["home", "neutral", "away", "away"]);
    expect(all.map((b) => b.style.flexGrow)).toEqual(["1", "4", "5", "6"]);
    expect(screen.queryByTestId("momentum-collecting")).toBeNull();
    // Both series coexist: a home bar only above the axis, an away bar only below it.
    const home = all[0].children;
    expect(home[0].querySelector("span")).not.toBeNull();
    expect(home[1].querySelector("span")).toBeNull();
    const away = all[3].children;
    expect(away[0].querySelector("span")).toBeNull();
    expect(away[1].querySelector("span")).not.toBeNull();
  });

  it("marks the live minute on the chart", () => {
    renderLive(frosinoneJuventus({ history: [{ minute: 63, homeMomentum: 24, awayMomentum: 76 }] }));
    open(R.card.momentum);
    expect(screen.getByTestId("momentum-now").style.left).toBe("70%");
  });

  it("invalid readings never become geometry: NaN / Infinity / undefined points are dropped", () => {
    const history = [
      { minute: 40, homeMomentum: 60, awayMomentum: 40 },
      { minute: Number.NaN, homeMomentum: 60, awayMomentum: 40 },
      { minute: 50, homeMomentum: Number.POSITIVE_INFINITY, awayMomentum: 40 },
      { minute: 55, homeMomentum: undefined as unknown as number, awayMomentum: 40 },
      { minute: 63, homeMomentum: 24, awayMomentum: 76 }
    ];
    expect(mergeHistoryPoints(history, []).map((p) => p.minute)).toEqual([40, 63]);
    renderLive(frosinoneJuventus({ history }));
    open(R.card.momentum);
    for (const bar of bars()) {
      for (const span of bar.querySelectorAll<HTMLElement>("span")) {
        expect(span.style.height).toMatch(/^\d+%$/);
      }
      expect(bar.style.flexGrow).toMatch(/^\d+$/);
    }
  });

  it("negative and positive differences both classify, symmetrically", () => {
    renderLive(
      frosinoneJuventus({
        history: [
          { minute: 10, homeMomentum: 80, awayMomentum: 20 },
          { minute: 20, homeMomentum: 20, awayMomentum: 80 }
        ]
      })
    );
    open(R.card.momentum);
    // Third bar = the live reading itself (24–76 at 63'), appended by the widget.
    expect(bars().map((b) => `${b.dataset.side}:${b.dataset.level}`)).toEqual(["home:high", "away:high", "away:high"]);
  });

  it("row history and locally observed readings merge by minute, earliest source winning", () => {
    const merged = mergeHistoryPoints(
      [{ minute: 60, homeMomentum: 30, awayMomentum: 70 }],
      [
        { minute: 60, homeMomentum: 99, awayMomentum: 1 },
        { minute: 55, homeMomentum: 50, awayMomentum: 50 }
      ]
    );
    expect(merged).toEqual([
      { minute: 55, homeMomentum: 50, awayMomentum: 50 },
      { minute: 60, homeMomentum: 30, awayMomentum: 70 }
    ]);
  });

  it("with no readable minute at all the widget renders nothing — no empty chart", () => {
    render(
      <MatchMomentumTimeline
        fixtureId={1}
        status="2H"
        score={{ home: 0, away: 1, minute: null as unknown as number }}
        momentum={{ ...MOMENTUM, history: [] }}
        homeTeam="Frosinone"
        awayTeam="Juventus"
        recommendedPick="x"
        confidenceLabel="91%"
      />
    );
    expect(screen.queryByTestId("momentum-root")).toBeNull();
  });
});

describe("B · live stats — no value without label", () => {
  it("every rendered stat row carries a catalogue label; yellow and red cards are named", () => {
    renderLive(frosinoneJuventus());
    open(R.detail.statsTitle);
    const rows = Array.from(document.querySelector("[data-slot='live-stats']")!.querySelectorAll<HTMLElement>(":scope > div"));
    expect(rows).toHaveLength(6);
    const labels = rows.map((r) => r.querySelector("span:nth-child(3)")!.textContent?.trim());
    expect(labels).toEqual([
      R.match.momentumPossession,
      R.match.momentumShots,
      R.match.momentumShotsOnTarget,
      R.match.momentumCorners,
      R.match.momentumYellowCards,
      R.match.momentumRedCards
    ]);
    expect(labels.every((l) => l && l.length > 0)).toBe(true);
    expect(rows[4].textContent).toMatch(/1.*Galbene.*0/);
    // 0–0 (red cards) draws two empty bars, never two half-full ones.
    const fills = Array.from(rows[5].querySelectorAll<HTMLElement>("[style*=\"transform\"]"));
    expect(fills.map((f) => f.style.transform)).toEqual(["scaleX(0)", "scaleX(0)"]);
  });

  it("statLabel is total over MomentumRawStats in both locales", () => {
    const keys: Array<keyof MomentumRawStats> = ["possession", "shotsTotal", "shotsOnTarget", "corners", "yellowCards", "redCards"];
    for (const k of keys) {
      const roLabel = statLabel((key) => translate("ro", key), k);
      const enLabel = statLabel((key) => translate("en", key), k);
      expect(roLabel, k).not.toBe("");
      expect(enLabel, k).not.toBe("");
      expect(roLabel).not.toMatch(/^match\./);
      expect(enLabel).not.toMatch(/^match\./);
    }
    expect(E.match.momentumYellowCards).toBeTruthy();
    expect(E.match.momentumRedCards).toBeTruthy();
    expect(E.match.momentumCollecting).toBeTruthy();
  });
});

describe("C · duplication — Momentum states initiative, Live Stats owns the numbers, Events owns the list", () => {
  it("in the Live layer Momentum shows no stat chips and no recent-event strip", () => {
    renderLive(frosinoneJuventus({ history: [{ minute: 63, homeMomentum: 24, awayMomentum: 76 }] }));
    open(R.card.momentum);
    const root = screen.getByTestId("momentum-root");
    expect(root.textContent).not.toMatch(/Pe poartă 1–5/);
    expect(root.textContent).not.toMatch(/Posesie 39%/);
    expect(root.querySelectorAll("button")).toHaveLength(0);
    // The numbers live exactly once, in LIVE STATS.
    open(R.detail.statsTitle);
    expect(document.querySelectorAll("[data-slot='live-stats']")).toHaveLength(1);
    expect(document.querySelector("[data-slot='live-stats']")!.textContent).toMatch(/39%.*61%/);
    // The events live exactly once, in EVENTS.
    open(R.detail.eventsTitle);
    expect(document.querySelectorAll("[data-slot='live-events'] li")).toHaveLength(3);
  });

  it("outside the Live layer (detailsPanel on) the chips and moments are still available", () => {
    render(
      <MatchMomentumTimeline
        fixtureId={1}
        status="2H"
        score={{ home: 0, away: 1, minute: 63 }}
        momentum={MOMENTUM}
        homeTeam="Frosinone"
        awayTeam="Juventus"
        liveEvents={EVENTS as never}
        recommendedPick="x"
        confidenceLabel="91%"
      />
    );
    expect(screen.getByTestId("momentum-root").textContent).toMatch(/Pe poartă 1–5/);
  });
});
