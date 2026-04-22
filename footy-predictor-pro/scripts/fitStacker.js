/**
 * Multinomial LR stacker trainer.
 *
 * Rulează: `node --env-file=.env.local scripts/fitStacker.js`
 *
 * Antrenează o regresie logistică multinomială cu L2 pe features derivate din:
 * - Poisson model probs (din `raw_payload.evaluation.modelProbs1x2Pct`)
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
import { extractStackerFeatures, applyStacker, safeLog, softmax3 } from "../server-utils/mlStacker.js";
import { shinImpliedProbs } from "../server-utils/advancedMath.js";
import { actual1x2FromScore, brier1x2, logLoss1x2 } from "../server-utils/probabilityMetrics.js";
import { MODEL_VERSION } from "../server-utils/modelConstants.js";

const MIN_SAMPLES_LEAGUE = Math.max(200, Number(process.env.STACKER_MIN_LEAGUE || 400));
const MIN_SAMPLES_GLOBAL = Math.max(500, Number(process.env.STACKER_MIN_GLOBAL || 1200));
const WINDOW_DAYS = Math.max(60, Math.min(Number(process.env.STACKER_WINDOW_DAYS || 220), 720));

const EPOCHS = 200;
const LR = 0.1;
const L2 = 1e-3;
const BATCH = 64;

function oneHot(actual) {
  if (actual === "1") return [1, 0, 0];
  if (actual === "X") return [0, 1, 0];
  if (actual === "2") return [0, 0, 1];
  return null;
}

function buildDataset(rows) {
  const samples = [];
  for (const row of rows) {
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const ev = payload.evaluation?.modelProbs1x2Pct;
    let poissonProbs = null;
    if (ev && Number.isFinite(ev.p1) && Number.isFinite(ev.pX) && Number.isFinite(ev.p2)) {
      const s = ev.p1 + ev.pX + ev.p2;
      if (s > 0) poissonProbs = { p1: ev.p1 / s, pX: ev.pX / s, p2: ev.p2 / s };
    }
    if (!poissonProbs) {
      const pr = payload.probs;
      if (pr && Number.isFinite(pr.p1) && Number.isFinite(pr.pX) && Number.isFinite(pr.p2)) {
        const s = (pr.p1 + pr.pX + pr.p2) / 100;
        if (s > 0) poissonProbs = { p1: pr.p1 / 100 / s, pX: pr.pX / 100 / s, p2: pr.p2 / 100 / s };
      }
    }
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
      leagueId: Number(row.league_id) || null,
      poissonProbs,
      marketProbs,
      actual
    });
  }
  return samples;
}

function initWeights(nFeatures) {
  return {
    intercept: [0, 0, 0],
    coef: Array.from({ length: nFeatures }, () => [0, 0, 0])
  };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Batch SGD for softmax regression with L2 on coef. */
function trainSoftmax(samples, nFeatures, { epochs = EPOCHS, lr = LR, l2 = L2, batch = BATCH } = {}) {
  const w = initWeights(nFeatures);
  const n = samples.length;
  if (n === 0) return w;

  for (let epoch = 0; epoch < epochs; epoch++) {
    shuffleInPlace(samples);
    for (let start = 0; start < n; start += batch) {
      const end = Math.min(n, start + batch);
      const bs = end - start;

      let gradI = [0, 0, 0];
      let gradC = Array.from({ length: nFeatures }, () => [0, 0, 0]);

      for (let k = start; k < end; k++) {
        const s = samples[k];
        const x = s.x;
        const y = s.y;
        let l1 = w.intercept[0];
        let lX = w.intercept[1];
        let l2v = w.intercept[2];
        for (let i = 0; i < nFeatures; i++) {
          l1 += x[i] * w.coef[i][0];
          lX += x[i] * w.coef[i][1];
          l2v += x[i] * w.coef[i][2];
        }
        const p = softmax3(l1, lX, l2v);
        const d0 = p.p1 - y[0];
        const d1 = p.pX - y[1];
        const d2 = p.p2 - y[2];
        gradI[0] += d0;
        gradI[1] += d1;
        gradI[2] += d2;
        for (let i = 0; i < nFeatures; i++) {
          gradC[i][0] += d0 * x[i];
          gradC[i][1] += d1 * x[i];
          gradC[i][2] += d2 * x[i];
        }
      }

      const scale = lr / bs;
      w.intercept[0] -= scale * gradI[0];
      w.intercept[1] -= scale * gradI[1];
      w.intercept[2] -= scale * gradI[2];
      for (let i = 0; i < nFeatures; i++) {
        w.coef[i][0] -= scale * (gradC[i][0] + l2 * w.coef[i][0]);
        w.coef[i][1] -= scale * (gradC[i][1] + l2 * w.coef[i][1]);
        w.coef[i][2] -= scale * (gradC[i][2] + l2 * w.coef[i][2]);
      }
    }
  }
  return w;
}

function computeMetrics(samples, weights) {
  let brierStk = 0;
  let brierPoi = 0;
  let brierMix = 0;
  let llStk = 0;
  let llPoi = 0;
  let llMix = 0;
  let correctStk = 0;
  let correctPoi = 0;
  for (const s of samples) {
    const p = applyStacker({ values: s.x }, weights);
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

    brierPoi += brier1x2(s.poissonProbs.p1, s.poissonProbs.pX, s.poissonProbs.p2, s.actual);
    llPoi += logLoss1x2(s.poissonProbs.p1, s.poissonProbs.pX, s.poissonProbs.p2, s.actual);
    if (argmax3(s.poissonProbs) === s.actual) correctPoi += 1;

    brierMix += brier1x2(mix.p1, mix.pX, mix.p2, s.actual);
    llMix += logLoss1x2(mix.p1, mix.pX, mix.p2, s.actual);

    if (p) {
      brierStk += brier1x2(p.p1, p.pX, p.p2, s.actual);
      llStk += logLoss1x2(p.p1, p.pX, p.p2, s.actual);
      if (argmax3(p) === s.actual) correctStk += 1;
    }
  }
  const n = samples.length || 1;
  return {
    n,
    brierPoi: Number((brierPoi / n).toFixed(5)),
    brierMix: Number((brierMix / n).toFixed(5)),
    brierStk: Number((brierStk / n).toFixed(5)),
    logLossPoi: Number((llPoi / n).toFixed(5)),
    logLossMix: Number((llMix / n).toFixed(5)),
    logLossStk: Number((llStk / n).toFixed(5)),
    accuracyStk: Number(((correctStk / n) * 100).toFixed(2)),
    accuracyPoi: Number(((correctPoi / n) * 100).toFixed(2))
  };
}

function argmax3(p) {
  if (p.p1 >= p.pX && p.p1 >= p.p2) return "1";
  if (p.pX >= p.p2) return "X";
  return "2";
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
    .select("league_id, score_home, score_away, match_status, raw_payload")
    .gte("kickoff_at", cutoff)
    .in("match_status", ["FT", "AET", "PEN"])
    .limit(20000);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const settled = (data || []).filter((r) => r.score_home != null && r.score_away != null);
  const samples = buildDataset(settled);
  console.log(`Built dataset: ${samples.length} usable samples (out of ${settled.length} settled rows)`);

  if (samples.length === 0) {
    console.log("No usable samples; exiting.");
    return;
  }

  const firstFeat = extractStackerFeatures({
    poissonProbs: { p1: 0.4, pX: 0.3, p2: 0.3 },
    marketProbs: { p1: 0.4, pX: 0.3, p2: 0.3 }
  });
  const nFeatures = firstFeat.values.length;

  // GLOBAL
  if (samples.length >= MIN_SAMPLES_GLOBAL) {
    console.log(`\nTrain GLOBAL (n=${samples.length})`);
    const w = trainSoftmax(samples.map((s) => ({ ...s })), nFeatures);
    const metrics = computeMetrics(samples, w);
    console.log("  metrics:", metrics);
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
    const w = trainSoftmax(group.map((s) => ({ ...s })), nFeatures);
    const metrics = computeMetrics(group, w);
    console.log("  metrics:", metrics);
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
