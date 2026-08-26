import test, { mock } from "node:test";
import assert from "node:assert/strict";

import {
  payloadBlockSelect,
  rehydratePayloadBlocks,
  selectWithPayloadBlocks
} from "../server-utils/history/payloadProjection.js";
import { extractRawTriple, extractStackerModelTriple } from "../server-utils/ml/extractRawTriple.js";
import { extractSideMarketProbs } from "../server-utils/probabilityMetrics.js";
import {
  AUTO_CALIBRATION_PAYLOAD_BLOCKS,
  extractSamplesFromHistory
} from "../server-utils/calibration/AutoCalibrationEngine.js";
import { computeLeagueProfileRecalibration } from "../server-utils/leagueProfiles/computeLeagueProfileRecalibration.js";

/**
 * D10b — the daily-ml crons stop selecting the whole `raw_payload`.
 *
 * This is an OUTAGE fix. Replayed verbatim against production on 2026-08-26, all
 * four `mode=all` document reads returned `57014 canceling statement due to
 * statement timeout`, and the damage is visible downstream: `calibration_runs`
 * last succeeded 2026-08-13 after 27 consecutive nightly runs.
 *
 * The fix is projection, NOT promoted columns. `valueEngine` alone is 267.7 KB of
 * a ~304 KB document (87.96%) and nothing on this path reads it; the two 1X2
 * probability triples a migration would have promoted are 136 B (0.044%).
 *
 * Because the fix moves the QUERY and not the consumers, the tests below fall in
 * two groups:
 *
 *   - projection shape: each job asks for exactly its own blocks and no more,
 *     captured from the real call through a Supabase stub rather than asserted
 *     against a hand-written copy of the string.
 *   - equivalence: a rehydrated projection drives every consumer to the SAME
 *     answer as the full document. Every fixture below carries `valueEngine` and
 *     other unread blocks in the "full" shape and omits them in the projected
 *     shape, so each assertion is a real comparison and not a tautology.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const RAW = { p1: 29.86235233008508, pX: 36.884687745936446, p2: 33.252959923978466 };
const MODEL = { p1: 28.87745358435523, pX: 34.34593023340741, p2: 36.77661618223736 };
const CAL = { p1: 31.5, pX: 33.25, p2: 35.25 };

/** A document as production stores it — 88% of which no daily-ml consumer reads. */
function fullDocument(overrides = {}) {
  return {
    valueEngine: {
      bestMarket: { type: "Over 2.5", odds: 1.9 },
      candidates: Array.from({ length: 40 }, (_, i) => ({ i }))
    },
    monteCarlo: { runs: 10000 },
    leagueStandings: [{ team: "A" }],
    confidenceEngine: { score: 71 },
    predictionLaboratory: { rows: [] },
    marketOdds: { over25: 1.9 },
    closingOdds: { 1: 2.2 },
    evaluation: {
      rawPoissonProbs1x2Pct: { ...RAW },
      modelProbs1x2Pct: { ...MODEL },
      calibratedProbs1x2Pct: { ...CAL },
      rawSideMarketsPct: { pO15: 62.08, pO25: 34.45, pU35: 83.25, pGG: 45.48 },
      calibratedSideMarketsPct: { pO15: 60, pO25: 33, pU35: 82, pGG: 44 }
    },
    probs: { ...MODEL, pO15: 62.08, pO25: 34.45, pU35: 83.25, pGG: 45.48 },
    odds: { home: 2.5, draw: 3.4, away: 3.9 },
    modelMeta: {
      eloSpread: 42,
      dataQuality: 0.81,
      leagueParams: { homeAdv: 1.07, rho: -0.12 },
      elo: { home: 1500, away: 1480 }
    },
    featureImportance: { contributions: { form: 0.2, elo: 0.3 } },
    recommended: { pick: "1", confidence: 61 },
    ...overrides
  };
}

/** The row PostgREST returns for a projection, before rehydration. */
function projectedRow(doc, blocks, scalars = {}) {
  const row = { fixture_id: 1, league_id: 39, score_home: 2, score_away: 1, ...scalars };
  for (const b of blocks) row[b] = doc[b] ?? null;
  return row;
}

const CAL_BLOCKS = ["evaluation", "probs"];
const STACK_BLOCKS = ["evaluation", "probs", "odds", "modelMeta"];

/* ------------------------------------------------------------------ */
/* [A][B][K][L] projection shape — captured from the real query        */
/* ------------------------------------------------------------------ */

/** Runs one daily-ml mode against a Supabase stub and returns the projections it asked for. */
async function captureDailyMlSelects(mode, tag) {
  const selects = [];
  mock.reset();
  mock.module("../server-utils/cronRequestAuth.js", {
    namedExports: { isAuthorizedCronOrInternalRequest: () => true }
  });
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      assertSupabaseConfigured: () => ({ ok: true }),
      getSupabaseAdmin: () => ({
        from: () => {
          const chain = {
            select: (projection) => {
              selects.push(projection);
              return chain;
            },
            gte: () => chain,
            in: () => chain,
            eq: () => chain,
            is: () => chain,
            order: () => chain,
            update: () => chain,
            limit: () => Promise.resolve({ data: [], error: null })
          };
          return chain;
        }
      })
    }
  });
  const mod = await import(`../api/cron/daily-ml.js?d10b=${tag}`);
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    }
  };
  await mod.default({ method: "GET", query: { mode }, headers: {} }, res);
  return { selects, res, mod };
}

test("[A][L] calibration asks for exactly evaluation + probs — one query, no document", async () => {
  const { selects, res } = await captureDailyMlSelects("calibration", "cal");
  assert.equal(res.statusCode, 200, `handler failed: ${JSON.stringify(res.body).slice(0, 300)}`);
  assert.equal(selects.length, 1, `expected exactly 1 select, saw ${selects.length}`);
  assert.equal(
    selects[0],
    "league_id, score_home, score_away, match_status, kickoff_at, " +
      "evaluation:raw_payload->evaluation, probs:raw_payload->probs"
  );
});

test("[A][L] stacker asks for evaluation + probs + odds + modelMeta", async () => {
  const { selects, res } = await captureDailyMlSelects("stacker", "stk");
  assert.equal(res.statusCode, 200);
  assert.equal(selects.length, 1);
  assert.equal(
    selects[0],
    "league_id, score_home, score_away, match_status, kickoff_at, " +
      "evaluation:raw_payload->evaluation, probs:raw_payload->probs, " +
      "odds:raw_payload->odds, modelMeta:raw_payload->modelMeta"
  );
});

test("[K] league-profiles fetches NO document data at all", async () => {
  const { selects, res } = await captureDailyMlSelects("league-profiles", "lp");
  assert.equal(res.statusCode, 200);
  assert.equal(selects.length, 1);
  assert.equal(selects[0], "league_id, score_home, score_away, match_status, kickoff_at");
  assert.ok(!selects[0].includes("raw_payload"), "league-profiles must not name raw_payload at all");
});

test("[B] no query on this path selects the bare document or a wildcard", async () => {
  for (const [mode, tag] of [
    ["calibration", "b1"],
    ["stacker", "b2"],
    ["league-profiles", "b3"]
  ]) {
    const { selects } = await captureDailyMlSelects(mode, tag);
    for (const s of selects) {
      assert.ok(!/(^|,\s*)raw_payload(\s*,|$)/.test(s), `${mode} still selects the whole document: ${s}`);
      assert.ok(!s.includes("*"), `${mode} uses a wildcard: ${s}`);
      // every mention of the document must be a scoped block projection
      for (const m of s.match(/raw_payload[^,]*/g) || []) {
        assert.ok(m.startsWith("raw_payload->"), `unscoped document read: ${m}`);
      }
    }
  }
});

test("[A][L] auto-calibration asks for its own four blocks — NOT calibration's two", async () => {
  const selects = [];
  mock.reset();
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      getSupabaseAdmin: () => ({
        from: () => {
          const chain = {
            select: (p) => {
              selects.push(p);
              return chain;
            },
            gte: () => chain,
            in: () => chain,
            order: () => chain,
            limit: () => Promise.resolve({ data: [], error: null })
          };
          return chain;
        }
      })
    }
  });
  const mod = await import("../server-utils/calibration/AutoCalibrationEngine.js?d10b=ac");
  await mod.runAutoCalibration({ persist: false, mode: "test", minSamples: 1 });
  assert.equal(selects.length, 1);
  assert.equal(
    selects[0],
    "fixture_id, league_id, score_home, score_away, match_status, validation, " +
      "recommended_pick, recommended_confidence, kickoff_at, " +
      "evaluation:raw_payload->evaluation, probs:raw_payload->probs, " +
      "recommended:raw_payload->recommended, featureImportance:raw_payload->featureImportance"
  );
  assert.deepEqual(
    [...AUTO_CALIBRATION_PAYLOAD_BLOCKS],
    ["evaluation", "probs", "recommended", "featureImportance"]
  );
});

test("[B] payloadBlockSelect scopes every block and returns nothing for an empty list", () => {
  assert.equal(payloadBlockSelect([]), "");
  assert.equal(selectWithPayloadBlocks("a, b", []), "a, b");
  assert.equal(payloadBlockSelect(["odds"]), "odds:raw_payload->odds");
  // `->>` would stringify the block and break every consumer that expects an object
  assert.ok(!payloadBlockSelect(["odds"]).includes("->>"));
});

/* ------------------------------------------------------------------ */
/* Rehydration                                                         */
/* ------------------------------------------------------------------ */

test("[I] rehydration omits absent blocks rather than storing null", () => {
  const row = rehydratePayloadBlocks({ league_id: 39, evaluation: { a: 1 }, probs: null }, CAL_BLOCKS);
  assert.deepEqual(row.raw_payload, { evaluation: { a: 1 } });
  assert.ok(!("probs" in row.raw_payload), "a null block must not become a null key");
  assert.equal(row.league_id, 39);
  // block aliases must not leak onto the row alongside raw_payload
  assert.ok(!("evaluation" in row), "the alias must be folded away, not duplicated");
});

test("[I] a row with no document at all rehydrates to an empty payload, not a crash", () => {
  const row = rehydratePayloadBlocks({ league_id: 39, evaluation: null, probs: null }, CAL_BLOCKS);
  assert.deepEqual(row.raw_payload, {});
  assert.equal(extractRawTriple(row.raw_payload), null);
  // NOT null: toFrac(null) is 0 (see the [J] note), so pU35 always resolves.
  // Identical to what the empty document itself produces, which is the point.
  assert.deepEqual(extractSideMarketProbs(row.raw_payload), extractSideMarketProbs({}));
  assert.deepEqual(extractSideMarketProbs(row.raw_payload), { pO15: null, pO25: null, pU35: 0, pGG: null });
});

/* ------------------------------------------------------------------ */
/* [C] calibration equivalence                                         */
/* ------------------------------------------------------------------ */

test("[C] calibration: the projected payload yields the identical 1X2 triple", () => {
  const doc = fullDocument();
  const projected = rehydratePayloadBlocks(projectedRow(doc, CAL_BLOCKS), CAL_BLOCKS).raw_payload;

  // the fixture is a real comparison: the full document carries blocks the projection drops
  assert.ok(doc.valueEngine && !projected.valueEngine, "fixture must exercise a dropped block");

  assert.deepEqual(extractRawTriple(projected), extractRawTriple(doc));

  /*
    And it is the RAW triple that wins, not modelProbs — precedence is unchanged.
    Asserted by comparison against a payload carrying ONLY rawPoisson rather than
    by re-deriving the number here: tryTriple divides by 100 BEFORE summing, and
    reproducing that by hand lands one ULP away (0.29862352330085085 vs
    ...0508), which would pin an arithmetic accident instead of the precedence.
  */
  assert.deepEqual(extractRawTriple(projected), extractRawTriple({ evaluation: { rawPoissonProbs1x2Pct: { ...RAW } } }));
  assert.notDeepEqual(extractRawTriple(projected), extractRawTriple({ evaluation: { modelProbs1x2Pct: { ...MODEL } } }));
});

test("[J] calibration: side-market probabilities survive the projection", () => {
  const doc = fullDocument();
  const projected = rehydratePayloadBlocks(projectedRow(doc, CAL_BLOCKS), CAL_BLOCKS).raw_payload;
  const sides = extractSideMarketProbs(projected);
  assert.deepEqual(sides, extractSideMarketProbs(doc));
  assert.ok(sides.pO15 > 0 && sides.pO25 > 0 && sides.pU35 > 0 && sides.pGG > 0);
});

test("[J] calibration: a payload with no raw side markets behaves identically either way", () => {
  /*
    This pins EXISTING behaviour, quirk included, because the projection must not
    change it.

    `extractSideMarketProbs` looks like it falls back to
    `evaluation.calibratedSideMarketsPct` when the raw block is absent. It does
    not, and cannot: the guard is `[pO15,pO25,pU35,pGG].every(x => x == null)`,
    but pU35 comes from `toFrac(src.pU35 ?? ...)` and `toFrac(null)` returns 0 —
    `Number(null)` is 0 and passes `Number.isFinite`. So pU35 is 0, never null,
    the guard never passes, and the calibrated block is unreachable.

    Verified: a payload whose probs carry no side keys returns
    { pO15: null, pO25: null, pU35: 0, pGG: null } whether or not
    calibratedSideMarketsPct is present.

    Left exactly as found — fixing it would move every U35 calibration map, which
    is a semantic change and out of scope for a projection fix.
  */
  const doc = fullDocument({
    evaluation: {
      rawPoissonProbs1x2Pct: { ...RAW },
      calibratedSideMarketsPct: { pO15: 60, pO25: 33, pU35: 82, pGG: 44 }
    },
    probs: { ...MODEL }
  });
  const projected = rehydratePayloadBlocks(projectedRow(doc, CAL_BLOCKS), CAL_BLOCKS).raw_payload;

  const sides = extractSideMarketProbs(projected);
  assert.deepEqual(sides, extractSideMarketProbs(doc), "projection must not change the outcome");
  assert.deepEqual(sides, { pO15: null, pO25: null, pU35: 0, pGG: null });

  // and the calibrated block genuinely has no effect, projected or not
  const withoutCal = { ...doc, evaluation: { rawPoissonProbs1x2Pct: { ...RAW } } };
  assert.deepEqual(extractSideMarketProbs(withoutCal), sides);
});

/* ------------------------------------------------------------------ */
/* [D] stacker equivalence, including the replay branch                */
/* ------------------------------------------------------------------ */

test("[D] stacker: stored calibrated triple resolves identically", () => {
  const doc = fullDocument();
  const projected = rehydratePayloadBlocks(projectedRow(doc, STACK_BLOCKS), STACK_BLOCKS).raw_payload;
  assert.deepEqual(extractStackerModelTriple(projected), extractStackerModelTriple(doc));
  assert.ok(!projected.valueEngine, "fixture must exercise a dropped block");
});

test("[H] stacker: the Stage06 REPLAY branch gets identical raw inputs", () => {
  // no stored calibratedProbs -> extractRawTriple, then applyCalibratedTriple(raw, maps).
  // 323 of 866 production rows take this path, so the projection must carry the RAW
  // inputs, not just the calibrated ones.
  const doc = fullDocument({
    evaluation: { rawPoissonProbs1x2Pct: { ...RAW }, modelProbs1x2Pct: { ...MODEL } }
  });
  const projected = rehydratePayloadBlocks(projectedRow(doc, STACK_BLOCKS), STACK_BLOCKS).raw_payload;
  const ramp = { xPoints: [0, 0.5, 1], yPoints: [0, 0.4, 1] };
  const maps = { 39: { "1": ramp, X: ramp, "2": ramp } };

  const withMaps = extractStackerModelTriple(projected, maps, 39);
  assert.deepEqual(withMaps, extractStackerModelTriple(doc, maps, 39));
  assert.ok(withMaps, "replay must produce a triple");
  // and the replay genuinely ran: with no maps the result is the plain raw triple
  const noMaps = extractStackerModelTriple(projected, null, 39);
  assert.deepEqual(noMaps, extractRawTriple(projected));
});

test("[D] stacker: odds and modelMeta survive, so market probs and features are unchanged", () => {
  const doc = fullDocument();
  const projected = rehydratePayloadBlocks(projectedRow(doc, STACK_BLOCKS), STACK_BLOCKS).raw_payload;
  assert.deepEqual(projected.odds, doc.odds);
  assert.deepEqual(projected.modelMeta, doc.modelMeta);
  assert.equal(Number(projected.modelMeta?.eloSpread), 42);
  assert.equal(Number(projected.modelMeta?.dataQuality), 0.81);
  assert.equal(Number(projected.modelMeta?.leagueParams?.homeAdv), 1.07);
  assert.equal(Number(projected.modelMeta?.leagueParams?.rho), -0.12);
});

/* ------------------------------------------------------------------ */
/* [G] the rollback flag                                               */
/* ------------------------------------------------------------------ */

test("[G] PREDICT_TRAIN_USE_FINAL_PROBS still inverts precedence on the projected shape", () => {
  const doc = fullDocument();
  const projected = rehydratePayloadBlocks(projectedRow(doc, CAL_BLOCKS), CAL_BLOCKS).raw_payload;
  const prev = process.env.PREDICT_TRAIN_USE_FINAL_PROBS;
  try {
    delete process.env.PREDICT_TRAIN_USE_FINAL_PROBS;
    const dflt = extractRawTriple(projected);
    const dfltFull = extractRawTriple(doc);
    process.env.PREDICT_TRAIN_USE_FINAL_PROBS = "1";
    const legacy = extractRawTriple(projected);
    const legacyFull = extractRawTriple(doc);

    // parity holds in BOTH flag states
    assert.deepEqual(dflt, dfltFull);
    assert.deepEqual(legacy, legacyFull);
    assert.notDeepEqual(dflt, legacy, "the flag must still change the resolved triple");
    // default takes rawPoisson, flag takes modelProbs — measured to differ on 860/916 rows
    assert.ok(Math.abs(dflt.p1 - RAW.p1 / 100) < 1e-6);
    assert.ok(Math.abs(legacy.p1 - MODEL.p1 / 100) < 1e-6);
  } finally {
    if (prev === undefined) delete process.env.PREDICT_TRAIN_USE_FINAL_PROBS;
    else process.env.PREDICT_TRAIN_USE_FINAL_PROBS = prev;
  }
});

/* ------------------------------------------------------------------ */
/* [E] auto-calibration equivalence                                    */
/* ------------------------------------------------------------------ */

test("[E] auto-calibration: samples are identical from the projected shape", () => {
  const doc = fullDocument();
  const scalars = {
    validation: "win",
    recommended_pick: "1",
    recommended_confidence: 61,
    match_status: "FT"
  };
  const fullRow = { fixture_id: 1, league_id: 39, score_home: 2, score_away: 1, ...scalars, raw_payload: doc };
  const projRow = rehydratePayloadBlocks(
    projectedRow(doc, AUTO_CALIBRATION_PAYLOAD_BLOCKS, scalars),
    AUTO_CALIBRATION_PAYLOAD_BLOCKS
  );
  assert.ok(!projRow.raw_payload.valueEngine, "fixture must exercise a dropped block");

  const a = extractSamplesFromHistory([fullRow]);
  const b = extractSamplesFromHistory([projRow]);
  assert.equal(a.length, 1);
  assert.deepEqual(b, a);
  assert.deepEqual(b[0].featureContributions, doc.featureImportance.contributions);
});

test("[E][I] auto-calibration: the payload `recommended` fallback still works when columns are empty", () => {
  const doc = fullDocument({ recommended: { pick: "X", confidence: 44 } });
  const scalars = {
    validation: null,
    recommended_pick: null,
    recommended_confidence: null,
    match_status: "FT",
    score_home: 1,
    score_away: 1
  };
  const fullRow = { fixture_id: 1, league_id: 39, ...scalars, raw_payload: doc };
  const projRow = rehydratePayloadBlocks(
    projectedRow(doc, AUTO_CALIBRATION_PAYLOAD_BLOCKS, scalars),
    AUTO_CALIBRATION_PAYLOAD_BLOCKS
  );
  const a = extractSamplesFromHistory([fullRow]);
  const b = extractSamplesFromHistory([projRow]);
  assert.equal(a.length, 1);
  assert.deepEqual(b, a);
  assert.equal(b[0].pick, "X", "the pick must still come from payload.recommended");
});

/* ------------------------------------------------------------------ */
/* [F] league-profile equivalence                                      */
/* ------------------------------------------------------------------ */

test("[F] league-profiles: the result is identical with NO payload present", () => {
  const statics = {
    overFrequency: 0.5,
    bttsRate: 0.5,
    drawFrequency: 0.25,
    goalFrequency: 2.6,
    homeAdvantage: 1.06
  };
  const scores = [
    [2, 1],
    [0, 0],
    [3, 2],
    [1, 1],
    [2, 2],
    [0, 1]
  ];
  const withDoc = scores.map(([h, a], i) => ({
    fixture_id: i,
    league_id: 39,
    score_home: h,
    score_away: a,
    raw_payload: fullDocument()
  }));
  const without = scores.map(([h, a], i) => ({
    fixture_id: i,
    league_id: 39,
    score_home: h,
    score_away: a,
    raw_payload: {}
  }));

  const A = computeLeagueProfileRecalibration(withDoc, statics, { minSamples: 1, shrinkageK: 80 });
  const B = computeLeagueProfileRecalibration(without, statics, { minSamples: 1, shrinkageK: 80 });
  assert.ok(A && B);
  assert.deepEqual(B, A, "league-profile output must not depend on the document");
  assert.equal(B.sampleSize, scores.length);
});
