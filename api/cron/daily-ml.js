import { isAuthorizedCronOrInternalRequest } from "../../server-utils/cronRequestAuth.js";
import { getSupabaseAdmin, assertSupabaseConfigured } from "../../server-utils/supabaseAdmin.js";
import { fitIsotonicPav, applyIsotonicMap, invalidateCalibrationCache } from "../../server-utils/isotonicCalibration.js";
import {
  extractStackerFeatures,
  applyStacker,
  softmax3,
  invalidateStackerCache
} from "../../server-utils/mlStacker.js";
import { shinImpliedProbs } from "../../server-utils/advancedMath.js";
import { actual1x2FromScore, brier1x2, logLoss1x2 } from "../../server-utils/probabilityMetrics.js";
import { MODEL_VERSION } from "../../server-utils/modelConstants.js";
import { invalidateEloCache } from "../../server-utils/teamElo.js";
import { invalidateTeamMarketRollingCache } from "../../server-utils/teamMarketRolling.js";

const CALIBRATION_MIN_SAMPLES = Math.max(40, Number(process.env.CALIBRATION_MIN_SAMPLES || 150));
const CALIBRATION_WINDOW_DAYS = Math.max(30, Math.min(Number(process.env.CALIBRATION_WINDOW_DAYS || 180), 720));
const STACKER_MIN_LEAGUE = Math.max(200, Number(process.env.STACKER_MIN_LEAGUE || 400));
const STACKER_MIN_GLOBAL = Math.max(500, Number(process.env.STACKER_MIN_GLOBAL || 1200));
const STACKER_WINDOW_DAYS = Math.max(60, Math.min(Number(process.env.STACKER_WINDOW_DAYS || 220), 720));
const ROW_LIMIT = Math.max(2000, Math.min(Number(process.env.DAILY_ML_ROW_LIMIT || 20000), 50000));

const SGD_EPOCHS = Math.max(40, Math.min(Number(process.env.STACKER_EPOCHS || 120), 400));
const SGD_LR = Number(process.env.STACKER_LR || 0.08);
const SGD_L2 = Number(process.env.STACKER_L2 || 1e-3);
const SGD_BATCH = Math.max(16, Math.min(Number(process.env.STACKER_BATCH || 64), 256));

function extractRawTriple(payload) {
  const ev = payload?.evaluation?.modelProbs1x2Pct;
  if (ev && Number.isFinite(ev.p1) && Number.isFinite(ev.pX) && Number.isFinite(ev.p2)) {
    const s = ev.p1 + ev.pX + ev.p2;
    if (s > 0) return { p1: ev.p1 / s, pX: ev.pX / s, p2: ev.p2 / s };
  }
  const pr = payload?.probs;
  if (pr && Number.isFinite(pr.p1) && Number.isFinite(pr.pX) && Number.isFinite(pr.p2)) {
    const p1 = pr.p1 > 1 ? pr.p1 / 100 : pr.p1;
    const pX = pr.pX > 1 ? pr.pX / 100 : pr.pX;
    const p2 = pr.p2 > 1 ? pr.p2 / 100 : pr.p2;
    const s = p1 + pX + p2;
    if (s > 0) return { p1: p1 / s, pX: pX / s, p2: p2 / s };
  }
  return null;
}

function buildCalibrationGroups(rows) {
  const out = { "1": [], X: [], "2": [] };
  for (const row of rows) {
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const triple = extractRawTriple(payload);
    if (!triple) continue;
    out["1"].push({ x: triple.p1, y: actual === "1" ? 1 : 0 });
    out["X"].push({ x: triple.pX, y: actual === "X" ? 1 : 0 });
    out["2"].push({ x: triple.p2, y: actual === "2" ? 1 : 0 });
  }
  return out;
}

function brierForSamples(samples, fitted) {
  if (!samples.length) return null;
  let raw = 0;
  let cal = 0;
  for (const s of samples) {
    raw += (s.x - s.y) ** 2;
    const c = applyIsotonicMap(s.x, fitted.xPoints, fitted.yPoints);
    cal += (c - s.y) ** 2;
  }
  return { raw: raw / samples.length, calibrated: cal / samples.length };
}

async function upsertCalibrationMap(supabase, { leagueId, modelVersion, outcome, fitted, samples }) {
  if (!fitted?.xPoints?.length) return { skipped: true };
  const brier = brierForSamples(samples, fitted);
  const payload = {
    league_id: leagueId,
    model_version: modelVersion,
    outcome,
    x_points: fitted.xPoints,
    y_points: fitted.yPoints,
    sample_size: samples.length,
    brier_raw: brier ? Number(brier.raw.toFixed(5)) : null,
    brier_calibrated: brier ? Number(brier.calibrated.toFixed(5)) : null,
    fitted_at: new Date().toISOString()
  };
  const { error } = await supabase.from("calibration_maps").upsert(payload, {
    onConflict: "league_id,model_version,outcome"
  });
  if (error) throw error;
  return { ok: true, brier };
}

function oneHot(actual) {
  if (actual === "1") return [1, 0, 0];
  if (actual === "X") return [0, 1, 0];
  if (actual === "2") return [0, 0, 1];
  return null;
}

function buildStackerDataset(rows) {
  const samples = [];
  for (const row of rows) {
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const poissonProbs = extractRawTriple(payload);
    if (!poissonProbs) continue;

    let marketProbs = null;
    const odds = payload.odds;
    if (odds && odds.home && odds.draw && odds.away) {
      const shin = shinImpliedProbs(odds.home, odds.draw, odds.away);
      if (shin) marketProbs = { p1: shin.p1, pX: shin.pX, p2: shin.p2 };
    }

    const lp = payload.modelMeta?.leagueParams || {};
    const feat = extractStackerFeatures({
      poissonProbs,
      marketProbs,
      eloSpread: Number(payload.modelMeta?.eloSpread) || 0,
      dataQuality: Number(payload.modelMeta?.dataQuality) || 0.6,
      homeAdv: Number(lp.homeAdv) || 1.06,
      rho: Number(lp.rho) || -0.1
    });

    samples.push({
      x: feat.values,
      y: oneHot(actual),
      leagueId: Number(row.league_id) || null,
      actual,
      poissonProbs,
      marketProbs
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

function trainSoftmax(samples, nFeatures) {
  const w = initWeights(nFeatures);
  if (!samples.length) return w;

  for (let epoch = 0; epoch < SGD_EPOCHS; epoch++) {
    shuffleInPlace(samples);
    for (let start = 0; start < samples.length; start += SGD_BATCH) {
      const end = Math.min(samples.length, start + SGD_BATCH);
      const bs = end - start;
      let gradI = [0, 0, 0];
      let gradC = Array.from({ length: nFeatures }, () => [0, 0, 0]);

      for (let k = start; k < end; k++) {
        const s = samples[k];
        let l1 = w.intercept[0];
        let lX = w.intercept[1];
        let l2 = w.intercept[2];
        for (let i = 0; i < nFeatures; i++) {
          l1 += s.x[i] * w.coef[i][0];
          lX += s.x[i] * w.coef[i][1];
          l2 += s.x[i] * w.coef[i][2];
        }
        const p = softmax3(l1, lX, l2);
        const d0 = p.p1 - s.y[0];
        const d1 = p.pX - s.y[1];
        const d2 = p.p2 - s.y[2];
        gradI[0] += d0;
        gradI[1] += d1;
        gradI[2] += d2;
        for (let i = 0; i < nFeatures; i++) {
          gradC[i][0] += d0 * s.x[i];
          gradC[i][1] += d1 * s.x[i];
          gradC[i][2] += d2 * s.x[i];
        }
      }

      const scale = SGD_LR / bs;
      w.intercept[0] -= scale * gradI[0];
      w.intercept[1] -= scale * gradI[1];
      w.intercept[2] -= scale * gradI[2];
      for (let i = 0; i < nFeatures; i++) {
        w.coef[i][0] -= scale * (gradC[i][0] + SGD_L2 * w.coef[i][0]);
        w.coef[i][1] -= scale * (gradC[i][1] + SGD_L2 * w.coef[i][1]);
        w.coef[i][2] -= scale * (gradC[i][2] + SGD_L2 * w.coef[i][2]);
      }
    }
  }
  return w;
}

function argmax3(p) {
  if (p.p1 >= p.pX && p.p1 >= p.p2) return "1";
  if (p.pX >= p.p2) return "X";
  return "2";
}

function computeStackerMetrics(samples, weights) {
  let brierPoi = 0;
  let brierStk = 0;
  let llPoi = 0;
  let llStk = 0;
  let correctPoi = 0;
  let correctStk = 0;
  for (const s of samples) {
    const p = applyStacker({ values: s.x }, weights);
    brierPoi += brier1x2(s.poissonProbs.p1, s.poissonProbs.pX, s.poissonProbs.p2, s.actual);
    llPoi += logLoss1x2(s.poissonProbs.p1, s.poissonProbs.pX, s.poissonProbs.p2, s.actual);
    if (argmax3(s.poissonProbs) === s.actual) correctPoi += 1;
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
    brierStk: Number((brierStk / n).toFixed(5)),
    logLossPoi: Number((llPoi / n).toFixed(5)),
    logLossStk: Number((llStk / n).toFixed(5)),
    accuracyPoi: Number(((correctPoi / n) * 100).toFixed(2)),
    accuracyStk: Number(((correctStk / n) * 100).toFixed(2))
  };
}

async function upsertStackerWeights(supabase, { leagueId, modelVersion, weights, metrics, sampleSize, featureNames }) {
  const q = supabase
    .from("ml_stacker_weights")
    .update({ active: false })
    .eq("model_version", modelVersion);
  if (leagueId == null) q.is("league_id", null);
  else q.eq("league_id", leagueId);
  await q;

  const payload = {
    league_id: leagueId,
    model_version: modelVersion,
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

async function loadSettledRows(supabase, days, limit) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("predictions_history")
    .select("league_id, score_home, score_away, match_status, raw_payload, kickoff_at")
    .gte("kickoff_at", cutoff)
    .in("match_status", ["FT", "AET", "PEN"])
    .order("kickoff_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).filter((r) => r.score_home != null && r.score_away != null);
}

async function runCalibration(supabase, modelVersion) {
  const rows = await loadSettledRows(supabase, CALIBRATION_WINDOW_DAYS, ROW_LIMIT);
  const byLeague = new Map();
  for (const r of rows) {
    const id = Number(r.league_id);
    if (!Number.isFinite(id)) continue;
    if (!byLeague.has(id)) byLeague.set(id, []);
    byLeague.get(id).push(r);
  }

  const summary = [];
  for (const [leagueId, leagueRows] of byLeague.entries()) {
    if (leagueRows.length < CALIBRATION_MIN_SAMPLES) {
      summary.push({ leagueId, skipped: true, reason: `n=${leagueRows.length}` });
      continue;
    }
    const groups = buildCalibrationGroups(leagueRows);
    for (const outcome of ["1", "X", "2"]) {
      const samples = groups[outcome];
      if (samples.length < CALIBRATION_MIN_SAMPLES) continue;
      const fitted = fitIsotonicPav(samples);
      const result = await upsertCalibrationMap(supabase, {
        leagueId,
        modelVersion,
        outcome,
        fitted,
        samples
      });
      summary.push({ leagueId, outcome, n: samples.length, ...result });
    }
  }

  const globalGroups = buildCalibrationGroups(rows);
  for (const outcome of ["1", "X", "2"]) {
    const samples = globalGroups[outcome];
    if (samples.length < CALIBRATION_MIN_SAMPLES) continue;
    const fitted = fitIsotonicPav(samples);
    const result = await upsertCalibrationMap(supabase, {
      leagueId: -1,
      modelVersion,
      outcome,
      fitted,
      samples
    });
    summary.push({ leagueId: "GLOBAL", outcome, n: samples.length, ...result });
  }

  return { rows: rows.length, summary };
}

async function runStacker(supabase, modelVersion) {
  const rows = await loadSettledRows(supabase, STACKER_WINDOW_DAYS, ROW_LIMIT);
  const samples = buildStackerDataset(rows);
  if (!samples.length) return { rows: rows.length, samples: 0, trained: [] };

  const featureTemplate = extractStackerFeatures({
    poissonProbs: { p1: 0.4, pX: 0.3, p2: 0.3 },
    marketProbs: { p1: 0.4, pX: 0.3, p2: 0.3 }
  });
  const nFeatures = featureTemplate.values.length;
  const trained = [];

  if (samples.length >= STACKER_MIN_GLOBAL) {
    const w = trainSoftmax(samples.map((s) => ({ ...s })), nFeatures);
    const metrics = computeStackerMetrics(samples, w);
    await upsertStackerWeights(supabase, {
      leagueId: null,
      modelVersion,
      weights: w,
      metrics,
      sampleSize: samples.length,
      featureNames: featureTemplate.featureNames
    });
    trained.push({ leagueId: "GLOBAL", n: samples.length, metrics });
  }

  const byLeague = new Map();
  for (const s of samples) {
    if (!s.leagueId) continue;
    if (!byLeague.has(s.leagueId)) byLeague.set(s.leagueId, []);
    byLeague.get(s.leagueId).push(s);
  }
  for (const [leagueId, group] of byLeague.entries()) {
    if (group.length < STACKER_MIN_LEAGUE) continue;
    const w = trainSoftmax(group.map((s) => ({ ...s })), nFeatures);
    const metrics = computeStackerMetrics(group, w);
    await upsertStackerWeights(supabase, {
      leagueId,
      modelVersion,
      weights: w,
      metrics,
      sampleSize: group.length,
      featureNames: featureTemplate.featureNames
    });
    trained.push({ leagueId, n: group.length, metrics });
  }

  return { rows: rows.length, samples: samples.length, trained };
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }
  if (!isAuthorizedCronOrInternalRequest(req)) {
    return res.status(401).json({ ok: false, error: "Cerere cron neautorizată." });
  }
  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase nu este disponibil." });

  const startedAt = new Date().toISOString();
  const modelVersion = String(req.query.modelVersion || process.env.DAILY_ML_MODEL_VERSION || MODEL_VERSION);
  const mode = String(req.query.mode || "all").toLowerCase();

  try {
    let calibration = null;
    let stacker = null;
    if (mode === "all" || mode === "calibration") calibration = await runCalibration(supabase, modelVersion);
    if (mode === "all" || mode === "stacker") stacker = await runStacker(supabase, modelVersion);

    invalidateCalibrationCache();
    invalidateStackerCache();
    invalidateEloCache();
    invalidateTeamMarketRollingCache();

    return res.status(200).json({
      ok: true,
      mode,
      modelVersion,
      startedAt,
      finishedAt: new Date().toISOString(),
      config: {
        calibrationMinSamples: CALIBRATION_MIN_SAMPLES,
        calibrationWindowDays: CALIBRATION_WINDOW_DAYS,
        stackerMinLeague: STACKER_MIN_LEAGUE,
        stackerMinGlobal: STACKER_MIN_GLOBAL,
        stackerWindowDays: STACKER_WINDOW_DAYS,
        rowLimit: ROW_LIMIT,
        sgd: { epochs: SGD_EPOCHS, lr: SGD_LR, l2: SGD_L2, batch: SGD_BATCH }
      },
      calibration,
      stacker,
      cacheInvalidated: ["calibration", "stacker", "elo", "market-rolling"]
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      mode,
      modelVersion,
      startedAt,
      error: error?.message || "Cron-ul zilnic ML a eșuat."
    });
  }
}
