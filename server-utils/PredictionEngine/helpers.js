/** Shared helpers for PredictionEngine modules (runtime). */

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function clampFactor(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 1;
  return clamp(n, 0.25, 3.2);
}

export function leagueAvgFromContext(ctx) {
  return Number(ctx?.leagueParams?.leagueAvg ?? ctx?.leagueParams?.leagueAvgGoals) || 1.35;
}

/** Standard module result. */
export function result(score, confidence, details = {}) {
  const s = Number(score);
  const c = Number(confidence);
  return {
    score: Number.isFinite(s) ? s : 1,
    confidence: Number.isFinite(c) ? clamp(c, 0, 1) : 0,
    details: details && typeof details === "object" ? details : {}
  };
}

/** Neutral multiplicative factor when data is missing. */
export function neutral(details = {}) {
  return result(1, 0, { home: 1, away: 1, available: false, ...details });
}

/** Map ModuleResult → legacy ModuleScore shape used by API summarize. */
export function toModuleScore(mod) {
  if (!mod) return { score: 1, confidence: 0, detail: {}, details: {} };
  return {
    score: mod.score,
    confidence: mod.confidence,
    detail: mod.details,
    details: mod.details,
    probs: mod.details?.probs,
    bestScore: mod.details?.bestScore,
    bestScoreProb: mod.details?.bestScoreProb
  };
}
