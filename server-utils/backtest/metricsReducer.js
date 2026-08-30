/**
 * The /api/backtest?view=metrics reducer, lifted out of the handler unchanged.
 *
 * It exists as a pure function for one reason: D9b-4 switches this endpoint from
 * reading `raw_payload` to reading the promoted columns, and the only convincing
 * way to show the published Brier/log-loss did not move is to run the SAME
 * reducer over both shapes and compare the results. A reducer that lives inside
 * the handler can only be tested through a database.
 *
 * Every row reaching this function carries RESOLVED SCALARS, never a document.
 * Resolving is the caller's job, which is what makes the payload path and the
 * column path comparable:
 *
 *   from columns (D9b-4)      prob_1                                     -> p1
 *   from payload (pre-D9b-4)  evaluation.modelProbs1x2Pct.p1 ?? probs.p1 -> p1
 *
 * The arithmetic below is byte-identical to the pre-D9b-4 handler, including the
 * defaults, which encode real behaviour and must not be tidied:
 *
 *   - a missing probability contributes 0, and the `s < 0.1` guard then drops
 *     the row from nProb entirely — that is how rows without a usable triple
 *     have always been excluded, and it is why NULL columns are safe here;
 *   - a missing method groups under "unknown", not under "";
 *   - a missing dataQuality is 0, which buckets as "low" rather than vanishing.
 */

import {
  actual1x2FromScore,
  brier1x2,
  bucketConfidence,
  expectedCalibrationError,
  logLoss1x2
} from "../probabilityMetrics.js";

/** Numeric, tolerating PostgREST handing a `numeric` column back as a string. */
function num(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {Array<object>} rows resolved rows (see module docblock)
 * @returns {object} the metrics body, minus `ok`/`days`/`cachedAt`
 */
export function computeMetrics(rows) {
  let sumBrier = 0;
  let sumLogLoss = 0;
  let nProb = 0;

  const byMethod = new Map();
  const byLeague = new Map();
  const byDq = new Map();
  const byVersion = new Map();
  const calib = new Map();

  for (const row of rows) {
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;

    const p1p = num(row.prob_1) / 100;
    const pXp = num(row.prob_x) / 100;
    const p2p = num(row.prob_2) / 100;
    const s = p1p + pXp + p2p;
    // Rows without a usable triple sum to 0 and drop out here, as before.
    if (s < 0.1) continue;
    const n1 = p1p / s;
    const nX = pXp / s;
    const n2 = p2p / s;

    const b = brier1x2(n1, nX, n2, actual);
    const ll = logLoss1x2(n1, nX, n2, actual);
    sumBrier += b;
    sumLogLoss += ll;
    nProb += 1;

    const method = String(row.model_method || "unknown");
    const lid = Number(row.league_id) || 0;
    const dq = num(row.model_data_quality);
    const dqBucket = dq >= 0.75 ? "high" : dq >= 0.55 ? "mid" : "low";
    const ver = String(row.model_version || "unknown");

    const bump = (map, key, delta) => {
      if (!map.has(key)) map.set(key, { brier: 0, logLoss: 0, n: 0 });
      const o = map.get(key);
      o.brier += delta.b;
      o.logLoss += delta.ll;
      o.n += 1;
    };

    const delta = { b, ll };
    bump(byMethod, method, delta);
    bump(byLeague, String(lid), delta);
    bump(byDq, dqBucket, delta);
    bump(byVersion, ver, delta);

    const pick = String(row.pick_1x2 || "").trim();
    if (["1", "X", "2"].includes(pick)) {
      const hit = pick === actual ? 1 : 0;
      /*
        The confidence of a 1X2 calibration point is the model's probability for
        the 1X2 outcome it actually picked — n1/nX/n2, already normalised above
        from the same triple Brier and log-loss use.

        It used to be `recommended_confidence`, which is the RECOMMENDED pick's
        confidence and is frequently a different market entirely: a Total Shots
        recommendation at 92% bucketed that fixture's 1X2 hit as a 92%
        prediction. The Aug-2026 audit measured the damage — 66 malformed Shots
        rows (confidence 88-100) moved the 80+ bucket from n=199 to n=265 and
        pushed ece1x2 from 28.96 to 30.09, while Brier and log-loss did not move.
        ECE is a canary metric, so it must be a function of the 1X2 prediction
        alone.

        Every fixture stays in every metric, including this one: nothing is
        excluded here, the confidence is simply read from the right prediction.
      */
      const pickProbPct = (pick === "1" ? n1 : pick === "X" ? nX : n2) * 100;
      const bucket1x2 = bucketConfidence(pickProbPct);
      if (!calib.has(bucket1x2)) calib.set(bucket1x2, { sumConf: 0, sumHit: 0, n: 0 });
      const c = calib.get(bucket1x2);
      c.sumConf += pickProbPct;
      c.sumHit += hit;
      c.n += 1;
    }
  }

  const serialize = (map) =>
    Array.from(map.entries()).map(([k, v]) => ({
      key: k,
      n: v.n,
      brier: v.n ? Number((v.brier / v.n).toFixed(5)) : 0,
      logLoss: v.n ? Number((v.logLoss / v.n).toFixed(5)) : 0
    }));

  const calibration = Array.from(calib.entries()).map(([k, v]) => ({
    bucket: k,
    n: v.n,
    avgConfidence: v.n ? Number((v.sumConf / v.n).toFixed(2)) : 0,
    accuracy1x2: v.n ? Number(((v.sumHit / v.n) * 100).toFixed(2)) : 0
  }));

  return {
    nRows: rows.length,
    nProb,
    brier1x2: nProb ? Number((sumBrier / nProb).toFixed(5)) : null,
    logLoss1x2: nProb ? Number((sumLogLoss / nProb).toFixed(5)) : null,
    ece1x2: expectedCalibrationError(calibration),
    byMethod: serialize(byMethod),
    byLeague: serialize(byLeague),
    byDataQuality: serialize(byDq),
    byModelVersion: serialize(byVersion),
    calibration1x2: calibration
  };
}

/** The columns `computeMetrics` needs. No raw_payload. */
export const METRICS_SELECT =
  "league_id, league_name, score_home, score_away, match_status, model_version, " +
  "recommended_confidence, prob_1, prob_x, prob_2, model_method, model_data_quality, pick_1x2";

/**
 * The PRE-D9b-4 resolution, kept for parity testing only.
 *
 * This is what the handler used to do inline. Feeding its output and the column
 * row into the same reducer is the evidence that the switch is a no-op; it is
 * not used to serve traffic.
 */
export function resolveRowFromPayload(row) {
  const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const ev = payload.evaluation?.modelProbs1x2Pct;
  const probs = payload.probs;
  return {
    league_id: row.league_id,
    score_home: row.score_home,
    score_away: row.score_away,
    model_version: row.model_version || payload.modelVersion,
    recommended_confidence: row.recommended_confidence ?? payload.recommended?.confidence,
    prob_1: ev?.p1 ?? probs?.p1,
    prob_x: ev?.pX ?? probs?.pX,
    prob_2: ev?.p2 ?? probs?.p2,
    model_method: payload.modelMeta?.method,
    model_data_quality: payload.modelMeta?.dataQuality,
    pick_1x2: payload.evaluation?.recommended1x2 || payload.predictions?.oneXtwo
  };
}

export default { computeMetrics, resolveRowFromPayload, METRICS_SELECT };
