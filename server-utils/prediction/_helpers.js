/** Shared helpers for prediction modules (runtime). */

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
