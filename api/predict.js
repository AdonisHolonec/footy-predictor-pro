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
import { calculateEV, calculateKellyQuarter as calculateKelly } from './_utils/advancedMath.js';

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

        let method = "none";
        let lambdaHome, lambdaAway;

        if (homeIdStr && awayIdStr) {
          const tsH = await getWithCache('/teams/statistics', { league: lId, season, team: homeIdStr }, 86400);
          const tsA = await getWithCache('/teams/statistics', { league: lId, season, team: awayIdStr }, 86400);
          if (tsH.ok && tsA.ok && tsH.data && tsA.data) {
            const hStats = extractAdvancedGoalsAverages(tsH.data);
            const aStats = extractAdvancedGoalsAverages(tsA.data);
            if (hStats && aStats) {
              const hMulti = extractFormMultiplier(tsH.data?.response?.form);
              const aMulti = extractFormMultiplier(tsA.data?.response?.form);
              const l = advancedLambdas(hStats, aStats, hMulti, aMulti);
              if (l && isGoodNum(l.lambdaHome) && isGoodNum(l.lambdaAway)) {
                method = "advanced-teamstats";
                lambdaHome = l.lambdaHome;
                lambdaAway = l.lambdaAway;
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
          method = "synthetic";
          lambdaHome = s.lambdaHome;
          lambdaAway = s.lambdaAway;
        }

        const calc = computeMatchProbs(lambdaHome, lambdaAway, fixtureId);
        if (!calc || !calc.probs) continue;

        const p = calc.probs;

        // VALUE BETS & ADVANCED MATH
        let odds = null;
        let valueDetected = false;
        let valueType = "";
        let finalEv = 0;
        let finalKelly = 0;

        const oddsReq = await getWithCache('/odds', { fixture: fixtureId }, 86400);
        if (oddsReq.ok && oddsReq.data?.response?.[0]?.bookmakers?.[0]) {
          const bookie = oddsReq.data.response[0].bookmakers[0];
          const market1X2 = bookie.bets.find(b => b.name === "Match Winner");
          if (market1X2) {
            const hOdd = parseFloat(market1X2.values.find(v => v.value === "Home")?.odd);
            const dOdd = parseFloat(market1X2.values.find(v => v.value === "Draw")?.odd);
            const aOdd = parseFloat(market1X2.values.find(v => v.value === "Away")?.odd);
            odds = { home: hOdd, draw: dOdd, away: aOdd };

            // Verificăm cota pentru Gazde (1)
            if ((p.p1 * hOdd) / 100 > 1.15) { 
              valueDetected = true; 
              valueType = "1"; 
              finalEv = calculateEV(p.p1, hOdd);
              finalKelly = calculateKelly(p.p1, hOdd);
            }
            // Verificăm cota pentru Egal (X)
            else if ((p.pX * dOdd) / 100 > 1.15) { 
              valueDetected = true; 
              valueType = "X"; 
              finalEv = calculateEV(p.pX, dOdd);
              finalKelly = calculateKelly(p.pX, dOdd);
            }
            // Verificăm cota pentru Oaspeți (2)
            else if ((p.p2 * aOdd) / 100 > 1.15) { 
              valueDetected = true; 
              valueType = "2"; 
              finalEv = calculateEV(p.p2, aOdd);
              finalKelly = calculateKelly(p.p2, aOdd);
            }
          }
        }
        // Logică 1X2 (Păstrată pentru stabilirea corectă a scorului)
        let finalPick1X2 = "X";
        if (p.p1 >= p.pX && p.p1 >= p.p2) finalPick1X2 = "1";
        else if (p.p2 > p.p1 && p.p2 > p.pX) finalPick1X2 = "2";

        // SUPER PICK: Găsim cea mai sigură predicție dintre toate!
        let topPick = finalPick1X2;
        let maxConf = Math.max(p.p1, p.pX, p.p2);

        if (p.pU35 > maxConf) { topPick = "Sub 3.5"; maxConf = p.pU35; }
        if (p.pO25 > maxConf) { topPick = "Peste 2.5"; maxConf = p.pO25; }
        if (p.pGG > maxConf) { topPick = "GG"; maxConf = p.pGG; }
        if (p.pO15 > maxConf && p.pO15 < 90) { topPick = "Peste 1.5"; maxConf = p.pO15; }

        // Cartonașe Sintetice
        const cardsProb = 40 + ((Number(homeIdStr || 0) + Number(awayIdStr || 0)) % 40); 

        out.push({
          id: fixtureId,
          leagueId: Number(lId),
          league: fx.league?.name || "Unknown League",
          logos: { league: fx.league?.logo, home: fx.teams?.home?.logo, away: fx.teams?.away?.logo },
          teams: { home: homeName, away: awayName },
          kickoff: fx.fixture?.date,
          status: fx.fixture?.status?.short,
          referee: fx.fixture?.referee || "-",
          lambdas: { home: Number(lambdaHome.toFixed(2)), away: Number(lambdaAway.toFixed(2)) },
          probs: p,
          odds: odds,
          // AICI ERA GREȘEALA: Am adăugat ev și kelly în obiectul de mai jos!
          valueBet: { detected: valueDetected, type: valueType, ev: finalEv, kelly: finalKelly },
          predictions: { 
            oneXtwo: finalPick1X2,
            gg: p.pGG >= 55 ? "GG" : "NGG",
            over25: p.pO25 >= 55 ? "Peste 2.5" : "Sub 2.5",
            cards: cardsProb >= 60 ? "Peste 3.5" : "Sub 3.5",
            correctScore: calc.bestScore 
          },
          recommended: { 
            pick: topPick, 
            confidence: maxConf 
          },
          _debug: { method }
        });
      }
    }
    return res.status(200).json(out);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}