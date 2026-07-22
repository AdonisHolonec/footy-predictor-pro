/**
 * Pure computation of recalibrated league-profile priors from settled results.
 * No I/O — callers (the cron job) load rows from Supabase and pass them in.
 */

import {
  actual1x2FromScore,
  actualOverFromScore,
  actualBttsFromScore
} from "../probabilityMetrics.js";
import { applyBayesianShrinkage } from "../math.js";

const FIELDS = ["overFrequency", "bttsRate", "drawFrequency", "goalFrequency", "homeAdvantage"];

/**
 * Invert LeagueProfile.js's splitGoalAverages() home-share formula
 * (homeShare = 0.5 + (homeAdv - 1) * 0.9) to recover an empirical homeAdvantage
 * from the observed home goal-share.
 */
function homeAdvantageFromGoalShare(homeGoalShare) {
  return 1 + (homeGoalShare - 0.5) / 0.9;
}

/**
 * @param {Array<{league_id:number, score_home:number, score_away:number}>} rows - settled rows for one league
 * @param {{overFrequency:number, bttsRate:number, drawFrequency:number, goalFrequency:number, homeAdvantage:number}} staticDefaults
 * @param {{minSamples?:number, shrinkageK?:number}} [opts]
 * @returns {{leagueId:number, values:object, sampleSize:number, metrics:object}|null}
 */
export function computeLeagueProfileRecalibration(rows, staticDefaults, opts = {}) {
  const minSamples = Math.max(1, Number(opts.minSamples) || 60);
  const shrinkageK = Math.max(1, Number(opts.shrinkageK) || 80);

  const list = Array.isArray(rows) ? rows : [];
  const n = list.length;
  if (n < minSamples) return null;

  let leagueId = null;
  let overCount = 0;
  let bttsCount = 0;
  let drawCount = 0;
  let totalGoals = 0;
  let totalHomeGoals = 0;

  for (const row of list) {
    const h = Number(row.score_home);
    const a = Number(row.score_away);
    if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
    if (leagueId == null) leagueId = Number(row.league_id);

    if (actualOverFromScore(h, a, 2.5) === 1) overCount++;
    if (actualBttsFromScore(h, a) === 1) bttsCount++;
    if (actual1x2FromScore(h, a) === "X") drawCount++;
    totalGoals += h + a;
    totalHomeGoals += h;
  }

  if (!(totalGoals > 0)) return null;

  const empirical = {
    overFrequency: overCount / n,
    bttsRate: bttsCount / n,
    drawFrequency: drawCount / n,
    goalFrequency: totalGoals / n,
    homeAdvantage: homeAdvantageFromGoalShare(totalHomeGoals / totalGoals)
  };

  const shrunk = {};
  const metrics = { sampleSize: n, empirical: {}, shrunk: {}, previousStatic: {} };
  for (const field of FIELDS) {
    const prior = Number(staticDefaults?.[field]);
    const value = applyBayesianShrinkage(empirical[field], n, prior, shrinkageK);
    shrunk[field] = value;
    metrics.empirical[field] = empirical[field];
    metrics.shrunk[field] = value;
    metrics.previousStatic[field] = prior;
  }

  return { leagueId, values: shrunk, sampleSize: n, metrics };
}

export default computeLeagueProfileRecalibration;
