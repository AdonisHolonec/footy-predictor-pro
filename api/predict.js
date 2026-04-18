// api/predict.js
import { readBearer } from "../server-utils/authAdmin.js";
import { checkAnonymousRateLimit } from "../server-utils/anonymousRateLimit.js";
import { getWithCache } from '../server-utils/fetcher.js';
import { 
  extractGoalsAverages, 
  lambdasFromTeamStats, 
  syntheticLambdas, 
  computeMatchProbs, 
  clampLambda,
  extractFormMultiplier,
  extractAdvancedGoalsAverages,
  advancedLambdas
} from '../server-utils/math.js';
import { 
  calculateEV, 
  calculateKellyQuarter as calculateKelly,
  calculateEnsembleStake,
  adjustLambdaByEfficiency,
  calculateDynamicXG,
  removeBookmakerMargin,
  blendModelWithMarket,
  evaluateNoBetZone
} from '../server-utils/advancedMath.js';
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { upsertPredictionsHistory } from "../server-utils/predictionsHistory.js";
import {
  commitWarmPredictIncrement,
  isWarmPredictQuotaExempt,
  peekWarmPredictUsage,
  resolveAuthenticatedUsageContext
} from "../server-utils/userDailyWarmPredictUsage.js";

function isGoodNum(val) {
  return typeof val === 'number' && !isNaN(val) && val > 0;
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

function dataQualityScore({ method, hasOdds, hasLuckStats, hasTeamIds }) {
  let score = 0.35;
  if (hasTeamIds) score += 0.15;
  if (hasOdds) score += 0.2;
  if (hasLuckStats) score += 0.2;
  if (method === "advanced-teamstats") score += 0.1;
  if (method === "synthetic") score -= 0.18;
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

function applyStakePolicyV2({
  stakePct,
  confidencePct,
  dataQuality,
  leagueStakeCap,
  cooldownCap
}) {
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
    if (row.validation === "win") pnl += stake * (odd - 1);
    else if (row.validation === "loss") pnl -= stake;
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
      .select("raw_payload, validation, odds_home, odds_draw, odds_away")
      .gte("kickoff_at", cutoff)
      .limit(400);

    const rows = data || [];
    const withProbs = rows
      .map((r) => r.raw_payload?.probs)
      .filter((p) => p && isFinite(p.p1) && isFinite(p.pX) && isFinite(p.p2));

    if (withProbs.length > 0) {
      const mean = withProbs.reduce((acc, p) => {
        acc.p1 += Number(p.p1);
        acc.pX += Number(p.pX);
        acc.p2 += Number(p.p2);
        return acc;
      }, { p1: 0, pX: 0, p2: 0 });
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
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const leagueIdsStr = req.query.leagueIds || "";
  const leagueIds = leagueIdsStr.split(',').filter(Boolean).map(s => s.trim());
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
    const dayReq = await getWithCache('/fixtures', { date }, 21600);
    const allFixtures = dayReq.data?.response || dayReq.data || [];

    for (const lId of leagueIds) {
      if (out.length >= limit) break;
      const leagueFixtures = allFixtures.filter(f => String(f.league?.id) === String(lId));
      if (leagueFixtures.length === 0) continue;

      const standingsReq = await getWithCache('/standings', { league: lId, season }, 86400);
      const standingsRows = standingsReq.ok ? (standingsReq.data?.response?.[0]?.league?.standings?.[0] || []) : [];
      const standingsMap = new Map();
      standingsRows.forEach(r => { if (r?.team?.id) standingsMap.set(String(r.team.id), r); });

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
        let lambdaHome, lambdaAway;
        let luckStats = null; // Pentru UI

        if (homeIdStr && awayIdStr) {
          const tsH = await getWithCache('/teams/statistics', { league: lId, season, team: homeIdStr }, 86400);
          const tsA = await getWithCache('/teams/statistics', { league: lId, season, team: awayIdStr }, 86400);
          if (tsH.ok && tsA.ok && tsH.data && tsA.data) {
            const hStats = extractAdvancedGoalsAverages(tsH.data);
            const aStats = extractAdvancedGoalsAverages(tsA.data);
            if (hStats && aStats) {
              const hMulti = extractFormMultiplier(tsH.data?.response?.form);
              const aMulti = extractFormMultiplier(tsA.data?.response?.form);
              
              // λ-urile se bazează pe gf/ga extrase din statistics (nu pe avgXG/avgGoalsScored).
              const l = advancedLambdas(hStats, aStats, hMulti, aMulti);
              
              if (l && isGoodNum(l.lambdaHome) && isGoodNum(l.lambdaAway)) {
                const dynamicXgHome = calculateDynamicXG({
                  teamAttack: hStats.gfHome,
                  opponentDefense: aStats.gaAway,
                  formMultiplier: hMulti,
                  venueBoost: 1.06
                });
                const dynamicXgAway = calculateDynamicXG({
                  teamAttack: aStats.gfAway,
                  opponentDefense: hStats.gaHome,
                  formMultiplier: aMulti,
                  venueBoost: 0.96
                });

                method = "advanced-teamstats";
                lambdaHome = adjustLambdaByEfficiency(l.lambdaHome, dynamicXgHome, 0.55);
                lambdaAway = adjustLambdaByEfficiency(l.lambdaAway, dynamicXgAway, 0.55);
                // NEW Luck Factor: combinăm mediile istorice cu xG dinamic pentru robustete.
                luckStats = { hG: hStats.gfHome, hXG: dynamicXgHome, aG: aStats.gfAway, aXG: dynamicXgAway };
              }
            }
          }
        }

        if (!isGoodNum(lambdaHome)) {
          const rowH = standingsMap.get(homeIdStr);
          const rowA = standingsMap.get(awayIdStr);
          if (rowH && rowA) {
            method = "standings";
            lambdaHome = clampLambda(((rowH.all?.goals?.for / (rowH.all?.played || 1)) + (rowA.all?.goals?.against / (rowA.all?.played || 1))) / 2);
            lambdaAway = clampLambda(((rowA.all?.goals?.for / (rowA.all?.played || 1)) + (rowH.all?.goals?.against / (rowH.all?.played || 1))) / 2);
          }
        }

        if (!isGoodNum(lambdaHome)) {
          const s = syntheticLambdas(Number(homeIdStr), Number(awayIdStr));
          method = "synthetic"; lambdaHome = s.lambdaHome; lambdaAway = s.lambdaAway;
        }

        const calc = computeMatchProbs(lambdaHome, lambdaAway, fixtureId, { correlation: 0.12, samples: 2400 });
        if (!calc || !calc.probs) continue;
        const p = calc.probs;

        let odds = null, valueDetected = false, valueType = "", finalEv = 0, finalKelly = 0;
        let stakingCompact = "";
        let stakingBreakdown = undefined;
        let reasonCodes = [];
        const leagueMultiplier = getLeagueConfidenceMultiplier(Number(lId));
        const leagueStakeCap = getLeagueStakeCap(Number(lId));
        const oddsReq = await getWithCache('/odds', { fixture: fixtureId }, 86400);
        if (oddsReq.ok && oddsReq.data?.response?.[0]?.bookmakers?.[0]) {
          const bookie = oddsReq.data.response[0].bookmakers[0];
          const market1X2 = bookie.bets.find(b => b.name === "Match Winner");
          if (market1X2) {
            const hOdd = parseFloat(market1X2.values.find(v => v.value === "Home")?.odd);
            const dOdd = parseFloat(market1X2.values.find(v => v.value === "Draw")?.odd);
            const aOdd = parseFloat(market1X2.values.find(v => v.value === "Away")?.odd);
            odds = { home: hOdd, draw: dOdd, away: aOdd, bookmaker: bookie?.name || undefined };
            const marketProbs = removeBookmakerMargin(hOdd, dOdd, aOdd);
            const blended = blendModelWithMarket({
              model: { p1: p.p1 / 100, pX: p.pX / 100, p2: p.p2 / 100 },
              market: marketProbs,
              modelWeight: method === "advanced-teamstats" ? 0.76 : 0.63
            });

            const candidates = [
              { type: "1", prob: blended?.p1 ?? (p.p1 / 100), odd: hOdd, confidence: p.p1, marketProb: marketProbs?.p1 ?? null },
              { type: "X", prob: blended?.pX ?? (p.pX / 100), odd: dOdd, confidence: p.pX, marketProb: marketProbs?.pX ?? null },
              { type: "2", prob: blended?.p2 ?? (p.p2 / 100), odd: aOdd, confidence: p.p2, marketProb: marketProbs?.p2 ?? null }
            ].filter((c) => isGoodNum(c.odd) && c.odd >= 1.3);

            const scored = candidates
              .map((c) => {
                const ev = calculateEV(c.prob, c.odd);
                const rawEdge = (c.prob * c.odd);
                const marketGapPct = c.marketProb === null ? 0 : Math.abs(c.prob - c.marketProb) * 100;
                const volatility = 1 - Math.abs(c.confidence - 50) / 50;
                const ensembleStake = calculateEnsembleStake({
                  probability: c.prob,
                  odds: c.odd,
                  confidencePct: c.confidence,
                  marketVolatility: volatility
                });
                const kelly = calculateKelly(c.prob, c.odd, c.confidence >= 65);
                const noBet = evaluateNoBetZone({
                  edge: rawEdge,
                  evPct: ev,
                  confidencePct: c.confidence,
                  marketGapPct
                });
                const score = (rawEdge - 1) * 120 + (ev * 0.35) + (ensembleStake.stakePct * 2);
                return { ...c, ev, rawEdge, score, ensembleStake, kelly, noBet, marketGapPct };
              })
              .filter((c) => c.noBet.allowBet)
              .sort((a, b) => b.score - a.score);

            const dq = dataQualityScore({
              method,
              hasOdds: !!odds,
              hasLuckStats: !!luckStats,
              hasTeamIds: !!homeIdStr && !!awayIdStr
            });

            if (scored.length > 0) {
              const best = scored[0];
              valueDetected = true;
              valueType = best.type;
              finalEv = best.ev;
              finalKelly = best.ensembleStake.stakePct || best.kelly;
              stakingCompact = `S:${finalKelly.toFixed(2)}% • E:${finalEv.toFixed(1)}%`;
              stakingBreakdown = best.ensembleStake.components;
              reasonCodes = [`selected_${best.type}`, "market_calibrated", "ensemble_staking"];

              if (method === "synthetic" || dq < 0.55) {
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
        }
        
        let p1Adj = blendByPenalty(p.p1, leagueMultiplier);
        let pXAdj = blendByPenalty(p.pX, leagueMultiplier);
        let p2Adj = blendByPenalty(p.p2, leagueMultiplier);
        const sumAdj = p1Adj + pXAdj + p2Adj;
        if (sumAdj > 0) {
          p1Adj = (p1Adj / sumAdj) * 100;
          pXAdj = (pXAdj / sumAdj) * 100;
          p2Adj = (p2Adj / sumAdj) * 100;
        }

        const driftPenalty = riskContext.avgDist
          ? Math.abs(p1Adj - riskContext.avgDist.p1) + Math.abs(pXAdj - riskContext.avgDist.pX) + Math.abs(p2Adj - riskContext.avgDist.p2)
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

        let finalPick1X2 = p1Adj >= pXAdj && p1Adj >= p2Adj ? "1" : (p2Adj > p1Adj && p2Adj > pXAdj ? "2" : "X");
        let topPick = finalPick1X2;
        let maxConf = Math.max(p1Adj, pXAdj, p2Adj);
        if (p.pU35 > maxConf) { topPick = "Sub 3.5"; maxConf = p.pU35; }
        if (p.pO25 > maxConf) { topPick = "Peste 2.5"; maxConf = p.pO25; }
        if (p.pGG > maxConf) { topPick = "GG"; maxConf = p.pGG; }
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
        reasonCodes = Array.from(new Set(reasonCodes)).slice(0, 6);

        const pOut = {
          ...p,
          p1: clampPct(p1Adj),
          pX: clampPct(pXAdj),
          p2: clampPct(p2Adj)
        };

        const topFeatures = [
          `method:${method}`,
          `dq:${dataQuality.toFixed(2)}`,
          `leagueMul:${leagueMultiplier.toFixed(2)}`,
          `stakeCap:${stakePolicy.dynamicCap.toFixed(2)}`,
          `bucket:${stakePolicy.bucket}`
        ];

        out.push({
          id: fixtureId,
          leagueId: Number(lId),
          league: fx.league?.name || "Unknown",
          logos: { league: fx.league?.logo, home: fx.teams?.home?.logo, away: fx.teams?.away?.logo },
          teams: { home: homeName, away: awayName },
          kickoff: fx.fixture?.date,
          status: fx.fixture?.status?.short,
          score: {
            home: typeof fx.goals?.home === "number" ? fx.goals.home : null,
            away: typeof fx.goals?.away === "number" ? fx.goals.away : null
          },
          referee: refereeName || undefined,
          probs: pOut, odds, luckStats,
          valueBet: {
            detected: valueDetected,
            type: valueType,
            ev: finalEv,
            kelly: finalKelly,
            stakePlan: stakingCompact,
            ensemble: stakingBreakdown,
            reasons: reasonCodes
          },
          predictions: { oneXtwo: finalPick1X2, gg: p.pGG >= 55 ? "GG" : "NGG", over25: p.pO25 >= 55 ? "Peste 2.5" : "Sub 2.5", correctScore: calc.bestScore },
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
            reasonCodes
          },
          auditLog: {
            reasonCodes,
            topFeatures
          }
        });
      }
    }
    const supabaseConfig = assertSupabaseConfigured();
    if (supabaseConfig.ok) {
      try {
        await upsertPredictionsHistory(out);
      } catch (persistError) {
        console.error("[history upsert] failed:", persistError?.message || persistError);
      }
      if (usageCtx.userId && out.length > 0) {
        try {
          const supabase = getSupabaseAdmin();
          const linkRows = out
            .map((p) => ({ user_id: usageCtx.userId, fixture_id: Number(p.id) }))
            .filter((r) => Number.isFinite(r.fixture_id));
          if (linkRows.length) {
            const { error: linkErr } = await supabase.from("user_prediction_fixtures").upsert(linkRows, {
              onConflict: "user_id,fixture_id",
              ignoreDuplicates: true
            });
            if (linkErr) console.error("[user_prediction_fixtures]", linkErr.message || linkErr);
          }
        } catch (linkEx) {
          console.error("[user_prediction_fixtures]", linkEx?.message || linkEx);
        }
      }
    }

    if (enforceWarmPredictQuota) {
      const inc = await commitWarmPredictIncrement(usageCtx.userId, usageCtx.usageDay, "predict");
      if (!inc?.ok) {
        return res.status(429).json({
          ok: false,
          error: "Limita zilnica Predict atinsa (maximum 3/zi).",
          usage: inc
        });
      }
      res.setHeader("X-Usage-Warm", String(inc.warm_count ?? ""));
      res.setHeader("X-Usage-Predict", String(inc.predict_count ?? ""));
      res.setHeader("X-Usage-Day", String(usageCtx.usageDay ?? ""));
    }

    return res.status(200).json(out);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}