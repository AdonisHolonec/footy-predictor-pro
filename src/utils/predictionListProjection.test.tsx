import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PredictionRow } from "../types";
import { useLocalStorageState } from "./appUtils";
import { hasLegacyPredictionShape } from "../pages/userDashboard/helpers";
import {
  projectPredictionForStorage,
  projectPredictionRowsForStorage,
  projectPredictionsByUserForStorage
} from "./predictionListProjection";

/**
 * The storage projection.
 *
 * Real production rows are ~245 KB each and were written to localStorage
 * verbatim; a 50-fixture Predict is ~11.7 MB against a per-origin budget of
 * roughly 5 MB, and the write error is swallowed, so the key froze at whatever
 * last fit. Observed in a real browser: 23 fixture ids recorded in the small
 * companion key, 4 rows surviving in the large one, and those 4 were exactly
 * indices 0..3 of the insertion order.
 *
 * The claim under test is narrow and specific: state stays FULL, disk goes slim.
 * Everything below asserts observable behaviour — what a reader can still get
 * out of a projected row, and what actually lands in localStorage versus what
 * the hook hands back.
 */

const HEAVY_KEYS = [
  "monteCarlo",
  "modelMeta",
  "predictionLaboratory",
  "leagueStandings",
  "predictionContributions",
  "odds",
  "auditLog",
  "historyMeta",
  "lambdas",
  "luckStats",
  "evaluation",
  "leagueProfile",
  "venue",
  "fixtureTeamIds"
];

const CARD_MARKET = { type: "Cards Over 3.5", family: "Cards", probability: 62, line: 3.5, expectedValue: 0.04 };

function fullRow(overrides: Record<string, unknown> = {}): PredictionRow {
  const heavy: Record<string, unknown> = {};
  for (const k of HEAVY_KEYS) heavy[k] = { padding: "x".repeat(200) };
  return {
    id: 4242,
    leagueId: 283,
    league: "Liga I",
    teams: { home: "A", away: "B" },
    logos: { home: "h.png", away: "a.png" },
    kickoff: "2026-08-18T18:00:00+00:00",
    status: "NS",
    score: { home: null, away: null },
    validation: "pending",
    savedAt: "2026-08-18T09:00:00+00:00",
    modelVersion: "v3-dc-bp-shin-2026-04",
    recommended: { pick: "Over 2.5", confidence: 70, odd: 1.9 },
    probs: { corners: { total: 9.5 }, shotsOnTarget: { total: 8.5 }, firstHalf: { pO15: 55 }, pGG: 51 },
    predictions: { marketTiers: { over25: { tier: "strong" } }, cards: "Over 3.5" },
    cardMarkets: { corners: {} },
    cardMarketValidations: { corners: "win" },
    marketResults: { cornersTotal: 9 },
    marketOdds: { cards: { line: 3.5, odd: 1.8 }, corners: {}, btts: { odd: 1.7 } },
    confidenceEngine: { overall: 71, liveAdjustment: null },
    explanation: { why: ["reason"] },
    featureImportance: { top: ["xg"] },
    teamContext: { home: {} },
    momentum: null,
    valueBet: { detected: true, ev: 0.14, type: "Over 2.5" },
    referee: "R. Referee",
    ...heavy,
    valueEngine: {
      expectedValue: 0.14,
      edge: 0.06,
      signal: "positive",
      detected: true,
      recommendable: true,
      negativeEV: false,
      positiveEV: true,
      kellyPct: 3.2,
      valueScore: 71,
      type: "Over 2.5",
      family: "Over/Under",
      bestMarket: { type: "Over 2.5", family: "Over/Under", odds: 1.9 },
      positiveEvCount: 23,
      negativeEvCount: 116,
      familiesSupported: ["Over/Under"],
      familiesPresent: ["Over/Under"],
      markets: [
        { type: "Over 2.5", family: "Over/Under", probability: 60 },
        CARD_MARKET,
        { type: "Under 2.5", family: "Over/Under", probability: 40 }
      ],
      positiveMarkets: [{ type: "Over 2.5" }],
      negativeMarkets: [{ type: "Under 2.5" }]
    },
    ...overrides
  } as unknown as PredictionRow;
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

afterEach(() => cleanup());

describe("prediction storage projection", () => {
  it("keeps every field the restored board renders from", () => {
    const p = projectPredictionForStorage(fullRow()) as unknown as Record<string, unknown>;
    for (const key of [
      "id",
      "leagueId",
      "league",
      "teams",
      "logos",
      "kickoff",
      "status",
      "score",
      "validation",
      "savedAt",
      "modelVersion",
      "recommended",
      "probs",
      "predictions",
      "cardMarketValidations",
      "marketResults",
      "marketOdds",
      "confidenceEngine",
      "explanation",
      "featureImportance",
      "teamContext",
      "valueBet",
      "referee"
    ]) {
      expect(p[key], `${key} was dropped`).toBeDefined();
    }
  });

  it("drops the analytical fields nothing on the board reads", () => {
    const p = projectPredictionForStorage(fullRow()) as unknown as Record<string, unknown>;
    for (const key of HEAVY_KEYS) {
      expect(key in p, `${key} survived the projection`).toBe(false);
    }
  });

  it("keeps a projected paid-tier row out of the legacy-shape refetch", () => {
    // If probs.corners / probs.shotsOnTarget were dropped, every restored row
    // would look stale to ULTRA and re-arm the rehydrate that produced it.
    const projected = projectPredictionForStorage(fullRow());
    expect(hasLegacyPredictionShape([projected], "ultra")).toBe(false);
    expect(hasLegacyPredictionShape([projected], "premium")).toBe(false);
    expect(hasLegacyPredictionShape([projected], "free")).toBe(false);
  });

  it("keeps the valueEngine scalars and bestMarket", () => {
    const engine = projectPredictionForStorage(fullRow()).valueEngine as unknown as Record<string, unknown>;
    expect(engine.expectedValue).toBe(0.14);
    expect(engine.edge).toBe(0.06);
    expect(engine.kellyPct).toBe(3.2);
    expect(engine.valueScore).toBe(71);
    expect(engine.signal).toBe("positive");
    expect(engine.recommendable).toBe(true);
    expect(engine.positiveEvCount).toBe(23);
    expect(engine.negativeEvCount).toBe(116);
    expect(engine.bestMarket).toEqual({ type: "Over 2.5", family: "Over/Under", odds: 1.9 });
  });

  it("keeps exactly the one card market specialBet looks for", () => {
    const engine = projectPredictionForStorage(fullRow()).valueEngine as unknown as Record<string, unknown>;
    expect(engine.markets).toEqual([CARD_MARKET]);
  });

  it("omits markets entirely when no card market exists", () => {
    const row = fullRow();
    (row.valueEngine as unknown as Record<string, unknown>).markets = [{ type: "Over 2.5", family: "Over/Under" }];
    const engine = projectPredictionForStorage(row).valueEngine as unknown as Record<string, unknown>;
    expect("markets" in engine).toBe(false);
  });

  it("does not mutate the row it projects", () => {
    const row = fullRow();
    const before = JSON.stringify(row);
    projectPredictionForStorage(row);
    expect(JSON.stringify(row)).toBe(before);
    expect((row as unknown as Record<string, unknown>).monteCarlo).toBeDefined();
  });

  it("is materially smaller than the row it came from", () => {
    const row = fullRow();
    expect(bytes(projectPredictionForStorage(row))).toBeLessThan(bytes(row) / 2);
  });

  it("projects arrays and per-user maps", () => {
    const rows = projectPredictionRowsForStorage([fullRow(), fullRow({ id: 7 })]);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect("monteCarlo" in (r as unknown as Record<string, unknown>)).toBe(false);

    const map = projectPredictionsByUserForStorage({ u1: [fullRow()], u2: [] });
    expect(Object.keys(map).sort()).toEqual(["u1", "u2"]);
    expect("monteCarlo" in (map.u1[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it("tolerates malformed input", () => {
    expect(projectPredictionForStorage(null as unknown as PredictionRow)).toBe(null);
    expect(projectPredictionRowsForStorage(null as unknown as PredictionRow[])).toBe(null);
    const noEngine = projectPredictionForStorage({ id: 1 } as unknown as PredictionRow) as unknown as Record<
      string,
      unknown
    >;
    expect("valueEngine" in noEngine).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* the boundary: state stays full, disk goes slim                       */
/* ------------------------------------------------------------------ */

const KEY = "test.predictions";

function Harness({
  project,
  onState
}: {
  project?: (v: PredictionRow[]) => PredictionRow[];
  onState: (v: PredictionRow[], set: (v: PredictionRow[]) => void) => void;
}) {
  const [v, setV] = useLocalStorageState<PredictionRow[]>(KEY, [], project);
  onState(v, setV as (next: PredictionRow[]) => void);
  return null;
}

function mountHarness(project?: (v: PredictionRow[]) => PredictionRow[]) {
  let state: PredictionRow[] = [];
  let setState: (v: PredictionRow[]) => void = () => {};
  render(
    <Harness
      project={project}
      onState={(v, s) => {
        state = v;
        setState = s;
      }}
    />
  );
  return {
    state: () => state,
    set: (rows: PredictionRow[]) => act(() => setState(rows)),
    stored: () => JSON.parse(localStorage.getItem(KEY) || "[]") as Record<string, unknown>[]
  };
}

describe("useLocalStorageState serialization boundary", () => {
  beforeEach(() => localStorage.clear());

  it("writes the projected value while state keeps the whole row", () => {
    const h = mountHarness(projectPredictionRowsForStorage);
    h.set([fullRow()]);

    // state: untouched, so the modal and card readers still see everything
    expect((h.state()[0] as unknown as Record<string, unknown>).monteCarlo).toBeDefined();
    expect((h.state()[0].valueEngine as unknown as Record<string, unknown>).markets).toHaveLength(3);

    // disk: narrowed
    expect("monteCarlo" in h.stored()[0]).toBe(false);
    expect((h.stored()[0].valueEngine as Record<string, unknown>).markets).toEqual([CARD_MARKET]);
  });

  it("stores materially fewer bytes than the in-memory value", () => {
    const h = mountHarness(projectPredictionRowsForStorage);
    const rows = [fullRow(), fullRow({ id: 2 }), fullRow({ id: 3 })];
    h.set(rows);
    expect(bytes(h.stored())).toBeLessThan(bytes(rows) / 2);
  });

  it("stores the value verbatim when no projection is supplied", () => {
    const h = mountHarness();
    h.set([fullRow()]);
    expect("monteCarlo" in h.stored()[0]).toBe(true);
    expect((h.stored()[0].valueEngine as Record<string, unknown>).markets).toHaveLength(3);
  });

  it("restores from the projected value on a fresh mount", () => {
    const first = mountHarness(projectPredictionRowsForStorage);
    first.set([fullRow()]);
    cleanup();

    const second = mountHarness(projectPredictionRowsForStorage);
    expect(second.state()).toHaveLength(1);
    expect(second.state()[0].id).toBe(4242);
    // and a restored row must still not look legacy
    expect(hasLegacyPredictionShape(second.state(), "ultra")).toBe(false);
  });
});
