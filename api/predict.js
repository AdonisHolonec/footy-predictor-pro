// api/predict.js
import { getWithCache } from './_utils/fetcher.js';
import { 
  extractGoalsAverages, 
  lambdasFromTeamStats, 
  syntheticLambdas, 
  computeMatchProbs, 
  clampLambda,
  extractFormMultiplier,
  extractAdvancedGoalsAverages,
  advancedLambdas
} from './_utils/math.js';
import { 
  calculateEV, 
  calculateKellyQuarter as calculateKelly,
  calculateEnsembleStake,
  adjustLambdaByEfficiency,
  calculateDynamicXG,
  removeBookmakerMargin,
  blendModelWithMarket,
  evaluateNoBetZone
} from './_utils/advancedMath.js';
import { assertSupabaseConfigured } from "./_utils/supabaseAdmin.js";
import { upsertPredictionsHistory } from "./_utils/predictionsHistory.js";

function isGoodNum(val) {
  return typeof val === 'number' && !isNaN(val) && val > 0;
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

  try {
    const out = [];
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

            if (scored.length > 0) {
              const best = scored[0];
              valueDetected = true;
              valueType = best.type;
              finalEv = best.ev;
              finalKelly = best.ensembleStake.stakePct || best.kelly;
              stakingCompact = `S:${finalKelly.toFixed(2)}% • E:${finalEv.toFixed(1)}%`;
              stakingBreakdown = best.ensembleStake.components;
              reasonCodes = [`selected_${best.type}`, "market_calibrated", "ensemble_staking"];
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
        
        let finalPick1X2 = p.p1 >= p.pX && p.p1 >= p.p2 ? "1" : (p.p2 > p.p1 && p.p2 > p.pX ? "2" : "X");
        let topPick = finalPick1X2;
        let maxConf = Math.max(p.p1, p.pX, p.p2);
        if (p.pU35 > maxConf) { topPick = "Sub 3.5"; maxConf = p.pU35; }
        if (p.pO25 > maxConf) { topPick = "Peste 2.5"; maxConf = p.pO25; }
        if (p.pGG > maxConf) { topPick = "GG"; maxConf = p.pGG; }

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
          probs: p, odds, luckStats,
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
            probsModel: calc?.modelMeta?.method || "unknown"
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
    }

    return res.status(200).json(out);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}