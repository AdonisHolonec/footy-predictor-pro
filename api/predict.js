// api/predict.js
import { readBearer } from "../server-utils/authAdmin.js";
import { checkAnonymousRateLimit } from "../server-utils/anonymousRateLimit.js";
import { getWithCache } from "../server-utils/fetcher.js";
import {
  computeMatchProbs,
  clampLambda,
  extractFormMultiplier,
  extractAdvancedGoalsAverages,
  normalizeTeamStatisticsPayload,
  strengthRatingsLambdas
} from "../server-utils/math.js";
import {
  calculateEV,
  calculateKellyQuarter as calculateKelly,
  calculateEnsembleStake,
  blendModelWithMarket,
  evaluateNoBetZone,
  shinImpliedProbs
} from "../server-utils/advancedMath.js";
import { consensusMatchWinnerOdds } from "../server-utils/marketOdds.js";
import { MODEL_VERSION, getModelMarketBlendWeight, getLeagueParams } from "../server-utils/modelConstants.js";
import { todayCalendarEuropeBucharest } from "../server-utils/fixtureCalendarDateKey.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { upsertPredictionsHistory } from "../server-utils/predictionsHistory.js";
import {
  loadCalibrationMaps,
  pickCalibrationMapForLeague,
  applyCalibratedTriple
} from "../server-utils/isotonicCalibration.js";
import {
  loadStackerWeights,
  pickStackerWeightsForLeague,
  extractStackerFeatures,
  applyStacker
} from "../server-utils/mlStacker.js";
import { lookupEloPair, eloProbabilities } from "../server-utils/teamElo.js";
import {
  commitWarmPredictIncrement,
  isWarmPredictQuotaExempt,
  peekWarmPredictUsage,
  resolveAuthenticatedUsageContext,
  rollbackPredictIncrement
} from "../server-utils/userDailyWarmPredictUsage.js";

function isGoodNum(val) {
  return typeof val === "number" && !isNaN(val) && val > 0;
}

/** Avoid IEEE noise in JSON/UI for λ and goal-rate scalars. */
function roundDisplayRate(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return x;
  return Number(x.toFixed(3));
}

const LEAGUE_CONFIDENCE_MULTIPLIERS = {
  39: 1.0,
  140: 0.98,
  135: 0.97,
  78: 0.95,
  61: 0.95,
  2: 0.93,
  3: 0.93,
  283: 0.9
};

const LEAGUE_STAKE_CAPS = {
  39: 3.0,
  140: 2.8,
  135: 2.7,
  78: 2.5,
  61: 2.5,
  2: 2.2,
  3: 2.2,
  283: 2.0
};

function getLeagueConfidenceMultiplier(leagueId) {
  return LEAGUE_CONFIDENCE_MULTIPLIERS[Number(leagueId)] || 0.88;
}

function getLeagueStakeCap(leagueId) {
  return LEAGUE_STAKE_CAPS[Number(leagueId)] || 1.9;
}

function clampPct(n) {
  return Math.max(0, Math.min(100, Number(n) || 0));
}

/**
 * Clasificare încredere pentru o piaţă binară (YES/NO) sau pentru pick-ul top al unei pieţe multi-way.
 *   strong        → ≥ 65% (semnal clar)
 *   lean          → 55%..65% (direcţie moderată)
 *   toss          → 45%..55% (practic 50/50 — UI trebuie să marcheze explicit)
 *   lean_off      → 35%..45% (cealaltă parte e mai probabilă, dar nesigur)
 *   strong_off    → ≤ 35%
 */
function marketTier(pYesPct) {
  const p = Number(pYesPct) || 0;
  if (p >= 65) return "strong";
  if (p >= 55) return "lean";
  if (p >= 45) return "toss";
  if (p >= 35) return "lean_off";
  return "strong_off";
}

/**
 * Extrage toate rândurile de clasament din răspunsul API-Football (structuri multiple:
 * standings[] de array-uri, listă plată, sau obiecte cu .table).
 */
function standingsRowsFromApi(apiData) {
  const raw = apiData?.response;
  if (raw == null) return [];
  const blocks = Array.isArray(raw) ? raw : [raw];
  const collected = [];
  for (const block of blocks) {
    const league = block?.league ?? block;
    const st = league?.standings;
    if (!Array.isArray(st) || st.length === 0) continue;
    const head = st[0];
    if (Array.isArray(head)) {
      for (const inner of st) {
        if (Array.isArray(inner)) {
          for (const row of inner) {
            if (row?.team?.id) collected.push(row);
          }
        }
      }
      continue;
    }
    if (head?.team?.id) {
      for (const row of st) {
        if (row?.team?.id) collected.push(row);
      }
      continue;
    }
    if (head && typeof head === "object" && Array.isArray(head.table)) {
      for (const grp of st) {
        const tbl = grp?.table;
        if (Array.isArray(tbl)) {
          for (const row of tbl) {
            if (row?.team?.id) collected.push(row);
          }
        }
      }
    }
  }
  const byTeam = new Map();
  for (const row of collected) {
    const id = row?.team?.id;
    if (id != null) byTeam.set(Number(id), row);
  }
  return Array.from(byTeam.values());
}

function coerceFormFromTeamStats(norm) {
  if (!norm?.response) return null;
  const r = norm.response;
  if (typeof r.form === "string" && r.form.trim()) return r.form;
  return null;
}

function normalizeFormString(form) {
  if (!form || typeof form !== "string") return null;
  const s = form.toUpperCase().replace(/[^WDL]/g, "");
  return s.length ? s : null;
}

function sliceFormDisplay(form, maxLen = 10) {
  const s = normalizeFormString(form);
  return s ? s.slice(-maxLen) : null;
}

function standingsTeamSnapshot(row) {
  if (!row?.team?.id) return null;
  const all = row.all || {};
  const played = Number(all.played ?? row.played);
  const pts = Number(row.points);
  const rankRaw = row.rank != null ? row.rank : row.position;
  const rank = Number(rankRaw);
  const gf = Number(all.goals?.for ?? row.goals?.for) || 0;
  const ga = Number(all.goals?.against ?? row.goals?.against) || 0;
  const gdRaw = row.goalsDiff != null ? Number(row.goalsDiff) : gf - ga;
  return {
    teamId: row.team.id,
    rank: Number.isFinite(rank) ? rank : null,
    points: Number.isFinite(pts) ? pts : null,
    played: Number.isFinite(played) ? played : null,
    form: sliceFormDisplay(row.form, 10),
    goalsFor: gf,
    goalsAgainst: ga,
    goalsDiff: Number.isFinite(gdRaw) ? gdRaw : null
  };
}

function buildTeamContext({ homeIdStr, awayIdStr, standingsMap, formHome, formAway }) {
  const homeRow = homeIdStr ? standingsMap.get(homeIdStr) : null;
  const awayRow = awayIdStr ? standingsMap.get(awayIdStr) : null;
  let home = homeRow ? standingsTeamSnapshot(homeRow) : null;
  let away = awayRow ? standingsTeamSnapshot(awayRow) : null;
  const fh = sliceFormDisplay(formHome, 10);
  const fa = sliceFormDisplay(formAway, 10);
  if (fh) home = { ...(home || { teamId: homeIdStr ? Number(homeIdStr) : undefined }), form: fh };
  if (fa) away = { ...(away || { teamId: awayIdStr ? Number(awayIdStr) : undefined }), form: fa };
  if (!home && !away) return undefined;
  return { home: home || undefined, away: away || undefined };
}

function buildLeagueStandingsTable(standingsRows) {
  if (!Array.isArray(standingsRows) || standingsRows.length === 0) return undefined;
  const rows = standingsRows
    .map((row) => {
      const s = standingsTeamSnapshot(row);
      if (!s?.teamId) return null;
      return {
        rank: s.rank,
        teamId: s.teamId,
        teamName: row.team?.name || "",
        logo: row.team?.logo || undefined,
        played: s.played,
        points: s.points,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
        goalsDiff: s.goalsDiff,
        form: s.form
      };
    })
    .filter(Boolean);
  rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  return rows.length ? rows : undefined;
}

function extendProbsWithMarkets(p) {
  const p1 = clampPct(p.p1);
  const pX = clampPct(p.pX);
  const p2 = clampPct(p.p2);
  const pO15 = clampPct(p.pO15);
  const pGG = clampPct(p.pGG);
  const pO25 = clampPct(p.pO25);
  return {
    ...p,
    p1,
    pX,
    p2,
    pDC1X: clampPct(p1 + pX),
    pDC12: clampPct(p1 + p2),
    pDCX2: clampPct(pX + p2),
    pU15: clampPct(100 - pO15),
    pNGG: clampPct(100 - pGG),
    pU25: clampPct(100 - pO25)
  };
}

function dataQualityScore({ method, hasOdds, hasLuckStats, hasTeamIds }) {
  let score = 0.35;
  if (hasTeamIds) score += 0.15;
  if (hasOdds) score += 0.2;
  if (hasLuckStats) score += 0.2;
  if (method === "strength-ratings" || method === "standings") score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function blendByPenalty(base, multiplier = 1) {
  return clampPct(base * Math.max(0.7, Math.min(1.05, multiplier)));
}

function resolveConfidenceBucket(confidencePct) {
  const c = Number(confidencePct) || 0;
  if (c >= 78) return { label: "elite", multiplier: 1.15 };
  if (c >= 70) return { label: "high", multiplier: 1.0 };
  if (c >= 62) return { label: "medium", multiplier: 0.82 };
  if (c >= 54) return { label: "guarded", multiplier: 0.58 };
  return { label: "low", multiplier: 0.25 };
}

function applyStakePolicyV2({ stakePct, confidencePct, dataQuality, leagueStakeCap, cooldownCap }) {
  const bucket = resolveConfidenceBucket(confidencePct);
  const qualityMul = dataQuality >= 0.75 ? 1 : dataQuality >= 0.62 ? 0.88 : 0.7;
  const dynamicCap = Math.min(leagueStakeCap, cooldownCap);
  const adjusted = (Number(stakePct) || 0) * bucket.multiplier * qualityMul;
  const capped = Math.max(0, Math.min(adjusted, dynamicCap));
  return {
    stakePct: Number(capped.toFixed(2)),
    bucket: bucket.label,
    bucketMultiplier: Number(bucket.multiplier.toFixed(2)),
    qualityMultiplier: Number(qualityMul.toFixed(2)),
    dynamicCap: Number(dynamicCap.toFixed(2))
  };
}

function estimateRollingDrawdown(rows) {
  let pnl = 0;
  let peak = 0;
  let maxDd = 0;
  for (const row of rows) {
    const payload = row.raw_payload || {};
    const val = payload.valueBet || {};
    const stake = Math.max(0, Math.min((Number(val.kelly) || 0) / 100, 0.03));
    const odd = val.type === "1" ? Number(row.odds_home) : val.type === "X" ? Number(row.odds_draw) : Number(row.odds_away);
    if (!stake || !isFinite(odd) || odd <= 1) continue;
    const vbOutcome = row.value_bet_validation ?? payload.value_bet_validation;
    const won = vbOutcome === "win" || (vbOutcome == null && row.validation === "win");
    const lost = vbOutcome === "loss" || (vbOutcome == null && row.validation === "loss");
    if (won) pnl += stake * (odd - 1);
    else if (lost) pnl -= stake;
    peak = Math.max(peak, pnl);
    maxDd = Math.max(maxDd, peak - pnl);
  }
  return maxDd;
}

async function loadRiskContext() {
  const ctx = { avgDist: null, cooldownCap: 3 };
  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) return ctx;
  const supabase = getSupabaseAdmin();
  if (!supabase) return ctx;

  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("predictions_history")
      .select("raw_payload, validation, odds_home, odds_draw, odds_away, value_bet_validation")
      .gte("kickoff_at", cutoff)
      .limit(400);

    const rows = data || [];
    const withProbs = rows.map((r) => r.raw_payload?.probs).filter((p) => p && isFinite(p.p1) && isFinite(p.pX) && isFinite(p.p2));

    if (withProbs.length > 0) {
      const mean = withProbs.reduce(
        (acc, p) => {
          acc.p1 += Number(p.p1);
          acc.pX += Number(p.pX);
          acc.p2 += Number(p.p2);
          return acc;
        },
        { p1: 0, pX: 0, p2: 0 }
      );
      ctx.avgDist = {
        p1: mean.p1 / withProbs.length,
        pX: mean.pX / withProbs.length,
        p2: mean.p2 / withProbs.length
      };
    }

    const settled = rows.filter((r) => r.validation === "win" || r.validation === "loss");
    const dd = estimateRollingDrawdown(settled);
    if (dd >= 3) ctx.cooldownCap = 1.5;
    else if (dd >= 2) ctx.cooldownCap = 2.0;
  } catch {
    // silent fallback
  }

  return ctx;
}

export default async function handler(req, res) {
  const date = req.query.date || todayCalendarEuropeBucharest();
  const leagueIdsStr = req.query.leagueIds || "";
  const leagueIds = leagueIdsStr.split(",").filter(Boolean).map((s) => s.trim());
  const season = req.query.season || new Date().getFullYear();
  const limit = Math.min(Number(req.query.limit || 50), 50);

  if (leagueIds.length === 0) {
    return res.status(400).json({ ok: false, error: "Nu ai selectat nicio ligă." });
  }

  if (!readBearer(req)) {
    const maxPerHour = Math.max(1, Math.min(Number(process.env.ANON_RATE_PREDICT_PER_HOUR || 16), 200));
    const rl = await checkAnonymousRateLimit(req, { namespace: "predict", maxPerHour });
    if (!rl.ok) {
      return res.status(429).json({
        ok: false,
        error: "Prea multe cereri anonime pentru Predict. Autentifica-te sau incearca mai tarziu.",
        retryAfterSec: rl.retryAfterSec
      });
    }
  }

  const usageCtx = await resolveAuthenticatedUsageContext(req);
  if (usageCtx.error) {
    return res.status(usageCtx.error.status).json(usageCtx.error.body);
  }
  let enforceWarmPredictQuota = false;
  if (!usageCtx.anonymous && usageCtx.userId) {
    const exempt = await isWarmPredictQuotaExempt(usageCtx.userId, usageCtx.userEmail);
    enforceWarmPredictQuota = !exempt;
  }
  if (enforceWarmPredictQuota) {
    const peek = await peekWarmPredictUsage(usageCtx.userId, usageCtx.usageDay);
    if (peek.predict >= 3) {
      return res.status(429).json({
        ok: false,
        error: "Limita zilnica Predict atinsa (maximum 3/zi).",
        usage: { warm_count: peek.warm, predict_count: peek.predict, usage_day: usageCtx.usageDay }
      });
    }
  }

  try {
    const out = [];
    const riskContext = await loadRiskContext();
    // single-flight: încărcăm calibrarea + stacker o singură dată per request
    const [calibrationMaps, stackerWeightsMap] = await Promise.all([
      loadCalibrationMaps(MODEL_VERSION).catch(() => ({})),
      loadStackerWeights(MODEL_VERSION).catch(() => new Map())
    ]);
    const dayReq = await getWithCache("/fixtures", { date }, 21600);
    const allFixtures = dayReq.data?.response || dayReq.data || [];

    for (const lId of leagueIds) {
      if (out.length >= limit) break;
      const leagueFixtures = allFixtures.filter((f) => String(f.league?.id) === String(lId));
      if (leagueFixtures.length === 0) continue;

      const leagueParams = getLeagueParams(lId);

      const standingsReq = await getWithCache("/standings", { league: lId, season }, 86400);
      const standingsRows = standingsReq.ok ? standingsRowsFromApi(standingsReq.data) : [];
      const standingsMap = new Map();
      standingsRows.forEach((r) => {
        if (r?.team?.id) standingsMap.set(String(r.team.id), r);
      });
      const leagueStandings = buildLeagueStandingsTable(standingsRows);

      for (const fx of leagueFixtures) {
        if (out.length >= limit) break;
        const fixtureId = fx.fixture?.id;
        const homeName = fx.teams?.home?.name || "Home";
        const awayName = fx.teams?.away?.name || "Away";
        const homeIdStr = fx.teams?.home?.id ? String(fx.teams.home.id) : null;
        const awayIdStr = fx.teams?.away?.id ? String(fx.teams.away.id) : null;
        let refereeName = "";
        try {
          const r = fx.fixture?.referee;
          if (r) {
            if (typeof r === "string") refereeName = r;
            else refereeName = r?.name || r?.full_name || r?.last_name || "";
          }
        } catch {
          refereeName = "";
        }

        let method = "none";
        let lambdaHome;
        let lambdaAway;
        let luckStats = null;
        let strengthMeta = null;
        let formHomeStr = null;
        let formAwayStr = null;

        if (homeIdStr && awayIdStr) {
          const tsH = await getWithCache("/teams/statistics", { league: lId, season, team: homeIdStr }, 86400);
          const tsA = await getWithCache("/teams/statistics", { league: lId, season, team: awayIdStr }, 86400);
          const tsHNorm = tsH.ok && tsH.data ? normalizeTeamStatisticsPayload(tsH.data) : null;
          const tsANorm = tsA.ok && tsA.data ? normalizeTeamStatisticsPayload(tsA.data) : null;
          if (tsHNorm) formHomeStr = coerceFormFromTeamStats(tsHNorm);
          if (tsANorm) formAwayStr = coerceFormFromTeamStats(tsANorm);
          if (tsH.ok && tsA.ok && tsHNorm && tsANorm) {
            const hStats = extractAdvancedGoalsAverages(tsHNorm);
            const aStats = extractAdvancedGoalsAverages(tsANorm);
            if (hStats && aStats) {
              const hMulti = extractFormMultiplier(tsHNorm.response?.form);
              const aMulti = extractFormMultiplier(tsANorm.response?.form);
              const sr = strengthRatingsLambdas(hStats, aStats, hMulti, aMulti, {
                leagueAvgGoals: leagueParams.leagueAvg,
                leagueAvgHome: leagueParams.leagueAvgHome,
                leagueAvgAway: leagueParams.leagueAvgAway,
                homeAdv: leagueParams.homeAdv,
                awayAdv: leagueParams.awayAdv,
                homePlayed: hStats.playedHome || hStats.played,
                awayPlayed: aStats.playedAway || aStats.played,
                shrinkageK: 6
              });
              if (sr && isGoodNum(sr.lambdaHome) && isGoodNum(sr.lambdaAway)) {
                method = "strength-ratings";
                lambdaHome = sr.lambdaHome;
                lambdaAway = sr.lambdaAway;
                strengthMeta = sr.strengthMeta;
                luckStats = {
                  hG: roundDisplayRate(hStats.gfHome),
                  hXG: roundDisplayRate(sr.lambdaHome),
                  aG: roundDisplayRate(aStats.gfAway),
                  aXG: roundDisplayRate(sr.lambdaAway),
                  intensityNote: "expected_rate_from_strength_model"
                };
              }
            }
          }
        }

        if (!isGoodNum(lambdaHome)) {
          const rowH = standingsMap.get(homeIdStr);
          const rowA = standingsMap.get(awayIdStr);
          if (rowH && rowA) {
            method = "standings";
            const phH = Math.max(1, Number(rowH.all?.played) || 1);
            const phA = Math.max(1, Number(rowA.all?.played) || 1);
            const gfH = Number(rowH.all?.goals?.for) / phH;
            const gaH = Number(rowH.all?.goals?.against) / phH;
            const gfA = Number(rowA.all?.goals?.for) / phA;
            const gaA = Number(rowA.all?.goals?.against) / phA;

            // Shrinkage slab către leagueAvg (standings e semnal mai grosier, k mai mic = 4).
            const SK = 4;
            const atkHs = (phH * gfH + SK * leagueParams.leagueAvg) / (phH + SK);
            const defHs = (phH * gaH + SK * leagueParams.leagueAvg) / (phH + SK);
            const atkAs = (phA * gfA + SK * leagueParams.leagueAvg) / (phA + SK);
            const defAs = (phA * gaA + SK * leagueParams.leagueAvg) / (phA + SK);

            lambdaHome = clampLambda((atkHs + defAs) / 2 * leagueParams.homeAdv);
            lambdaAway = clampLambda((atkAs + defHs) / 2 * leagueParams.awayAdv);
          }
        }

        if (!isGoodNum(lambdaHome)) {
          const teamContextEarly = buildTeamContext({
            homeIdStr,
            awayIdStr,
            standingsMap,
            formHome: formHomeStr,
            formAway: formAwayStr
          });
          out.push({
            id: fixtureId,
            leagueId: Number(lId),
            league: fx.league?.name || "Unknown",
            logos: { league: fx.league?.logo, home: fx.teams?.home?.logo, away: fx.teams?.away?.logo },
            teams: { home: homeName, away: awayName },
            fixtureTeamIds:
              homeIdStr && awayIdStr
                ? { home: Number(homeIdStr) || undefined, away: Number(awayIdStr) || undefined }
                : undefined,
            kickoff: fx.fixture?.date,
            status: fx.fixture?.status?.short,
            score: {
              home: typeof fx.goals?.home === "number" ? fx.goals.home : null,
              away: typeof fx.goals?.away === "number" ? fx.goals.away : null
            },
            referee: refereeName || undefined,
            insufficientData: true,
            insufficientReason: "no_team_or_standings_data",
            teamContext: teamContextEarly,
            leagueStandings,
            probs: {
              p1: 0,
              pX: 0,
              p2: 0,
              pGG: 0,
              pO25: 0,
              pU35: 0,
              pO15: 0,
              pDC1X: 0,
              pDC12: 0,
              pDCX2: 0,
              pU15: 0,
              pNGG: 0,
              pU25: 0
            },
            recommended: { pick: "", confidence: 0 },
            predictions: { oneXtwo: "", gg: "", over25: "", correctScore: "" },
            valueBet: { detected: false, type: "", ev: 0, kelly: 0, stakePlan: "", reasons: ["insufficient_data"] },
            modelMeta: {
              method: "insufficient_data",
              dataQuality: 0,
              modelVersion: MODEL_VERSION,
              reasonCodes: ["insufficient_data"]
            },
            modelVersion: MODEL_VERSION,
            evaluation: { track: "none" }
          });
          continue;
        }

        const calc = computeMatchProbs(lambdaHome, lambdaAway, fixtureId, {
          correlation: 0.12,
          rho: leagueParams.rho
        });
        if (!calc || !calc.probs) continue;
        const p = calc.probs;
        // păstrăm probabilităţile raw Poisson (înainte de calibrare / stacker) pentru audit şi fit offline
        const pRaw = { p1: p.p1, pX: p.pX, p2: p.p2 };

        // === ISOTONIC CALIBRATION (per-league) ===
        const leagueCalibMaps = pickCalibrationMapForLeague(calibrationMaps, lId);
        const calTriple = leagueCalibMaps
          ? applyCalibratedTriple(
              { p1: pRaw.p1 / 100, pX: pRaw.pX / 100, p2: pRaw.p2 / 100 },
              leagueCalibMaps
            )
          : { p1: pRaw.p1 / 100, pX: pRaw.pX / 100, p2: pRaw.p2 / 100, calibrationApplied: false };
        const calibrationApplied = Boolean(calTriple.calibrationApplied);

        // === ELO DERIVATIVE (independent probability source) ===
        let eloInfo = null;
        if (homeIdStr && awayIdStr) {
          try {
            const pair = await lookupEloPair(lId, Number(homeIdStr), Number(awayIdStr));
            if (pair) {
              const eloProbs = eloProbabilities(pair.eloHome, pair.eloAway, {
                homeAdvElo: 60 + (leagueParams.homeAdv - 1) * 200
              });
              eloInfo = {
                eloHome: Number(pair.eloHome.toFixed(1)),
                eloAway: Number(pair.eloAway.toFixed(1)),
                eloSpread: Number(((pair.eloHome) - pair.eloAway).toFixed(1)),
                thin: pair.thin,
                probs: eloProbs
              };
            }
          } catch {
            eloInfo = null;
          }
        }

        let odds = null;
        let valueDetected = false;
        let valueType = "";
        let finalEv = 0;
        let finalKelly = 0;
        let stakingCompact = "";
        let stakingBreakdown = undefined;
        let reasonCodes = [];
        const leagueMultiplier = getLeagueConfidenceMultiplier(Number(lId));
        const leagueStakeCap = getLeagueStakeCap(Number(lId));
        const blendW = getModelMarketBlendWeight(method, Number(lId));

        const oddsReq = await getWithCache("/odds", { fixture: fixtureId }, 86400);
        const consensus = oddsReq.ok ? consensusMatchWinnerOdds(oddsReq.data) : null;
        let marketProbs = null;
        if (consensus) {
          // Shin's method în loc de eliminarea proporţională a marjei — corectează long-shot bias.
          const shin = shinImpliedProbs(consensus.home, consensus.draw, consensus.away);
          marketProbs = shin ? { p1: shin.p1, pX: shin.pX, p2: shin.p2 } : null;
          odds = {
            home: consensus.home,
            draw: consensus.draw,
            away: consensus.away,
            bookmaker: `median(${consensus.bookmakersUsed})`,
            bookmakersUsed: consensus.bookmakersUsed,
            marginMethod: shin ? "shin" : "proportional",
            shinZ: shin && Number.isFinite(shin.z) ? Number(shin.z.toFixed(4)) : undefined
          };
          const blended = blendModelWithMarket({
            model: { p1: p.p1 / 100, pX: p.pX / 100, p2: p.p2 / 100 },
            market: marketProbs,
            modelWeight: blendW
          });

          const candidates = [
            { type: "1", prob: blended?.p1 ?? p.p1 / 100, odd: consensus.home, confidence: p.p1, marketProb: marketProbs?.p1 ?? null },
            { type: "X", prob: blended?.pX ?? p.pX / 100, odd: consensus.draw, confidence: p.pX, marketProb: marketProbs?.pX ?? null },
            { type: "2", prob: blended?.p2 ?? p.p2 / 100, odd: consensus.away, confidence: p.p2, marketProb: marketProbs?.p2 ?? null }
          ].filter((c) => isGoodNum(c.odd) && c.odd >= 1.3);

          const dqEarly = dataQualityScore({
            method,
            hasOdds: !!odds,
            hasLuckStats: !!luckStats,
            hasTeamIds: !!homeIdStr && !!awayIdStr
          });

          const scored = candidates
            .map((c) => {
              const ev = calculateEV(c.prob, c.odd);
              const rawEdge = c.prob * c.odd;
              const marketGapPct = c.marketProb === null ? 0 : Math.abs(c.prob - c.marketProb) * 100;
              const volatility = 1 - Math.abs(c.confidence - 50) / 50;
              const ensembleStake = calculateEnsembleStake({
                probability: c.prob,
                odds: c.odd,
                confidencePct: c.confidence,
                marketVolatility: volatility,
                marketGapPct,
                dataQuality: dqEarly
              });
              const kelly = calculateKelly(c.prob, c.odd, c.confidence >= 65);
              const noBet = evaluateNoBetZone({
                edge: rawEdge,
                evPct: ev,
                confidencePct: c.confidence,
                marketGapPct
              });
              const score = (rawEdge - 1) * 120 + ev * 0.35 + ensembleStake.stakePct * 2;
              return { ...c, ev, rawEdge, score, ensembleStake, kelly, noBet, marketGapPct };
            })
            .filter((c) => c.noBet.allowBet)
            .sort((a, b) => b.score - a.score);

          const dq = dqEarly;

          if (scored.length > 0) {
            const best = scored[0];
            valueDetected = true;
            valueType = best.type;
            finalEv = best.ev;
            finalKelly = best.ensembleStake.stakePct || best.kelly;
            stakingCompact = `S:${finalKelly.toFixed(2)}% • E:${finalEv.toFixed(1)}%`;
            stakingBreakdown = best.ensembleStake.components;
            reasonCodes = [`selected_${best.type}`, "market_calibrated", "ensemble_staking"];

            if (dq < 0.55) {
              valueDetected = false;
              valueType = "";
              finalEv = 0;
              finalKelly = 0;
              stakingCompact = "";
              stakingBreakdown = undefined;
              reasonCodes.push("min_sample_guardrail");
            }
          } else {
            const analyzed = candidates
              .map((c) => {
                const ev = calculateEV(c.prob, c.odd);
                const rawEdge = c.prob * c.odd;
                const marketGapPct = c.marketProb === null ? 0 : Math.abs(c.prob - c.marketProb) * 100;
                return evaluateNoBetZone({
                  edge: rawEdge,
                  evPct: ev,
                  confidencePct: c.confidence,
                  marketGapPct
                }).reasons;
              })
              .flat();
            reasonCodes = Array.from(new Set(analyzed)).slice(0, 4);
          }
        }

        // === STACKER (ML) or calibrated+market blend ===
        // Construim features şi aplicăm stacker dacă avem greutăţi active pentru liga aceasta.
        const stackerEntry = pickStackerWeightsForLeague(stackerWeightsMap, lId);
        const dataQualityEarly = dataQualityScore({
          method,
          hasOdds: !!odds,
          hasLuckStats: !!luckStats,
          hasTeamIds: !!homeIdStr && !!awayIdStr
        });
        let pFinal = null;
        let stackerApplied = false;
        if (stackerEntry?.weights) {
          const feats = extractStackerFeatures({
            poissonProbs: { p1: pRaw.p1 / 100, pX: pRaw.pX / 100, p2: pRaw.p2 / 100 },
            marketProbs,
            eloSpread: eloInfo?.eloSpread || 0,
            dataQuality: dataQualityEarly,
            homeAdv: leagueParams.homeAdv,
            rho: leagueParams.rho
          });
          const stacked = applyStacker(feats, stackerEntry.weights);
          if (stacked) {
            pFinal = stacked;
            stackerApplied = true;
          }
        }
        if (!pFinal) {
          // Fallback: model calibrat + blend liniar cu piaţa + drift penalty.
          const modelFrac = { p1: calTriple.p1, pX: calTriple.pX, p2: calTriple.p2 };
          const blended = marketProbs
            ? blendModelWithMarket({ model: modelFrac, market: marketProbs, modelWeight: blendW })
            : modelFrac;
          pFinal = blended || modelFrac;
        }

        let p1Adj = blendByPenalty(pFinal.p1 * 100, leagueMultiplier);
        let pXAdj = blendByPenalty(pFinal.pX * 100, leagueMultiplier);
        let p2Adj = blendByPenalty(pFinal.p2 * 100, leagueMultiplier);
        const sumAdj = p1Adj + pXAdj + p2Adj;
        if (sumAdj > 0) {
          p1Adj = (p1Adj / sumAdj) * 100;
          pXAdj = (pXAdj / sumAdj) * 100;
          p2Adj = (p2Adj / sumAdj) * 100;
        }

        const driftPenalty = riskContext.avgDist
          ? Math.abs(p1Adj - riskContext.avgDist.p1) +
            Math.abs(pXAdj - riskContext.avgDist.pX) +
            Math.abs(p2Adj - riskContext.avgDist.p2)
          : 0;
        if (driftPenalty > 24) {
          finalKelly = Math.min(finalKelly, 1.5);
          reasonCodes.push("drift_penalty");
        }

        const dataQuality = dataQualityScore({
          method,
          hasOdds: !!odds,
          hasLuckStats: !!luckStats,
          hasTeamIds: !!homeIdStr && !!awayIdStr
        });
        const qualityPenalty = dataQuality < 0.6 ? 0.9 : 1;

        const finalPick1X2 = p1Adj >= pXAdj && p1Adj >= p2Adj ? "1" : p2Adj > p1Adj && p2Adj > pXAdj ? "2" : "X";
        let topPick = finalPick1X2;
        let maxConf = Math.max(p1Adj, pXAdj, p2Adj);
        if (p.pU35 > maxConf) {
          topPick = "Sub 3.5";
          maxConf = p.pU35;
        }
        if (p.pO25 > maxConf) {
          topPick = "Peste 2.5";
          maxConf = p.pO25;
        }
        if (p.pGG > maxConf) {
          topPick = "GG";
          maxConf = p.pGG;
        }
        maxConf = clampPct(maxConf * leagueMultiplier * qualityPenalty);
        const stakePolicy = applyStakePolicyV2({
          stakePct: finalKelly,
          confidencePct: maxConf,
          dataQuality,
          leagueStakeCap,
          cooldownCap: riskContext.cooldownCap
        });
        finalKelly = stakePolicy.stakePct;
        if (valueDetected) {
          stakingCompact = `S:${finalKelly.toFixed(2)}% • E:${finalEv.toFixed(1)}%`;
        }
        reasonCodes.push(`stake_bucket_${stakePolicy.bucket}`);

        if (dataQuality < 0.55) reasonCodes.push("low_data_quality");
        if (leagueMultiplier < 0.93) reasonCodes.push("league_multiplier_penalty");
        if (finalKelly >= stakePolicy.dynamicCap && valueDetected) reasonCodes.push("stake_capped");
        reasonCodes = Array.from(new Set(reasonCodes)).slice(0, 8);

        const pOut = extendProbsWithMarkets({
          ...p,
          p1: clampPct(p1Adj),
          pX: clampPct(pXAdj),
          p2: clampPct(p2Adj)
        });
        const teamContext = buildTeamContext({
          homeIdStr,
          awayIdStr,
          standingsMap,
          formHome: formHomeStr,
          formAway: formAwayStr
        });

        const topFeatures = [
          `method:${method}`,
          `dq:${dataQuality.toFixed(2)}`,
          stackerApplied ? "stacker:on" : calibrationApplied ? "cal:on" : `blend:${blendW.toFixed(2)}`,
          `leagueMul:${leagueMultiplier.toFixed(2)}`,
          `stakeCap:${stakePolicy.dynamicCap.toFixed(2)}`,
          `bucket:${stakePolicy.bucket}`,
          strengthMeta ? `atkDef:${strengthMeta.atkH?.toFixed(2)}` : "standings",
          eloInfo ? `elo:${eloInfo.eloSpread.toFixed(0)}` : "elo:none"
        ];

        const evaluation = {
          recommendedTrack: stackerApplied
            ? "ml_stacker_1x2"
            : calibrationApplied
              ? "calibrated_1x2_and_side_markets"
              : "model_1x2_and_side_markets",
          valueBetTrack: valueDetected
            ? stackerApplied
              ? "stacker_1x2_vs_median_odds"
              : "blended_1x2_vs_median_odds"
            : "none",
          modelProbs1x2Pct: { p1: p1Adj, pX: pXAdj, p2: p2Adj },
          rawPoissonProbs1x2Pct: { p1: pRaw.p1, pX: pRaw.pX, p2: pRaw.p2 },
          calibratedProbs1x2Pct: calibrationApplied
            ? { p1: calTriple.p1 * 100, pX: calTriple.pX * 100, p2: calTriple.p2 * 100 }
            : undefined,
          stackerProbs1x2Pct: stackerApplied
            ? { p1: pFinal.p1 * 100, pX: pFinal.pX * 100, p2: pFinal.p2 * 100 }
            : undefined,
          recommended1x2: finalPick1X2,
          modelVersion: MODEL_VERSION,
          marketBlendWeight: blendW,
          stackerApplied,
          calibrationApplied
        };

        out.push({
          id: fixtureId,
          leagueId: Number(lId),
          league: fx.league?.name || "Unknown",
          logos: { league: fx.league?.logo, home: fx.teams?.home?.logo, away: fx.teams?.away?.logo },
          teams: { home: homeName, away: awayName },
          fixtureTeamIds:
            homeIdStr && awayIdStr
              ? { home: Number(homeIdStr) || undefined, away: Number(awayIdStr) || undefined }
              : undefined,
          kickoff: fx.fixture?.date,
          status: fx.fixture?.status?.short,
          score: {
            home: typeof fx.goals?.home === "number" ? fx.goals.home : null,
            away: typeof fx.goals?.away === "number" ? fx.goals.away : null
          },
          referee: refereeName || undefined,
          lambdas: { home: roundDisplayRate(lambdaHome), away: roundDisplayRate(lambdaAway) },
          teamContext,
          leagueStandings,
          probs: pOut,
          odds,
          luckStats,
          valueBet: {
            detected: valueDetected,
            type: valueType,
            ev: finalEv,
            kelly: finalKelly,
            stakePlan: stakingCompact,
            ensemble: stakingBreakdown,
            reasons: reasonCodes
          },
          predictions: {
            oneXtwo: finalPick1X2,
            // prag corect 50 pentru pieţe binare (anterior 55 era greşit:
            // pGG=52% afişa "NGG" deşi GG era mai probabil)
            gg: p.pGG >= 50 ? "GG" : "NGG",
            over25: p.pO25 >= 50 ? "Peste 2.5" : "Sub 2.5",
            correctScore: calc.bestScore,
            marketTiers: {
              oneXtwo: {
                pick: finalPick1X2,
                prob: Number(
                  finalPick1X2 === "1" ? p1Adj : finalPick1X2 === "2" ? p2Adj : pXAdj
                ).toFixed(1) * 1,
                tier: marketTier(
                  finalPick1X2 === "1" ? p1Adj : finalPick1X2 === "2" ? p2Adj : pXAdj
                )
              },
              gg: {
                pick: p.pGG >= 50 ? "GG" : "NGG",
                prob: Number(p.pGG >= 50 ? p.pGG : 100 - p.pGG).toFixed(1) * 1,
                tier: marketTier(Math.max(p.pGG, 100 - p.pGG))
              },
              over25: {
                pick: p.pO25 >= 50 ? "Peste 2.5" : "Sub 2.5",
                prob: Number(p.pO25 >= 50 ? p.pO25 : 100 - p.pO25).toFixed(1) * 1,
                tier: marketTier(Math.max(p.pO25, 100 - p.pO25))
              },
              correctScore: {
                pick: calc.bestScore,
                prob: Number(calc.bestScoreProb || 0).toFixed(1) * 1,
                tier: marketTier(Math.min(95, (calc.bestScoreProb || 0) * 3))
              }
            }
          },
          recommended: { pick: topPick, confidence: maxConf },
          modelMeta: {
            method,
            probsModel: calc?.modelMeta?.method || "unknown",
            dataQuality: Number(dataQuality.toFixed(3)),
            leagueMultiplier: Number(leagueMultiplier.toFixed(3)),
            driftPenalty: Number(driftPenalty.toFixed(3)),
            cooldownCap: Number(riskContext.cooldownCap.toFixed(2)),
            stakeBucket: stakePolicy.bucket,
            stakeCap: stakePolicy.dynamicCap,
            reasonCodes,
            modelVersion: MODEL_VERSION,
            gridMax: calc?.modelMeta?.gridMax,
            massCaptured: calc?.modelMeta?.massCaptured,
            leagueParams: {
              leagueAvg: leagueParams.leagueAvg,
              homeAdv: leagueParams.homeAdv,
              awayAdv: leagueParams.awayAdv,
              rho: leagueParams.rho,
              blendWeight: Number(blendW.toFixed(3))
            },
            strengthMeta: strengthMeta || undefined,
            calibrationApplied,
            stackerApplied,
            stackerSampleSize: stackerEntry?.sampleSize || null,
            calibrationSampleSize: leagueCalibMaps
              ? Math.max(
                  leagueCalibMaps["1"]?.sampleSize || 0,
                  leagueCalibMaps["X"]?.sampleSize || 0,
                  leagueCalibMaps["2"]?.sampleSize || 0
                )
              : null,
            elo: eloInfo
              ? {
                  home: eloInfo.eloHome,
                  away: eloInfo.eloAway,
                  spread: eloInfo.eloSpread,
                  thin: eloInfo.thin
                }
              : undefined,
            eloSpread: eloInfo?.eloSpread ?? undefined
          },
          auditLog: {
            reasonCodes,
            topFeatures
          },
          modelVersion: MODEL_VERSION,
          evaluation
        });
      }
    }

    const persistable = out.filter((row) => !row.insufficientData);

    /**
     * Invariant: increment RPC (atomic, predict_count < max) rulează ÎNAINTE de orice scriere în
     * predictions_history / user_prediction_fixtures. La eșec persist, rollback_predict_increment.
     */
    let quotaIncrementCommitted = false;
    if (enforceWarmPredictQuota && usageCtx.userId && persistable.length > 0) {
      const inc = await commitWarmPredictIncrement(usageCtx.userId, usageCtx.usageDay, "predict");
      if (!inc || inc.ok !== true) {
        return res.status(429).json({
          ok: false,
          error: "Limita zilnica Predict atinsa (maximum 3/zi).",
          usage: inc
        });
      }
      quotaIncrementCommitted = true;
      res.setHeader("X-Usage-Warm", String(inc.warm_count ?? ""));
      res.setHeader("X-Usage-Predict", String(inc.predict_count ?? ""));
      res.setHeader("X-Usage-Day", String(usageCtx.usageDay ?? ""));
    }

    const supabaseConfig = assertSupabaseConfigured();
    if (!supabaseConfig.ok) {
      if (quotaIncrementCommitted && usageCtx.userId) {
        await rollbackPredictIncrement(usageCtx.userId, usageCtx.usageDay);
      }
      return res.status(200).json(out);
    }

    if (persistable.length > 0) {
      try {
        await upsertPredictionsHistory(persistable);
        if (usageCtx.userId) {
          const supabase = getSupabaseAdmin();
          const linkRows = persistable
            .map((p) => ({ user_id: usageCtx.userId, fixture_id: Number(p.id) }))
            .filter((r) => Number.isFinite(r.fixture_id));
          if (linkRows.length) {
            const { error: linkErr } = await supabase.from("user_prediction_fixtures").upsert(linkRows, {
              onConflict: "user_id,fixture_id",
              ignoreDuplicates: true
            });
            if (linkErr) throw linkErr;
          }
        }
      } catch (persistError) {
        console.error("[predict persist]", persistError?.message || persistError);
        if (quotaIncrementCommitted && usageCtx.userId) {
          await rollbackPredictIncrement(usageCtx.userId, usageCtx.usageDay);
        }
        return res.status(500).json({
          ok: false,
          error: persistError?.message || "Nu am putut salva predictiile."
        });
      }
    }

    return res.status(200).json(out);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
