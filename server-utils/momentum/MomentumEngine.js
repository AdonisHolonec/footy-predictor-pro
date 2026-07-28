/**
 * Momentum Engine — foundation module (Sprint 1).
 * Pure, stateless weighted scoring from live /fixtures/statistics data.
 * Does NOT influence PredictorV3 confidence/recommendation — output only.
 */

/**
 * @typedef {object} MomentumTeamStats
 * @property {number|null} [possession]
 * @property {number|null} [shotsTotal]
 * @property {number|null} [shotsOnTarget]
 * @property {number|null} [corners]
 * @property {number|null} [yellowCards]
 * @property {number|null} [redCards]
 */

/**
 * Configurable weights. Positive weights reward the stat; negative weights
 * (cards) penalize it. `dangerousAttacks` / `attacks` / `recentGoals` are kept
 * as inert (0-weight) keys — API-Football's /fixtures/statistics does not expose
 * those types on the plan this project uses, so there is no data to score them
 * with yet. Keeping the keys here means a future sprint can wire real data in
 * without changing this engine's shape.
 */
export const DEFAULT_MOMENTUM_WEIGHTS = Object.freeze({
  possession: 0.2,
  shotsTotal: 0.15,
  shotsOnTarget: 0.25,
  corners: 0.15,
  yellowCards: -0.1,
  redCards: -0.3,
  dangerousAttacks: 0,
  attacks: 0,
  recentGoals: 0
});

function weightedTeamScore(stats, weights) {
  let sum = 0;
  let available = 0;
  let total = 0;
  for (const key of Object.keys(weights)) {
    total += 1;
    const raw = stats?.[key];
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    available += 1;
    const w = Number(weights[key]) || 0;
    if (w === 0) continue;
    sum += Number(raw) * w;
  }
  // Clamp per-team score at 0 so heavy card penalties can't flip the ratio negative.
  return { score: Math.max(0, sum), available, total };
}

function hasAnyStat(stats) {
  return Boolean(stats) && Object.values(stats).some((v) => v != null && Number.isFinite(Number(v)));
}

/**
 * @param {{ home: MomentumTeamStats, away: MomentumTeamStats }} input
 * @param {Partial<typeof DEFAULT_MOMENTUM_WEIGHTS>} [weightsInput]
 * @returns {{ homeMomentum: number, awayMomentum: number, dominantTeam: "home"|"away"|"balanced", trend: "up"|"down"|"stable", confidence: number } | null}
 */
export function buildMomentumEngine(input, weightsInput) {
  const weights = { ...DEFAULT_MOMENTUM_WEIGHTS, ...(weightsInput || {}) };
  const home = input?.home || null;
  const away = input?.away || null;

  // Require at least one usable stat on BOTH sides — one-sided data isn't a
  // fair comparison, so treat it the same as "unavailable" (hide, don't guess).
  if (!hasAnyStat(home) || !hasAnyStat(away)) return null;

  const homeResult = weightedTeamScore(home, weights);
  const awayResult = weightedTeamScore(away, weights);

  const totalScore = homeResult.score + awayResult.score;
  let homeMomentum;
  let awayMomentum;
  if (totalScore <= 0) {
    homeMomentum = 50;
    awayMomentum = 50;
  } else {
    homeMomentum = Math.round((homeResult.score / totalScore) * 100);
    awayMomentum = 100 - homeMomentum;
  }

  const diff = homeMomentum - awayMomentum;
  const dominantTeam = diff > 10 ? "home" : diff < -10 ? "away" : "balanced";

  const availableInputs = homeResult.available + awayResult.available;
  const totalInputs = homeResult.total + awayResult.total;
  const confidence = totalInputs > 0 ? Math.round((availableInputs / totalInputs) * 100) : 0;

  return {
    homeMomentum,
    awayMomentum,
    dominantTeam,
    // Stateless engine has no memory of the previous poll — callers with
    // access to the prior value (the live-poll merge on the client) may
    // override this with a real up/down/stable comparison.
    trend: "stable",
    confidence
  };
}

export default { buildMomentumEngine, DEFAULT_MOMENTUM_WEIGHTS };
