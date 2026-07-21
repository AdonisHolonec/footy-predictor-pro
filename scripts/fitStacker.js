/**
 * Multinomial LR stacker trainer.
 *
 * Rulează: `node --env-file=.env.local scripts/fitStacker.js`
 *
 * Antrenează o regresie logistică multinomială cu L2 pe features derivate din:
 * - Calibrated 1X2 probs (evaluation.calibratedProbs1x2Pct / Stage06 maps) — matches Stage07
 * - Market probs Shin (derivate din `odds` dacă există în payload)
 * - Elo spread (din `raw_payload.modelMeta.eloSpread` dacă disponibil)
 * - Data quality, home advantage, rho (din `raw_payload.modelMeta.leagueParams`)
 *
 * Output: upsert în `ml_stacker_weights` per (league_id, model_version).
 *
 * Strategy:
 * - Per ligă cu ≥ 400 eşantioane: fit dedicat.
 * - Global fallback: fit pe tot pool-ul.
 */
import { createClient } from "@supabase/supabase-js";
import { extractStackerFeatures, applyStacker, trainSoftmax, computeStackerMetrics } from "../server-utils/mlStacker.js";
import { evaluateStackerWalkForward } from "../server-utils/validation/StackerWalkForward.js";
import { shinImpliedProbs } from "../server-utils/advancedMath.js";
import { actual1x2FromScore, brier1x2, logLoss1x2 } from "../server-utils/probabilityMetrics.js";
import { MODEL_VERSION } from "../server-utils/modelConstants.js";
import { extractStackerModelTriple } from "../server-utils/ml/extractRawTriple.js";
import { loadCalibrationMaps } from "../server-utils/isotonicCalibration.js";

const MIN_SAMPLES_LEAGUE = Math.max(200, Number(process.env.STACKER_MIN_LEAGUE || 400));
const MIN_SAMPLES_GLOBAL = Math.max(500, Number(process.env.STACKER_MIN_GLOBAL || 1200));
const WINDOW_DAYS = Math.max(60, Math.min(Number(process.env.STACKER_WINDOW_DAYS || 220), 720));

const EPOCHS = 200;
const LR = 0.1;
const L2 = 1e-3;
const BATCH = 64;
const WF_FOLDS = Math.max(2, Math.min(Number(process.env.STACKER_WF_FOLDS || 3), 6));
const SGD_OPTS = { epochs: EPOCHS, lr: LR, l2: L2, batch: BATCH };

function oneHot(actual) {
  if (actual === "1") return [1, 0, 0];
  if (actual === "X") return [0, 1, 0];
  if (actual === "2") return [0, 0, 1];
  return null;
}

function buildDataset(rows, allMaps = null) {
  const samples = [];
  for (const row of rows) {
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const leagueId = Number(row.league_id) || null;
    const poissonProbs = extractStackerModelTriple(payload, allMaps, leagueId);
    if (!poissonProbs) continue;

    let marketProbs = null;
    const odds = payload.odds;
    if (odds && odds.home && odds.draw && odds.away) {
      const shin = shinImpliedProbs(odds.home, odds.draw, odds.away);
      if (shin) marketProbs = { p1: shin.p1, pX: shin.pX, p2: shin.p2 };
    }

    const lp = payload.modelMeta?.leagueParams || {};
    const dq = Number(payload.modelMeta?.dataQuality) || 0.6;
    const feat = extractStackerFeatures({
      poissonProbs,
      marketProbs,
      eloSpread: Number(payload.modelMeta?.eloSpread) || 0,
      dataQuality: dq,
      homeAdv: Number(lp.homeAdv) || 1.06,
      rho: Number(lp.rho) || -0.1
    });
    samples.push({
      x: feat.values,
      y: oneHot(actual),
      leagueId,
      poissonProbs,
      marketProbs,
      actual,
      kickoffAt: row.kickoff_at
    });
  }
  return samples;
}

/** Market-blend (65/35 poisson/market) comparison — not part of the shared
 * computeStackerMetrics since it's specific to this manual report. */
function computeMixMetrics(samples) {
  let brierMix = 0;
  let llMix = 0;
  for (const s of samples) {
    const mix = s.marketProbs
      ? {
          p1: 0.65 * s.poissonProbs.p1 + 0.35 * s.marketProbs.p1,
          pX: 0.65 * s.poissonProbs.pX + 0.35 * s.marketProbs.pX,
          p2: 0.65 * s.poissonProbs.p2 + 0.35 * s.marketProbs.p2
        }
      : s.poissonProbs;
    const ms = mix.p1 + mix.pX + mix.p2;
    if (ms > 0) {
      mix.p1 /= ms;
      mix.pX /= ms;
      mix.p2 /= ms;
    }
    brierMix += brier1x2(mix.p1, mix.pX, mix.p2, s.actual);
    llMix += logLoss1x2(mix.p1, mix.pX, mix.p2, s.actual);
  }
  const n = samples.length || 1;
  return {
    brierMix: Number((brierMix / n).toFixed(5)),
    logLossMix: Number((llMix / n).toFixed(5))
  };
}

async function upsertWeights(supabase, { league_id, model_version, weights, metrics, sampleSize, featureNames }) {
  // deactivate prior active rows for same key
  const q = supabase
    .from("ml_stacker_weights")
    .update({ active: false })
    .eq("model_version", model_version);
  if (league_id == null) q.is("league_id", null);
  else q.eq("league_id", league_id);
  await q;

  const payload = {
    league_id,
    model_version,
    weights_json: { ...weights, feature_names: featureNames },
    feature_count: featureNames.length,
    sample_size: sampleSize,
    metrics_json: metrics,
    fitted_at: new Date().toISOString(),
    active: true
  };
  const { error } = await supabase.from("ml_stacker_weights").insert(payload);
  if (error) throw error;
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const modelVersion = process.env.STACKER_MODEL_VERSION || MODEL_VERSION;
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  console.log(`Stacker fit :: model_version=${modelVersion} window=${WINDOW_DAYS}d`);

  const { data, error } = await supabase
    .from("predictions_history")
    .select("league_id, score_home, score_away, match_status, raw_payload, kickoff_at")
    .gte("kickoff_at", cutoff)
    .in("match_status", ["FT", "AET", "PEN"])
    .limit(20000);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const settled = (data || []).filter((r) => r.score_home != null && r.score_away != null);
  const allMaps = await loadCalibrationMaps(modelVersion).catch(() => ({}));
  const samples = buildDataset(settled, allMaps);
  console.log(
    `Built dataset: ${samples.length} usable samples (out of ${settled.length} settled rows) [features=calibrated_1x2]`
  );

  if (samples.length === 0) {
    console.log("No usable samples; exiting.");
    return;
  }

  const firstFeat = extractStackerFeatures({
    poissonProbs: { p1: 0.4, pX: 0.3, p2: 0.3 },
    marketProbs: { p1: 0.4, pX: 0.3, p2: 0.3 }
  });
  const nFeatures = firstFeat.values.length;

  function fitScope(scopeSamples) {
    const w = trainSoftmax(scopeSamples.map((s) => ({ ...s })), nFeatures, SGD_OPTS);
    const inSample = { ...computeStackerMetrics(scopeSamples, w), ...computeMixMetrics(scopeSamples) };
    const walkForward = evaluateStackerWalkForward(scopeSamples, nFeatures, { folds: WF_FOLDS, ...SGD_OPTS });
    return { weights: w, metrics: { inSample, walkForward } };
  }

  // GLOBAL
  if (samples.length >= MIN_SAMPLES_GLOBAL) {
    console.log(`\nTrain GLOBAL (n=${samples.length})`);
    const { weights: w, metrics } = fitScope(samples);
    console.log("  in-sample:", metrics.inSample);
    console.log("  walk-forward (out-of-sample):", metrics.walkForward);
    await upsertWeights(supabase, {
      league_id: null,
      model_version: modelVersion,
      weights: w,
      metrics,
      sampleSize: samples.length,
      featureNames: firstFeat.featureNames
    });
  } else {
    console.log(`GLOBAL skipped: n=${samples.length} < ${MIN_SAMPLES_GLOBAL}`);
  }

  // PER-LEAGUE
  const byLeague = new Map();
  for (const s of samples) {
    if (!s.leagueId) continue;
    if (!byLeague.has(s.leagueId)) byLeague.set(s.leagueId, []);
    byLeague.get(s.leagueId).push(s);
  }
  for (const [lid, group] of byLeague.entries()) {
    if (group.length < MIN_SAMPLES_LEAGUE) {
      console.log(`L${lid} skipped (n=${group.length} < ${MIN_SAMPLES_LEAGUE})`);
      continue;
    }
    console.log(`\nTrain L${lid} (n=${group.length})`);
    const { weights: w, metrics } = fitScope(group);
    console.log("  in-sample:", metrics.inSample);
    console.log("  walk-forward (out-of-sample):", metrics.walkForward);
    await upsertWeights(supabase, {
      league_id: lid,
      model_version: modelVersion,
      weights: w,
      metrics,
      sampleSize: group.length,
      featureNames: firstFeat.featureNames
    });
  }

  console.log("\nDone.");
}

run().catch((err) => {
  console.error("fitStacker crashed:", err?.message || err);
  process.exit(1);
});
