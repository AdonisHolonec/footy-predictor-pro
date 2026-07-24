/**
 * Historical backtest: Context Engine ON vs OFF, replayed offline against
 * already-settled fixtures in `predictions_history` — no live API-Football
 * calls (the app's daily quota is only ~100 requests, far too small to
 * re-run the live pipeline per fixture without risking production).
 *
 * Methodology (see docs/history/CONTEXT_ENGINE_BACKTEST.md for full writeup):
 *  - baseline lambdas = the real lambdaHome/lambdaAway already stored in each
 *    fixture's raw_payload (i.e. what the model produced without the Context
 *    Engine, since it was never wired in before this session).
 *  - engineCtx inputs, per fixture, prefer the real captured snapshot from
 *    `prediction_context_snapshots` (injuries, lineups, recent matches, rest
 *    dates, weather, referee stats — captured at predict time by the
 *    context-capture layer, server-utils/context/captureContextSnapshot.js)
 *    when one exists for that fixture_id. Fixtures predicted before the
 *    capture layer shipped have no snapshot row, so those fall back to the
 *    old best-effort reconstruction from the display payload (teamContext
 *    standings/form, referee name; home/away split approximated from
 *    season-average rate). Both paths are merged: standings/form always
 *    come from the reconstruction (the snapshot doesn't carry them),
 *    injuries/lineups/rest-days/weather/refereeStats come from the snapshot
 *    when present, otherwise stay absent (not approximated).
 *  - "with context" lambdas = baseline * ContextEngine's homeMultiplier/
 *    awayMultiplier (the exact function Stage03 now calls in production).
 *  - both lambda pairs are run through the same computeMatchProbs() used in
 *    production, so only the context nudge differs between variants.
 *
 * Usage: node --env-file=.env.local scripts/backtestContextEngine.mjs [days]
 */

import { createClient } from "@supabase/supabase-js";
import { computeMatchProbs, clampLambda, extractFormMultiplier } from "../server-utils/math.js";
import { evaluateContext } from "../server-utils/context/ContextEngine.js";
import { shinImpliedProbs } from "../server-utils/advancedMath.js";
import {
  actual1x2FromScore,
  actualOverFromScore,
  brier1x2,
  logLoss1x2,
  bucketConfidence,
  expectedCalibrationError
} from "../server-utils/probabilityMetrics.js";

const OU_LINE = 2.5;
const EDGE_THRESHOLD = 0.02; // 2pp of model-prob-over-implied-prob to count as a "value" bet

function pct(n, d = 2) {
  return `${(Number(n) || 0).toFixed(d)}%`;
}

function pickFromProbs(probs) {
  const entries = [["1", probs.p1], ["X", probs.pX], ["2", probs.p2]];
  entries.sort((a, b) => b[1] - a[1]);
  return { pick: entries[0][0], prob: entries[0][1] / 100 };
}

function oddsForPick(row, pick) {
  if (pick === "1") return Number(row.odds_home);
  if (pick === "X") return Number(row.odds_draw);
  return Number(row.odds_away);
}

/** Best-effort engineCtx reconstruction from a stored prediction payload. Zero network calls. */
function reconstructEngineCtx(payload) {
  const tc = payload?.teamContext || {};
  const home = tc.home || null;
  const away = tc.away || null;
  const ctx = {};

  if (home?.rank != null) ctx.homeStandingsRow = { rank: home.rank, all: { played: home.played, points: home.points } };
  if (away?.rank != null) ctx.awayStandingsRow = { rank: away.rank, all: { played: away.played, points: away.points } };

  if (home?.form) ctx.hFormMulti = extractFormMultiplier(home.form);
  if (away?.form) ctx.aFormMulti = extractFormMultiplier(away.form);

  // Home/away split isn't stored — approximate with season-average rate (disclosed limitation).
  if (home?.played > 0) {
    ctx.hStats = { gfHome: home.goalsFor / home.played, gaHome: home.goalsAgainst / home.played, played: home.played };
  }
  if (away?.played > 0) {
    ctx.aStats = { gfAway: away.goalsFor / away.played, gaAway: away.goalsAgainst / away.played, played: away.played };
  }

  if (payload?.referee) ctx.refereeName = payload.referee;
  if (payload?.kickoff) ctx.fixtureDate = payload.kickoff;

  return ctx;
}

/** Overlay real captured context-snapshot fields onto the reconstructed ctx. Mutates and returns ctx. */
function mergeSnapshotIntoEngineCtx(ctx, snapshot) {
  if (!snapshot) return ctx;
  if (snapshot.injuries) ctx.injuries = snapshot.injuries;
  if (snapshot.home_lineup) ctx.homeLineup = snapshot.home_lineup;
  if (snapshot.away_lineup) ctx.awayLineup = snapshot.away_lineup;
  if (snapshot.home_recent_matches) ctx.homeRecentMatches = snapshot.home_recent_matches;
  if (snapshot.away_recent_matches) ctx.awayRecentMatches = snapshot.away_recent_matches;
  if (snapshot.home_last_match_date) ctx.homeLastMatchDate = snapshot.home_last_match_date;
  if (snapshot.away_last_match_date) ctx.awayLastMatchDate = snapshot.away_last_match_date;
  if (snapshot.weather) ctx.weather = snapshot.weather;
  if (snapshot.referee_stats) ctx.refereeStats = snapshot.referee_stats;
  return ctx;
}

/** Fetch captured snapshots for a batch of fixture ids. Returns a Map keyed by fixture_id, empty on any failure (e.g. migration not applied yet). */
async function fetchContextSnapshots(supabase, fixtureIds) {
  const map = new Map();
  if (!fixtureIds.length) return map;
  try {
    const { data, error } = await supabase
      .from("prediction_context_snapshots")
      .select(
        "fixture_id, injuries, home_lineup, away_lineup, home_recent_matches, away_recent_matches, home_last_match_date, away_last_match_date, weather, referee_stats"
      )
      .in("fixture_id", fixtureIds);
    if (error) {
      console.error("prediction_context_snapshots query failed (falling back to reconstruction only):", error.message);
      return map;
    }
    for (const row of data || []) {
      if (!map.has(row.fixture_id)) map.set(row.fixture_id, row);
    }
  } catch (e) {
    console.error("prediction_context_snapshots query threw (falling back to reconstruction only):", e?.message || e);
  }
  return map;
}

function newAggregate() {
  return {
    n: 0,
    correct1x2: 0,
    correctOu: 0,
    brierSum: 0,
    logLossSum: 0,
    buckets: new Map(), // bucket -> { n, confSum, correctSum }
    valueBets: 0,
    valueWins: 0,
    valueStake: 0,
    valuePnl: 0,
    allStake: 0,
    allPnl: 0,
    nonNeutralFixtures: 0
  };
}

function recordFixture(agg, { probs, actualWinner, actualTotal, odds, impliedProbs, nonNeutral }) {
  agg.n += 1;
  if (nonNeutral) agg.nonNeutralFixtures += 1;

  const p1 = probs.p1 / 100;
  const pX = probs.pX / 100;
  const p2 = probs.p2 / 100;
  const { pick, prob } = pickFromProbs(probs);
  const correct = pick === actualWinner;
  if (correct) agg.correct1x2 += 1;

  agg.brierSum += brier1x2(p1, pX, p2, actualWinner);
  agg.logLossSum += logLoss1x2(p1, pX, p2, actualWinner);

  const bucket = bucketConfidence(prob * 100);
  const b = agg.buckets.get(bucket) || { n: 0, confSum: 0, correctSum: 0 };
  b.n += 1;
  b.confSum += prob * 100;
  b.correctSum += correct ? 1 : 0;
  agg.buckets.set(bucket, b);

  const pOver = probs.pO25 / 100;
  const ouPick = pOver >= 0.5 ? "O" : "U";
  const actualOver = actualTotal > OU_LINE;
  const ouCorrect = ouPick === "O" ? actualOver : !actualOver;
  if (ouCorrect) agg.correctOu += 1;

  const odd = oddsForPick(odds, pick);
  if (Number.isFinite(odd) && odd > 1) {
    agg.allStake += 1;
    agg.allPnl += correct ? odd - 1 : -1;

    const impliedForPick = pick === "1" ? impliedProbs?.p1 : pick === "X" ? impliedProbs?.pX : impliedProbs?.p2;
    if (Number.isFinite(impliedForPick) && prob - impliedForPick >= EDGE_THRESHOLD) {
      agg.valueBets += 1;
      agg.valueStake += 1;
      agg.valuePnl += correct ? odd - 1 : -1;
      if (correct) agg.valueWins += 1;
    }
  }

  return { pick, prob, correct, ouPick, ouCorrect };
}

function summarize(agg) {
  const buckets = [...agg.buckets.entries()]
    .map(([bucket, b]) => ({
      bucket,
      n: b.n,
      avgConfidence: b.n ? b.confSum / b.n : 0,
      accuracy1x2: b.n ? (b.correctSum / b.n) * 100 : 0
    }))
    .sort((a, b) => b.avgConfidence - a.avgConfidence);

  return {
    n: agg.n,
    nonNeutralFixtures: agg.nonNeutralFixtures,
    accuracy1x2Pct: agg.n ? (agg.correct1x2 / agg.n) * 100 : 0,
    ouAccuracyPct: agg.n ? (agg.correctOu / agg.n) * 100 : 0,
    brierAvg: agg.n ? agg.brierSum / agg.n : null,
    logLossAvg: agg.n ? agg.logLossSum / agg.n : null,
    ece: expectedCalibrationError(buckets),
    buckets,
    valueBets: agg.valueBets,
    valueHitRatePct: agg.valueBets ? (agg.valueWins / agg.valueBets) * 100 : null,
    valueRoiPct: agg.valueStake ? (agg.valuePnl / agg.valueStake) * 100 : null,
    naiveRoiPct: agg.allStake ? (agg.allPnl / agg.allStake) * 100 : null,
    allStake: agg.allStake,
    allPnl: agg.allPnl
  };
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const days = Math.max(1, Number(process.argv[2] || process.env.BACKTEST_DAYS || 30));
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("predictions_history")
    .select("fixture_id, league_id, league_name, kickoff_at, score_home, score_away, odds_home, odds_draw, odds_away, raw_payload")
    .gte("kickoff_at", cutoff)
    .in("match_status", ["FT", "AET", "PEN"])
    .order("kickoff_at", { ascending: true })
    .limit(2000);

  if (error) {
    console.error("Supabase query failed:", error.message);
    process.exit(1);
  }

  const seen = new Set();
  const rows = (data || []).filter((r) => {
    if (seen.has(r.fixture_id)) return false;
    seen.add(r.fixture_id);
    return true;
  });

  const snapshotsById = await fetchContextSnapshots(supabase, rows.map((r) => r.fixture_id));

  const baselineAgg = newAggregate();
  const contextAgg = newAggregate();
  const perFixture = [];
  let skipped = 0;

  for (const row of rows) {
    const payload = row.raw_payload || {};
    const lambdaHome0 = Number(payload?.lambdas?.home ?? payload?.luckStats?.hXG);
    const lambdaAway0 = Number(payload?.lambdas?.away ?? payload?.luckStats?.aXG);
    const actualWinner = actual1x2FromScore(row.score_home, row.score_away);
    const actualOver = actualOverFromScore(row.score_home, row.score_away, OU_LINE);
    const hasOdds = [row.odds_home, row.odds_draw, row.odds_away].every((o) => Number.isFinite(Number(o)) && Number(o) > 1);

    if (!Number.isFinite(lambdaHome0) || !Number.isFinite(lambdaAway0) || !actualWinner || actualOver == null || !hasOdds) {
      skipped += 1;
      continue;
    }

    const actualTotal = Number(row.score_home) + Number(row.score_away);
    const impliedProbs = shinImpliedProbs(row.odds_home, row.odds_draw, row.odds_away);

    const snapshot = snapshotsById.get(row.fixture_id) || null;
    const engineCtx = mergeSnapshotIntoEngineCtx(reconstructEngineCtx(payload), snapshot);
    const contextResult = evaluateContext(engineCtx);
    const nonNeutral = contextResult.modules.some((m) => !m.missingData);

    const lambdaHome1 = contextResult.appliedToLambda ? clampLambda(lambdaHome0 * contextResult.homeMultiplier) : lambdaHome0;
    const lambdaAway1 = contextResult.appliedToLambda ? clampLambda(lambdaAway0 * contextResult.awayMultiplier) : lambdaAway0;

    const probs0 = computeMatchProbs(lambdaHome0, lambdaAway0, 0, {}).probs;
    const probs1 = computeMatchProbs(lambdaHome1, lambdaAway1, 0, {}).probs;

    const baselineResult = recordFixture(baselineAgg, {
      probs: probs0,
      actualWinner,
      actualTotal,
      odds: row,
      impliedProbs,
      nonNeutral
    });
    const contextVariantResult = recordFixture(contextAgg, {
      probs: probs1,
      actualWinner,
      actualTotal,
      odds: row,
      impliedProbs,
      nonNeutral
    });

    perFixture.push({
      fixtureId: row.fixture_id,
      league: row.league_name,
      kickoff: row.kickoff_at,
      actualWinner,
      actualTotal,
      lambdaHome0,
      lambdaAway0,
      lambdaHome1,
      lambdaAway1,
      homeMultiplier: contextResult.homeMultiplier,
      awayMultiplier: contextResult.awayMultiplier,
      nonNeutral,
      hasCapturedSnapshot: Boolean(snapshot),
      pickChanged: baselineResult.pick !== contextVariantResult.pick,
      baseline: baselineResult,
      context: contextVariantResult
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    totalFinishedFixtures: rows.length,
    usableFixtures: perFixture.length,
    skippedFixtures: skipped,
    fixturesWithNonNeutralContext: perFixture.filter((f) => f.nonNeutral).length,
    fixturesWithCapturedSnapshot: perFixture.filter((f) => f.hasCapturedSnapshot).length,
    fixturesWithPickChange: perFixture.filter((f) => f.pickChanged).length,
    baseline: summarize(baselineAgg),
    contextEngine: summarize(contextAgg),
    perFixture
  };

  console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
  console.error("Backtest crashed:", err?.message || err);
  process.exit(1);
});
