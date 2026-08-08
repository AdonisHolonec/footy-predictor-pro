import { isAuthorizedCronOrInternalRequest } from "../../server-utils/cronRequestAuth.js";
import { getSupabaseAdmin, assertSupabaseConfigured } from "../../server-utils/supabaseAdmin.js";
import { getWithCache } from "../../server-utils/fetcher.js";
import { runBenchmarkSweep } from "../../server-utils/predictionBenchmark/runBenchmarkSweep.js";
import { runMetaLearningRefresh } from "../../server-utils/metaLearning/runMetaLearningRefresh.js";
import {
  applyIsotonicMap,
  invalidateCalibrationCache,
  loadCalibrationMaps
} from "../../server-utils/isotonicCalibration.js";
import {
  extractStackerFeatures,
  trainSoftmax,
  computeStackerMetrics,
  invalidateStackerCache
} from "../../server-utils/mlStacker.js";
import { evaluateStackerWalkForward } from "../../server-utils/validation/StackerWalkForward.js";
import { shinImpliedProbs } from "../../server-utils/advancedMath.js";
import {
  actual1x2FromScore,
  actualOverFromScore,
  actualUnderFromScore,
  actualBttsFromScore,
  extractSideMarketProbs
} from "../../server-utils/probabilityMetrics.js";
import { MODEL_VERSION } from "../../server-utils/modelConstants.js";
import { invalidateEloCache } from "../../server-utils/teamElo.js";
import { invalidateTeamMarketRollingCache } from "../../server-utils/teamMarketRolling.js";
import { runAutoCalibration } from "../../server-utils/calibration/AutoCalibrationEngine.js";
import { selectBestCalibration } from "../../server-utils/calibration/CalibrationSelector.js";
import { refreshAutoCalibrationOverlays, clearRuntimeOverlays } from "../../server-utils/calibration/overlayRuntime.js";
import { generateDailyReport } from "../../server-utils/observability/healthBundle.js";
import { recordSyncRun, SYNC_KINDS } from "../../server-utils/observability/syncTelemetry.js";
import { captureOpsSnapshot } from "../../server-utils/observability/opsSnapshot.js";
import { logError, logInfo } from "../../server-utils/observability/logger.js";
import { runAndPromote } from "../../server-utils/modelLab/BlendRecipeSelection.js";
import { extractRawTriple, extractStackerModelTriple } from "../../server-utils/ml/extractRawTriple.js";
import { getLeagueProfile } from "../../server-utils/leagueProfiles/LeagueProfile.js";
import { computeLeagueProfileRecalibration } from "../../server-utils/leagueProfiles/computeLeagueProfileRecalibration.js";
import { saveLeagueProfileOverlay } from "../../server-utils/leagueProfiles/leagueProfileOverlayStore.js";
import {
  refreshLeagueProfileOverlays,
  clearRuntimeLeagueOverlays
} from "../../server-utils/leagueProfiles/leagueProfileOverlayRuntime.js";

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
const STACKER_WF_FOLDS = Math.max(2, Math.min(Number(process.env.STACKER_WF_FOLDS || 3), 6));

const LEAGUE_PROFILE_WINDOW_DAYS = Math.max(30, Math.min(Number(process.env.LEAGUE_PROFILE_WINDOW_DAYS || 270), 720));
const LEAGUE_PROFILE_MIN_SAMPLES = Math.max(20, Number(process.env.LEAGUE_PROFILE_MIN_SAMPLES || 60));
const LEAGUE_PROFILE_SHRINKAGE_K = Math.max(1, Number(process.env.LEAGUE_PROFILE_SHRINKAGE_K || 80));

function buildCalibrationGroups(rows) {
  const out = { "1": [], X: [], "2": [], O15: [], O25: [], U35: [], GG: [] };
  for (const row of rows) {
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (actual) {
      const triple = extractRawTriple(payload);
      if (triple) {
        out["1"].push({ x: triple.p1, y: actual === "1" ? 1 : 0 });
        out["X"].push({ x: triple.pX, y: actual === "X" ? 1 : 0 });
        out["2"].push({ x: triple.p2, y: actual === "2" ? 1 : 0 });
      }
    }
    const sides = extractSideMarketProbs(payload);
    if (!sides) continue;
    const o15 = actualOverFromScore(row.score_home, row.score_away, 1.5);
    const o25 = actualOverFromScore(row.score_home, row.score_away, 2.5);
    const u35 = actualUnderFromScore(row.score_home, row.score_away, 3.5);
    const gg = actualBttsFromScore(row.score_home, row.score_away);
    if (o15 != null && sides.pO15 != null) out.O15.push({ x: sides.pO15, y: o15 });
    if (o25 != null && sides.pO25 != null) out.O25.push({ x: sides.pO25, y: o25 });
    if (u35 != null && sides.pU35 != null) out.U35.push({ x: sides.pU35, y: u35 });
    if (gg != null && sides.pGG != null) out.GG.push({ x: sides.pGG, y: gg });
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
  const base = {
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
  const withMeta = {
    ...base,
    method: fitted.method || "isotonic",
    metrics_json: {
      ranking: fitted.ranking || [],
      baseline: fitted.baseline || null
    }
  };
  // Prefer persisting method + CV metrics; fall back if migration 025 not applied yet.
  let { error } = await supabase.from("calibration_maps").upsert(withMeta, {
    onConflict: "league_id,model_version,outcome"
  });
  if (error && /method|metrics_json|column|schema/i.test(String(error.message || error))) {
    ({ error } = await supabase.from("calibration_maps").upsert(base, {
      onConflict: "league_id,model_version,outcome"
    }));
  }
  if (error) throw error;
  return { ok: true, brier, method: fitted.method || "isotonic" };
}

/**
 * Choose the best calibration method (isotonic / platt / temperature / beta) for a
 * per-outcome sample set, returning a ready-to-store monotone curve.
 */
function fitBestCalibration(samples) {
  const selection = selectBestCalibration(samples, {
    minSamples: CALIBRATION_MIN_SAMPLES,
    folds: 4
  });
  return {
    xPoints: selection.xPoints,
    yPoints: selection.yPoints,
    method: selection.method,
    ranking: selection.ranking,
    baseline: selection.baseline
  };
}

function oneHot(actual) {
  if (actual === "1") return [1, 0, 0];
  if (actual === "X") return [0, 1, 0];
  if (actual === "2") return [0, 0, 1];
  return null;
}

function buildStackerDataset(rows, allMaps = null) {
  const samples = [];
  for (const row of rows) {
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const leagueId = Number(row.league_id) || null;
    // Match Stage07: stacker features from calibrated 1X2, not raw Poisson.
    const poissonProbs = extractStackerModelTriple(payload, allMaps, leagueId);
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
      leagueId,
      actual,
      poissonProbs,
      marketProbs,
      kickoffAt: row.kickoff_at
    });
  }
  return samples;
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
    for (const outcome of ["1", "X", "2", "O15", "O25", "U35", "GG"]) {
      const samples = groups[outcome];
      if (samples.length < CALIBRATION_MIN_SAMPLES) continue;
      const fitted = fitBestCalibration(samples);
      const result = await upsertCalibrationMap(supabase, {
        leagueId,
        modelVersion,
        outcome,
        fitted,
        samples
      });
      summary.push({ leagueId, outcome, n: samples.length, method: fitted.method, ...result });
    }
  }

  const globalGroups = buildCalibrationGroups(rows);
  const methodTally = {};
  for (const outcome of ["1", "X", "2", "O15", "O25", "U35", "GG"]) {
    const samples = globalGroups[outcome];
    if (samples.length < CALIBRATION_MIN_SAMPLES) continue;
    const fitted = fitBestCalibration(samples);
    methodTally[outcome] = { method: fitted.method, ranking: fitted.ranking, baseline: fitted.baseline };
    const result = await upsertCalibrationMap(supabase, {
      leagueId: -1,
      modelVersion,
      outcome,
      fitted,
      samples
    });
    summary.push({ leagueId: "GLOBAL", outcome, n: samples.length, method: fitted.method, ...result });
  }

  return { rows: rows.length, summary, methodSelection: methodTally };
}

async function runStacker(supabase, modelVersion) {
  const rows = await loadSettledRows(supabase, STACKER_WINDOW_DAYS, ROW_LIMIT);
  // Prefer current maps so historical rows without calibratedProbs replay Stage06.
  const allMaps = await loadCalibrationMaps(modelVersion).catch(() => ({}));
  const samples = buildStackerDataset(rows, allMaps);
  if (!samples.length) return { rows: rows.length, samples: 0, trained: [], featureSource: "calibrated_1x2" };

  const featureTemplate = extractStackerFeatures({
    poissonProbs: { p1: 0.4, pX: 0.3, p2: 0.3 },
    marketProbs: { p1: 0.4, pX: 0.3, p2: 0.3 }
  });
  const nFeatures = featureTemplate.values.length;
  const trained = [];
  const sgdOpts = { epochs: SGD_EPOCHS, lr: SGD_LR, l2: SGD_L2, batch: SGD_BATCH };

  // Production weights are still fit on the FULL sample set — walk-forward only
  // changes how we measure/report them, not what gets deployed. In-sample metrics
  // are kept (renamed) as a fit-quality diagnostic, not a performance claim.
  function scopeMetrics(scopeSamples) {
    const w = trainSoftmax(scopeSamples.map((s) => ({ ...s })), nFeatures, sgdOpts);
    const inSample = computeStackerMetrics(scopeSamples, w);
    const walkForward = evaluateStackerWalkForward(scopeSamples, nFeatures, {
      folds: STACKER_WF_FOLDS,
      ...sgdOpts
    });
    return { weights: w, metrics: { inSample, walkForward } };
  }

  if (samples.length >= STACKER_MIN_GLOBAL) {
    const { weights: w, metrics } = scopeMetrics(samples);
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
    const { weights: w, metrics } = scopeMetrics(group);
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

  return { rows: rows.length, samples: samples.length, trained, featureSource: "calibrated_1x2" };
}

async function runLeagueProfileRecalibration(supabase, modelVersion) {
  const rows = await loadSettledRows(supabase, LEAGUE_PROFILE_WINDOW_DAYS, ROW_LIMIT);
  const byLeague = new Map();
  for (const r of rows) {
    const id = Number(r.league_id);
    if (!Number.isFinite(id)) continue;
    if (!byLeague.has(id)) byLeague.set(id, []);
    byLeague.get(id).push(r);
  }

  const summary = [];
  for (const [leagueId, leagueRows] of byLeague.entries()) {
    const staticProfile = getLeagueProfile(leagueId);
    const result = computeLeagueProfileRecalibration(leagueRows, staticProfile, {
      minSamples: LEAGUE_PROFILE_MIN_SAMPLES,
      shrinkageK: LEAGUE_PROFILE_SHRINKAGE_K
    });
    if (!result) {
      summary.push({ leagueId, skipped: true, reason: `n=${leagueRows.length}` });
      continue;
    }
    await saveLeagueProfileOverlay({
      leagueId,
      modelVersion,
      values: result.values,
      sampleSize: result.sampleSize,
      metrics: result.metrics
    });
    summary.push({ leagueId, n: result.sampleSize, values: result.values });
  }

  return { rows: rows.length, summary };
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }
  if (!isAuthorizedCronOrInternalRequest(req)) {
    return res.status(401).json({ ok: false, error: "Cerere cron neautorizată." });
  }

  const mode = String(req.query.mode || "all").toLowerCase();
  // Ops daily report — no ML training; folded here for Hobby serverless function limits.
  if (mode === "ops-report" || mode === "ops_report" || mode === "daily-report") {
    try {
      const report = await generateDailyReport(req.query.date || undefined);
      logInfo("cron.daily_report", { date: report?.date, status: report?.status });
      return res.status(200).json({ ok: true, mode, report });
    } catch (err) {
      logError("cron.daily_report_failed", { error: err?.message || String(err) });
      return res.status(500).json({ ok: false, mode, error: err?.message || "Daily report failed" });
    }
  }
  // Ops health snapshot (S3) — aggregates predictions_history / profiles once a day so
  // the Health dashboard reads one row instead of scanning thousands. Read-only with
  // respect to every other table; writes only ops_health_snapshots.
  if (mode === "ops-snapshot" || mode === "ops_snapshot" || mode === "health-snapshot") {
    try {
      const result = await captureOpsSnapshot({
        windowDays: req.query.windowDays,
        dryRun: String(req.query.dryRun || "") === "1"
      });
      return res.status(200).json({ ok: result.ok !== false, mode, ...result });
    } catch (err) {
      logError("cron.ops_snapshot_failed", { error: err?.message || String(err) });
      return res.status(200).json({ ok: false, mode, error: err?.message || "snapshot_failed" });
    }
  }

  // Prediction benchmark sweep — comparison-only vs API-Football, no ML training;
  // folded here for Hobby serverless function limits (see runBenchmarkSweep.js).
  if (mode === "prediction-benchmark-sweep" || mode === "prediction_benchmark_sweep" || mode === "benchmark-sweep") {
    if (String(process.env.PREDICTION_BENCHMARK_ENABLED || "0") !== "1") {
      return res.status(200).json({ ok: true, mode, skipped: "flag_disabled" });
    }
    try {
      const result = await runBenchmarkSweep({ getWithCache });
      // Persist the sweep result so coverage and backlog become a trend rather than a
      // number that lived only in this response. Never blocks the cron.
      void recordSyncRun(SYNC_KINDS.BENCHMARK, result);
      return res.status(200).json({ ok: true, mode, ...result });
    } catch (err) {
      // Never throw past the cron boundary — log-and-continue, same convention as Stage10Persistence.js.
      logError("cron.prediction_benchmark_sweep_failed", { error: err?.message || String(err) });
      return res.status(200).json({ ok: false, mode, error: err?.message || "sweep_failed" });
    }
  }

  // Meta-learning ETL — read-only projection of predictions_history +
  // prediction_benchmarks into the derived meta_* tables. No ML training, no upstream
  // API calls (so it cannot contend with apiBudgetCircuit.js), and nothing it writes is
  // ever read by PredictorV3 or the Recommendation Engine. Folded here rather than given
  // its own endpoint for the Hobby serverless function limit.
  if (mode === "meta-learning-refresh" || mode === "meta_learning_refresh" || mode === "meta-refresh") {
    try {
      const result = await runMetaLearningRefresh({
        modelVersion: req.query.modelVersion || undefined,
        windowDays: req.query.windowDays != null ? Number(req.query.windowDays) : undefined,
        dryRun: String(req.query.dryRun || "") === "1"
      });
      logInfo("cron.meta_learning_refresh", {
        ok: result.ok,
        selections: result.selections ?? null,
        comparabilityPct: result.health?.coverage?.comparabilityPct ?? null,
        readiness: result.health?.power?.readiness ?? null
      });
      return res.status(200).json({ ok: result.ok !== false, mode, ...result });
    } catch (err) {
      // Never throw past the cron boundary — same convention as the benchmark sweep.
      logError("cron.meta_learning_refresh_failed", { error: err?.message || String(err) });
      return res.status(200).json({ ok: false, mode, error: err?.message || "meta_refresh_failed" });
    }
  }

  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase nu este disponibil." });

  // Auto model selection — every model competes over 30/90/365d; promote the best.
  if (mode === "model-selection" || mode === "model_select" || mode === "model-select") {
    try {
      const cutoffIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("predictions_history")
        .select("fixture_id, league_id, kickoff_at, score_home, score_away, odds_home, odds_draw, odds_away, luck_hxg, luck_axg, raw_payload")
        .gte("kickoff_at", cutoffIso)
        .in("validation", ["win", "loss"])
        .order("kickoff_at", { ascending: true })
        .limit(12000);
      if (error) throw error;
      const result = await runAndPromote(data || []);
      logInfo("cron.model_selection", { promoted: result.promoted?.id, composite: result.promoted?.compositeScore });
      return res.status(200).json({ ok: true, mode, promoted: result.promoted, selected: result.selected });
    } catch (err) {
      logError("cron.model_selection_failed", { error: err?.message || String(err) });
      return res.status(500).json({ ok: false, mode, error: err?.message || "Model selection failed" });
    }
  }

  const startedAt = new Date().toISOString();
  const modelVersion = String(req.query.modelVersion || process.env.DAILY_ML_MODEL_VERSION || MODEL_VERSION);

  try {
    let calibration = null;
    let stacker = null;
    let autoCalibration = null;
    let leagueProfiles = null;
    if (mode === "all" || mode === "calibration") calibration = await runCalibration(supabase, modelVersion);
    if (mode === "all" || mode === "stacker") stacker = await runStacker(supabase, modelVersion);
    if (mode === "all" || mode === "auto-calibration" || mode === "auto_calibration") {
      autoCalibration = await runAutoCalibration({ modelVersion, mode: "auto" });
      clearRuntimeOverlays();
      await refreshAutoCalibrationOverlays(modelVersion).catch(() => ({}));
    }
    if (mode === "all" || mode === "league-profiles" || mode === "league_profiles") {
      leagueProfiles = await runLeagueProfileRecalibration(supabase, modelVersion);
      clearRuntimeLeagueOverlays();
      await refreshLeagueProfileOverlays(modelVersion).catch(() => new Map());
    }

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
        sgd: { epochs: SGD_EPOCHS, lr: SGD_LR, l2: SGD_L2, batch: SGD_BATCH },
        stackerWalkForwardFolds: STACKER_WF_FOLDS,
        leagueProfileWindowDays: LEAGUE_PROFILE_WINDOW_DAYS,
        leagueProfileMinSamples: LEAGUE_PROFILE_MIN_SAMPLES,
        leagueProfileShrinkageK: LEAGUE_PROFILE_SHRINKAGE_K
      },
      calibration,
      stacker,
      autoCalibration: autoCalibration
        ? {
            ok: autoCalibration.ok,
            skipped: autoCalibration.skipped || false,
            reason: autoCalibration.reason || null,
            summary: autoCalibration.summary || null,
            report: autoCalibration.report || null
          }
        : null,
      leagueProfiles,
      cacheInvalidated: ["calibration", "stacker", "elo", "market-rolling", "auto-calibration", "league-profiles"]
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
