/**
 * Rolling Expected-Goals (xG) model.
 *
 * Replaces the previous "λ reused as xG" identity with a real, shot-based rolling
 * xG estimate built from the signals API-Football exposes per fixture:
 *   - Total Shots, Shots on Goal (SoT)
 *   - Shots insidebox / outsidebox (shot location = chance quality)
 *   - a big-chance proxy (high-quality on-target inside-box shots)
 *   - Ball Possession (territory tilt)
 *   - provider expected_goals when available (recent xG)
 *
 * Per-match xG is aggregated with recency weighting into rolling for/against
 * rates per team, then combined (Dixon–Coles multiplicative) into xG λ.
 *
 * All weights are env-configurable; the model degrades gracefully to whatever
 * signals a given match/rolling row actually has (SoT + shots at minimum).
 */

function num(v, fallback = null) {
  // MISSING ≠ ZERO: Number(null) este 0 (finit), deci fără această gardă un stat
  // lipsă devenea "0 şuturi" şi producea xG artificial la floor în loc de null.
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function envNum(key, fallback) {
  const n = Number(process.env?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

/** Shot-quality weights (per-shot xG contribution). Env-overridable. */
function weights() {
  return {
    insideBox: envNum("XG_W_INSIDE_BOX", 0.1),
    outsideBox: envNum("XG_W_OUTSIDE_BOX", 0.03),
    bigChance: envNum("XG_W_BIG_CHANCE", 0.06),
    sotResidual: envNum("XG_W_SOT_RESIDUAL", 0.05),
    sotOnly: envNum("XG_W_SOT_ONLY", 0.27),
    offTarget: envNum("XG_W_OFF_TARGET", 0.025),
    providerBlend: clamp(envNum("XG_PROVIDER_BLEND", 0.6), 0, 1),
    recencyDecay: clamp(envNum("XG_RECENCY_DECAY", 0.85), 0.5, 0.99)
  };
}

/**
 * Estimate a single match's xG for a team from its fixture statistics.
 * @param {{ xg?, sot?, shotsTotal?, shotsInsideBox?, shotsOutsideBox?, possession? }} stats
 * @returns {number|null}
 */
export function estimateMatchXg(stats, w = weights()) {
  if (!stats || typeof stats !== "object") return null;
  const provided = num(stats.xg);
  const inBox = num(stats.shotsInsideBox);
  const outBox = num(stats.shotsOutsideBox);
  const sot = num(stats.sot);
  const total = num(stats.shotsTotal);
  const possession = num(stats.possession);

  let shotModel = null;
  if (inBox != null || outBox != null) {
    // Location-aware: inside-box shots carry most of the xG; a big-chance proxy
    // (on-target inside-box shots) is up-weighted; residual on-target shots add a little.
    const big = sot != null && inBox != null ? Math.min(sot, inBox) : 0;
    const sotResidual = sot != null ? Math.max(0, sot - big) : 0;
    shotModel =
      (inBox || 0) * w.insideBox +
      (outBox || 0) * w.outsideBox +
      big * w.bigChance +
      sotResidual * w.sotResidual;
  } else if (sot != null || total != null) {
    // Reduced model when shot locations aren't available: SoT is the strongest cheap proxy.
    const offTarget = total != null && sot != null ? Math.max(0, total - sot) : 0;
    shotModel = (sot || 0) * w.sotOnly + offTarget * w.offTarget;
  }

  // Possession micro-tilt (±10%).
  let tilt = 1;
  if (possession != null) tilt = clamp(0.9 + (possession / 100) * 0.2, 0.9, 1.1);
  let est = shotModel != null ? shotModel * tilt : null;

  // Blend provider xG (recent xG) with the shot model when both exist.
  if (Number.isFinite(provided) && provided > 0) {
    est = est != null ? provided * w.providerBlend + est * (1 - w.providerBlend) : provided;
  }

  return est != null ? clamp(est, 0.05, 6) : null;
}

/**
 * Recency-weighted rolling xG (for/against, + home/away) from enriched match list.
 * Each match: { date, isHome, teamStats, opponentStats }.
 */
export function computeRollingXg(matches, w = weights()) {
  const list = Array.isArray(matches) ? matches.slice() : [];
  if (!list.length) return { xg_samples: 0 };
  // Most-recent first for recency weighting.
  list.sort((a, b) => new Date(b?.date || 0) - new Date(a?.date || 0));

  const acc = {
    for: [],
    against: [],
    forHome: [],
    againstHome: [],
    forAway: [],
    againstAway: []
  };
  list.forEach((m, i) => {
    const decay = Math.pow(w.recencyDecay, i);
    const xgFor = estimateMatchXg(m?.teamStats, w);
    const xgAgainst = estimateMatchXg(m?.opponentStats, w);
    if (xgFor != null) {
      acc.for.push({ v: xgFor, wt: decay });
      (m?.isHome ? acc.forHome : acc.forAway).push({ v: xgFor, wt: decay });
    }
    if (xgAgainst != null) {
      acc.against.push({ v: xgAgainst, wt: decay });
      (m?.isHome ? acc.againstHome : acc.againstAway).push({ v: xgAgainst, wt: decay });
    }
  });

  const wavg = (arr) => {
    if (!arr.length) return null;
    const sw = arr.reduce((s, x) => s + x.wt, 0);
    if (sw <= 0) return null;
    return Number((arr.reduce((s, x) => s + x.v * x.wt, 0) / sw).toFixed(3));
  };

  return {
    xg_samples: acc.for.length,
    xg_for_avg: wavg(acc.for),
    xg_against_avg: wavg(acc.against),
    xg_for_home_avg: wavg(acc.forHome),
    xg_against_home_avg: wavg(acc.againstHome),
    xg_for_away_avg: wavg(acc.forAway),
    xg_against_away_avg: wavg(acc.againstAway),
    xg_source: "shot_rolling_model"
  };
}

/**
 * Resolve rolling xG rates from a rolling row. Prefers stored/live xG fields,
 * falls back to deriving xG from stored SoT / total-shots averages.
 * @returns {{ forRate:number|null, againstRate:number|null, source:string }}
 */
export function rollingXgRates(row, w = weights()) {
  if (!row || typeof row !== "object") return { forRate: null, againstRate: null, source: "none" };

  const forXg = num(row.xg_for_avg);
  const againstXg = num(row.xg_against_avg);
  if (forXg != null || againstXg != null) {
    return { forRate: forXg, againstRate: againstXg, source: row.xg_source || "rolling_xg" };
  }

  // Fallback: derive xG from stored SoT + total-shots averages (real shot data).
  const forRate = estimateMatchXg(
    { sot: row.sot_for_avg, shotsTotal: row.shots_total_for_avg },
    w
  );
  const againstRate = estimateMatchXg(
    { sot: row.sot_against_avg, shotsTotal: row.shots_total_against_avg },
    w
  );
  if (forRate == null && againstRate == null) return { forRate: null, againstRate: null, source: "none" };
  return { forRate, againstRate, source: "sot_shots_derived" };
}

/**
 * Combine rolling xG rates into xG λ (Dixon–Coles multiplicative).
 * λ_home = (xgFor_home · xgAgainst_away / base) · homeAdv
 * @returns {{ xgHome:number, xgAway:number, sample:number, source:string, usedFallback:boolean }|null}
 */
export function deriveXgLambdas({ rollingHome, rollingAway, leagueBaseXg = 1.35, homeAdv = 1.08, awayAdv = 0.95 }) {
  const w = weights();
  const base = Math.max(0.3, num(leagueBaseXg, 1.35) ?? 1.35);
  const h = rollingXgRates(rollingHome, w);
  const a = rollingXgRates(rollingAway, w);

  const forH = h.forRate;
  const againstA = a.againstRate;
  const forA = a.forRate;
  const againstH = h.againstRate;

  // Need at least attack-for on one side and defense-against on the other.
  const canHome = forH != null && againstA != null;
  const canAway = forA != null && againstH != null;
  if (!canHome && !canAway) return null;

  const xgHome = clamp(((canHome ? (forH * againstA) / base : base) ) * homeAdv, 0.15, 5.5);
  const xgAway = clamp(((canAway ? (forA * againstH) / base : base) ) * awayAdv, 0.15, 5.5);

  const source = h.source !== "none" ? h.source : a.source;
  return {
    xgHome: Number(xgHome.toFixed(3)),
    xgAway: Number(xgAway.toFixed(3)),
    sample: Math.max(num(rollingHome?.xg_samples, 0) ?? 0, num(rollingHome?.matches_sampled, 0) ?? 0),
    source,
    usedFallback: source === "sot_shots_derived" || !canHome || !canAway
  };
}

export const RollingXgModel = {
  estimateMatchXg,
  computeRollingXg,
  rollingXgRates,
  deriveXgLambdas
};
export default RollingXgModel;
