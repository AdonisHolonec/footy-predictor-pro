import test from "node:test";
import assert from "node:assert/strict";

import { computeBacktestMetrics, extractBetEvent } from "../server-utils/backtest/BacktestAnalytics.js";

/**
 * D10a — the shared bet extractor reads promoted columns, and three dead
 * document branches are gone.
 *
 * This helper is NOT snapshot-only. Three production consumers reach it, and
 * every test below therefore pins behaviour for all of them:
 *
 *   handleSnapshot    -> extractBetEvent                     (the 03:00 cron)
 *   handleAnalytics   -> buildBacktestReport -> extractBetEvent
 *   handlePublicTrack -> buildBacktestReport -> extractBetEvent
 *
 * Two kinds of assertion live here, deliberately not mixed up:
 *
 *   - the promoted-column switches are provable no-ops, because the document
 *     copies rescued 0 production rows. The tests assert the column WINS while a
 *     CONTRADICTING payload is ignored — stronger than asserting equality, since
 *     it fails if the fallback ever creeps back.
 *   - the removed branches are asserted by planting a value in the dead field
 *     and proving it has no effect. A test that merely omitted the field would
 *     pass against the old code too, and prove nothing.
 *
 * What must NOT move is pinned just as hard: the valueBet.type chain, the kelly
 * chain, the odds candidates below the removed ones, and closing odds.
 */

/** A settled value bet: outcome, stake and a usable price, so an event is produced. */
function row(overrides = {}, payloadOverrides = {}) {
  return {
    fixture_id: 1,
    league_id: 39,
    league_name: "Premier League",
    home_team: "A",
    away_team: "B",
    kickoff_at: "2026-08-01T12:00:00.000Z",
    validation: "pending",
    value_bet_validation: "loss",
    odds_home: 2.5,
    odds_draw: 3.4,
    odds_away: 3.9,
    closing_odds_home: null,
    closing_odds_draw: null,
    closing_odds_away: null,
    score_home: 2,
    score_away: 1,
    recommended_pick: "Over 2.5",
    recommended_confidence: 70,
    raw_payload: {
      valueBet: { kelly: 2, type: "1" },
      valueEngine: { odds: 2.5, bestMarket: {} },
      recommended: { pick: "Over 2.5", confidence: 70 },
      ...payloadOverrides
    },
    ...overrides
  };
}

const ev = (r) => extractBetEvent(r);

/* ------------------------------------------------------------------ */
/* Promoted columns win — the payload copy is ignored                  */
/* ------------------------------------------------------------------ */

test("[A] value_bet_validation comes from the COLUMN; a contradicting payload is ignored", () => {
  const r = row({ value_bet_validation: "loss" }, { value_bet_validation: "win" });
  assert.equal(ev(r).won, false);

  const w = row({ value_bet_validation: "win" }, { value_bet_validation: "loss" });
  assert.equal(ev(w).won, true);
});

test("[A] a NULL value_bet_validation is no longer rescued by the document", () => {
  /*
    The old code read `row.value_bet_validation ?? payload.value_bet_validation`.
    Column NULL, payload "win": settlement must now fall through to the
    score/validation path instead of taking the document's word. Measured: the
    payload rescued 0 of 373 NULL columns in production.
  */
  const unaligned = row(
    { value_bet_validation: null, validation: "loss", score_home: null, score_away: null },
    { value_bet_validation: "win" }
  );
  // recommended_pick ("Over 2.5") does not align with type "1", so nothing
  // settles it at all — which is itself proof the document was not consulted.
  assert.equal(ev(unaligned), null, "the document must not settle this bet");

  // And where the row CAN settle itself, the row's own validation decides,
  // still not the document's "win".
  const aligned = row(
    {
      value_bet_validation: null,
      validation: "loss",
      score_home: null,
      score_away: null,
      recommended_pick: "1"
    },
    { value_bet_validation: "win" }
  );
  assert.equal(ev(aligned).won, false);
});

test("[B] recommended_pick comes from the COLUMN; the payload copy is ignored", () => {
  /*
    recommended_pick gates the "aligned" fallback. The column ("1") aligns with
    type "1" so row.validation decides; the old payload value ("2") would have
    blocked alignment and produced no event.
  */
  const aligned = row(
    {
      value_bet_validation: null,
      validation: "win",
      score_home: null,
      score_away: null,
      recommended_pick: "1"
    },
    {
      valueBet: { kelly: 2, type: "1" },
      valueEngine: { odds: 2.5, bestMarket: {} },
      recommended: { pick: "2" }
    }
  );
  assert.equal(ev(aligned).won, true);
});

test("[C] score_home/score_away come from the COLUMNS; payload.score is ignored", () => {
  // Columns 0-0 (Over 2.5 loses); the document claims 5-0.
  const r = row(
    {
      value_bet_validation: null,
      validation: "pending",
      score_home: 0,
      score_away: 0,
      recommended_pick: "Over 2.5"
    },
    {
      valueBet: { kelly: 2, type: "Over 2.5" },
      valueEngine: { odds: 2.5, bestMarket: {} },
      score: { home: 5, away: 0 }
    }
  );
  assert.equal(ev(r).won, false, "payload.score must not decide the outcome");
});

test("[D] a NULL score is not rescued by the document — it simply does not settle", () => {
  const r = row(
    { value_bet_validation: null, validation: "pending", score_home: null, score_away: null },
    {
      valueBet: { kelly: 2, type: "1" },
      valueEngine: { odds: 2.5, bestMarket: {} },
      score: { home: 3, away: 0 }
    }
  );
  assert.equal(ev(r), null, "no outcome means no event, not a document-derived win");
});

/* ------------------------------------------------------------------ */
/* Dead branches removed — planted values must have NO effect          */
/* ------------------------------------------------------------------ */

test("[E] valueBet.confidence is ignored — the dead branch is gone", () => {
  // 0 of 916 production rows carried it. Planting 99 proves it no longer wins.
  const r = row(
    {},
    {
      valueBet: { kelly: 2, type: "1", confidence: 99 },
      valueEngine: { odds: 2.5, bestMarket: {} },
      recommended: { confidence: 70 }
    }
  );
  assert.equal(ev(r).confidence, 70, "recommended.confidence must still decide");
});

test("[F] valueBet.odds / valueBet.odd are ignored — the dead candidates are gone", () => {
  const viaBest = row(
    {},
    {
      valueBet: { kelly: 2, type: "1", odds: 9.99, odd: 8.88 },
      valueEngine: { odds: 2.5, bestMarket: { odds: 3.33 } }
    }
  );
  assert.equal(ev(viaBest).odd, 3.33, "best.odds must win");

  const viaVe = row(
    {},
    { valueBet: { kelly: 2, type: "1", odds: 9.99 }, valueEngine: { odds: 2.5, bestMarket: {} } }
  );
  assert.equal(ev(viaVe).odd, 2.5, "ve.odds must win");
});

test("[G] valueBet.prob / valueBet.probability are ignored — the dead branch is gone", () => {
  // No evaluation triple, so probability now comes from confidence alone.
  const r = row(
    {},
    {
      valueBet: { kelly: 2, type: "1", prob: 0.99, probability: 0.98 },
      valueEngine: { odds: 2.5, bestMarket: {} },
      recommended: { confidence: 40 }
    }
  );
  assert.equal(ev(r).prob, 0.4, "confidence/100 must be the second source");
});

/* ------------------------------------------------------------------ */
/* Active chains preserved — these must NOT move                       */
/* ------------------------------------------------------------------ */

test("[H] the valueBet.type chain is unchanged: type -> ve.type -> ve.bestMarket.type", () => {
  const direct = row({}, { valueBet: { kelly: 2, type: "X" }, valueEngine: { odds: 2.5, bestMarket: {} } });
  assert.equal(ev(direct).market, "X");

  const viaVe = row({}, { valueBet: { kelly: 2 }, valueEngine: { type: "2", odds: 2.5, bestMarket: {} } });
  assert.equal(ev(viaVe).market, "2");

  const viaBest = row(
    {},
    { valueBet: { kelly: 2 }, valueEngine: { odds: 2.5, bestMarket: { type: "Over 2.5" } } }
  );
  assert.equal(ev(viaBest).market, "Over 2.5", "market text is NOT normalised");
});

test("[H] value_bet_type (the promoted column) is deliberately NOT used here", () => {
  // D10a leaves this document-canonical: 547 rows resolve via valueEngine.
  const r = row(
    { value_bet_type: "SHOULD-BE-IGNORED" },
    { valueBet: { kelly: 2, type: "X" }, valueEngine: { odds: 2.5, bestMarket: {} } }
  );
  assert.equal(ev(r).market, "X");
});

test("[I] the kelly chain is unchanged: kelly -> kellyPct -> ve.kellyPct -> bestMarket.kellyPct", () => {
  const k = (payload) => ev(row({}, payload)).stakePct;
  assert.equal(k({ valueBet: { kelly: 2, type: "1" }, valueEngine: { odds: 2.5, bestMarket: {} } }), 2);
  assert.equal(k({ valueBet: { kellyPct: 1.5, type: "1" }, valueEngine: { odds: 2.5, bestMarket: {} } }), 1.5);
  assert.equal(k({ valueBet: { type: "1" }, valueEngine: { kellyPct: 1.25, odds: 2.5, bestMarket: {} } }), 1.25);
  assert.equal(k({ valueBet: { type: "1" }, valueEngine: { odds: 2.5, bestMarket: { kellyPct: 0.75 } } }), 0.75);
});

test("[J] the closing-odds chain is unchanged", () => {
  const r = row(
    {},
    { valueBet: { kelly: 2, type: "1" }, valueEngine: { odds: 2.5, bestMarket: {} }, closingOdds: { 1: 2.2 } }
  );
  assert.equal(ev(r).closingOdd, 2.2);
});

test("[K] the evaluation triple is still the primary probability source", () => {
  const r = row(
    {},
    {
      valueBet: { kelly: 2, type: "1" },
      valueEngine: { odds: 2.5, bestMarket: {} },
      evaluation: { modelProbs1x2Pct: { p1: 55, pX: 25, p2: 20 } }
    }
  );
  assert.equal(ev(r).prob, 0.55);
});

/* ------------------------------------------------------------------ */
/* No fake defaults, and the consumer output                           */
/* ------------------------------------------------------------------ */

test("[L] no fake defaults are introduced when sources are absent", () => {
  const e = ev(row({}, { valueBet: { kelly: 2, type: "1" }, valueEngine: { odds: 2.5, bestMarket: {} } }));
  assert.equal(e.ev, null, "absent EV stays null, not 0");
  assert.equal(e.closingOdd, null, "absent closing odd stays null");
  assert.equal(e.clvPct, null, "absent CLV stays null");
});

test("[M] a row with no outcome yields no event at all", () => {
  const r = row({ value_bet_validation: null, validation: "pending", score_home: null, score_away: null });
  assert.equal(ev(r), null);
});

test("[N] the consumer metric object is still produced end to end", () => {
  // What handleSnapshot persists into backtest_snapshots.
  const rows = [
    row({ value_bet_validation: "win", fixture_id: 1 }),
    row({ value_bet_validation: "loss", fixture_id: 2 }),
    row({ value_bet_validation: "win", fixture_id: 3 })
  ];
  const metrics = computeBacktestMetrics(rows.map(ev).filter(Boolean));
  assert.equal(metrics.settled, 3);
  assert.equal(metrics.wins, 2);
  assert.equal(metrics.losses, 1);
  assert.ok(Number.isFinite(metrics.roi));
  assert.ok(Number.isFinite(metrics.maxDrawdown));
});

test("[N] track=tip is unaffected by the value-track changes", () => {
  // The published-tip path settles from `recommended` + score and never touched
  // the branches D10a removed. Pinned so a future edit to the value track cannot
  // quietly take the tip track with it.
  const r = row(
    { validation: "win", recommended_pick: "GG", score_home: 2, score_away: 1 },
    { recommended: { pick: "GG", odd: 1.9, confidence: 58 }, closingOdds: { gg: 1.8 } }
  );
  const tip = extractBetEvent(r, { track: "tip" });
  assert.ok(tip, "the published-tip track still produces an event");
  assert.equal(tip.track, "tip");
  assert.equal(tip.market, "GG");
  assert.equal(tip.won, true);
});
