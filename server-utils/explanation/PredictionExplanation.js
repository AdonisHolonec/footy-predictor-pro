/**
 * Build explainable prediction payloads from real data only.
 * Skips any reason that cannot be computed from finite inputs.
 */

import { createReason, formatSignedPct, formatFixed } from "./PredictionReason.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sliceForm(form, max = 10) {
  const s = String(form || "")
    .toUpperCase()
    .replace(/[^WDL]/g, "");
  if (!s) return null;
  return s.slice(0, max);
}

/** Count BTTS from H2H / recent match goal pairs when available. */
function countBtts(fixtures, recentHome, recentAway) {
  let yes = 0;
  let total = 0;
  const pushPair = (gh, ga) => {
    if (!Number.isFinite(gh) || !Number.isFinite(ga)) return;
    total += 1;
    if (gh > 0 && ga > 0) yes += 1;
  };

  if (Array.isArray(fixtures)) {
    for (const f of fixtures) {
      pushPair(Number(f?.goals?.home), Number(f?.goals?.away));
    }
  }
  if (total === 0 && (Array.isArray(recentHome) || Array.isArray(recentAway))) {
    // Recent matches are per-team GF/GA — approximate BTTS if both sides' recent lists exist with goals.
    const h = Array.isArray(recentHome) ? recentHome : [];
    const a = Array.isArray(recentAway) ? recentAway : [];
    const n = Math.min(h.length, a.length, 10);
    for (let i = 0; i < n; i++) {
      const homeScored = Number(h[i]?.goalsFor);
      const awayScored = Number(a[i]?.goalsFor);
      if (!Number.isFinite(homeScored) || !Number.isFinite(awayScored)) continue;
      total += 1;
      if (homeScored > 0 && awayScored > 0) yes += 1;
    }
  }
  if (total <= 0) return null;
  return { yes, total };
}

function pickImpliesMarket(pick) {
  const p = String(pick || "").trim().toLowerCase();
  if (!p) return null;
  if (p === "1" || p === "x" || p === "2") return "1x2";
  if (p === "gg" || p.includes("gg") && !p.includes("ngg")) return "btts_yes";
  if (p === "ngg" || p.includes("ngg")) return "btts_no";
  if (/peste\s*2[.,]?5|over\s*2[.,]?5|o2\.?5/.test(p)) return "over25";
  if (/sub\s*2[.,]?5|under\s*2[.,]?5|u2\.?5/.test(p)) return "under25";
  if (/peste\s*1[.,]?5|over\s*1[.,]?5/.test(p)) return "over15";
  if (/peste\s*3[.,]?5|over\s*3[.,]?5/.test(p)) return "over35";
  return "other";
}

/**
 * Odds support from real quotes vs model probability for the pick.
 * @returns {import('./PredictionReason.js').PredictionReason|null}
 */
function reasonOddsSupport({ pick, pickProb, odds, marketOdds, shin }) {
  const market = pickImpliesMarket(pick);
  const modelP = num(pickProb);
  if (modelP == null) return null;

  let implied = null;
  let oddVal = null;
  let source = "odds";

  if (market === "1x2" && odds) {
    const key = String(pick).toUpperCase() === "1" ? "home" : String(pick).toUpperCase() === "2" ? "away" : "draw";
    oddVal = num(odds[key]);
    if (shin && num(shin.p1) != null) {
      implied = (key === "home" ? shin.p1 : key === "away" ? shin.p2 : shin.pX) * 100;
      source = "shin_implied";
    } else if (oddVal != null && oddVal > 1) {
      implied = (1 / oddVal) * 100;
      source = "raw_implied";
    }
  } else if (market === "btts_yes" && marketOdds?.btts) {
    oddVal = num(marketOdds.btts.odd);
    if (oddVal != null && oddVal > 1) {
      implied = (1 / oddVal) * 100;
      source = "btts_odds";
    }
  } else if (market === "over25" && marketOdds?.goals25) {
    oddVal = num(marketOdds.goals25.odd);
    if (oddVal != null && oddVal > 1) {
      implied = (1 / oddVal) * 100;
      source = "ou25_odds";
    }
  } else if (market === "under25" && marketOdds?.goals25) {
    // If quote is for over, invert roughly when pick is under — only if pick label on quote matches
    const quotePick = String(marketOdds.goals25.pick || "").toLowerCase();
    oddVal = num(marketOdds.goals25.odd);
    if (oddVal != null && oddVal > 1) {
      if (quotePick.includes("sub") || quotePick.includes("under")) implied = (1 / oddVal) * 100;
      else implied = 100 - (1 / oddVal) * 100;
      source = "ou25_odds";
    }
  }

  if (implied == null || !Number.isFinite(implied)) return null;
  const edge = modelP - implied;
  if (edge >= 2) {
    return createReason({
      code: "odds_support",
      label: `Odds support prediction (model ${modelP.toFixed(0)}% vs market ${implied.toFixed(0)}%)`,
      value: Number(edge.toFixed(1)),
      unit: "pp",
      polarity: "support",
      source,
      meta: { modelP, implied, odd: oddVal }
    });
  }
  if (edge <= -2) {
    return createReason({
      code: "odds_against",
      label: `Odds lean against pick (model ${modelP.toFixed(0)}% vs market ${implied.toFixed(0)}%)`,
      value: Number(edge.toFixed(1)),
      unit: "pp",
      polarity: "negative",
      source,
      meta: { modelP, implied, odd: oddVal }
    });
  }
  return createReason({
    code: "odds_aligned",
    label: `Odds aligned with model (≈${implied.toFixed(0)}% implied)`,
    value: Number(edge.toFixed(1)),
    unit: "pp",
    polarity: "neutral",
    source,
    meta: { modelP, implied, odd: oddVal }
  });
}

/**
 * @param {object} input
 * @returns {{ pick: string, confidence: number, reasons: object[], formHome: string|null, formAway: string|null, expectedGoals: number|null, reasoning: string[] }}
 */
export function buildPredictionExplanation(input = {}) {
  const pick = String(input.pick || "").trim();
  const confidence = num(input.confidence);
  const reasons = [];

  const leagueAvg =
    num(input.strengthMeta?.leagueAvg) ||
    num(input.leagueParams?.leagueAvg) ||
    num(input.leagueParams?.leagueAvgGoals);
  const atkH = num(input.strengthMeta?.atkH) ?? num(input.luckStats?.hG);
  const atkA = num(input.strengthMeta?.atkA) ?? num(input.luckStats?.aG);
  const defH = num(input.strengthMeta?.defH);
  const defA = num(input.strengthMeta?.defA);
  const lambdaHome = num(input.lambdas?.home) ?? num(input.strengthMeta?.baseLambdaHome);
  const lambdaAway = num(input.lambdas?.away) ?? num(input.strengthMeta?.baseLambdaAway);

  // Home attack vs league average
  if (atkH != null && leagueAvg != null && leagueAvg > 0) {
    const pct = ((atkH / leagueAvg) - 1) * 100;
    const labelPct = formatSignedPct(pct, 0);
    if (labelPct) {
      reasons.push(
        createReason({
          code: "home_attack",
          label: `Home attack ${labelPct}`,
          value: Number(pct.toFixed(1)),
          unit: "%",
          polarity: pct >= 0 ? "positive" : "negative",
          source: "strengthMeta.atkH",
          meta: { atkH, leagueAvg }
        })
      );
    }
  }

  // Away defense strength vs league (higher GA → weaker defense → negative %)
  if (defA != null && leagueAvg != null && leagueAvg > 0) {
    const pct = (1 - defA / leagueAvg) * 100;
    const labelPct = formatSignedPct(pct, 0);
    if (labelPct) {
      reasons.push(
        createReason({
          code: "away_defense",
          label: `Away defense ${labelPct}`,
          value: Number(pct.toFixed(1)),
          unit: "%",
          polarity: pct >= 0 ? "positive" : "negative",
          source: "strengthMeta.defA",
          meta: { defA, leagueAvg }
        })
      );
    }
  }

  // Home defense / Away attack when relevant to pick
  const market = pickImpliesMarket(pick);
  if ((market === "1x2" || market === "other") && defH != null && leagueAvg != null && leagueAvg > 0) {
    const pct = (1 - defH / leagueAvg) * 100;
    const labelPct = formatSignedPct(pct, 0);
    if (labelPct && Math.abs(pct) >= 5) {
      reasons.push(
        createReason({
          code: "home_defense",
          label: `Home defense ${labelPct}`,
          value: Number(pct.toFixed(1)),
          unit: "%",
          polarity: pct >= 0 ? "positive" : "negative",
          source: "strengthMeta.defH",
          meta: { defH, leagueAvg }
        })
      );
    }
  }
  if (atkA != null && leagueAvg != null && leagueAvg > 0 && (market === "btts_yes" || market === "over25" || market === "over15")) {
    const pct = ((atkA / leagueAvg) - 1) * 100;
    const labelPct = formatSignedPct(pct, 0);
    if (labelPct && Math.abs(pct) >= 4) {
      reasons.push(
        createReason({
          code: "away_attack",
          label: `Away attack ${labelPct}`,
          value: Number(pct.toFixed(1)),
          unit: "%",
          polarity: pct >= 0 ? "positive" : "negative",
          source: "strengthMeta.atkA",
          meta: { atkA, leagueAvg }
        })
      );
    }
  }

  let expectedGoals = null;
  if (lambdaHome != null && lambdaAway != null) {
    expectedGoals = Number((lambdaHome + lambdaAway).toFixed(2));
    const egLabel = formatFixed(expectedGoals, 2);
    if (egLabel) {
      reasons.push(
        createReason({
          code: "expected_goals",
          label: `Expected Goals ${egLabel}`,
          value: expectedGoals,
          unit: "xg",
          polarity: expectedGoals >= 2.5 ? "positive" : expectedGoals <= 2.0 ? "negative" : "neutral",
          source: "lambdas",
          meta: { lambdaHome, lambdaAway }
        })
      );
    }
  }

  // Historical BTTS rate when we have real match scores
  const bttsHist = countBtts(input.h2hFixtures, input.homeRecentMatches, input.awayRecentMatches);
  if (bttsHist && bttsHist.total >= 3) {
    reasons.push(
      createReason({
        code: "btts_history",
        label: `Both Teams Scored ${bttsHist.yes}/${bttsHist.total}`,
        value: bttsHist.yes,
        unit: `/${bttsHist.total}`,
        polarity: bttsHist.yes / bttsHist.total >= 0.55 ? "positive" : "negative",
        source: "h2h_or_recent",
        meta: bttsHist
      })
    );
  } else {
    // Fallback: model pGG as X/10 — still from real λ/Poisson output, not filler text
    const pGG = num(input.probs?.pGG);
    if (pGG != null && (market === "btts_yes" || market === "btts_no" || market === "over25" || pGG >= 55)) {
      const tenths = Math.max(0, Math.min(10, Math.round(pGG / 10)));
      reasons.push(
        createReason({
          code: "btts_model",
          label: `Both Teams Score ${tenths}/10 (pGG ${pGG.toFixed(0)}%)`,
          value: tenths,
          unit: "/10",
          polarity: tenths >= 6 ? "positive" : tenths <= 4 ? "negative" : "neutral",
          source: "probs.pGG",
          meta: { pGG }
        })
      );
    }
  }

  const formHome = sliceForm(input.formHome || input.teamContext?.home?.form);
  const formAway = sliceForm(input.formAway || input.teamContext?.away?.form);
  if (formHome) {
    reasons.push(
      createReason({
        code: "home_form",
        label: `Home Form ${formHome}`,
        value: null,
        polarity: "neutral",
        source: "formHome",
        meta: { form: formHome }
      })
    );
  }
  if (formAway) {
    reasons.push(
      createReason({
        code: "away_form",
        label: `Away Form ${formAway}`,
        value: null,
        polarity: "neutral",
        source: "formAway",
        meta: { form: formAway }
      })
    );
  }

  const refAvg = num(input.refereeStats?.avgGoals);
  if (refAvg != null) {
    reasons.push(
      createReason({
        code: "referee_avg_goals",
        label: `Referee average goals ${formatFixed(refAvg, 1)}`,
        value: refAvg,
        unit: "goals",
        polarity: refAvg >= 2.8 ? "positive" : refAvg <= 2.2 ? "negative" : "neutral",
        source: "refereeStats.avgGoals",
        meta: { name: input.refereeName || input.refereeStats?.name || null }
      })
    );
  }

  const homeAdv = num(input.leagueParams?.homeAdv) ?? num(input.strengthMeta?.homeAdv);
  if (homeAdv != null && (market === "1x2" || String(pick) === "1")) {
    const pct = (homeAdv - 1) * 100;
    const labelPct = formatSignedPct(pct, 0);
    if (labelPct && Math.abs(pct) >= 3) {
      reasons.push(
        createReason({
          code: "home_advantage",
          label: `Home advantage ${labelPct}`,
          value: Number(pct.toFixed(1)),
          unit: "%",
          polarity: pct >= 0 ? "positive" : "negative",
          source: "leagueParams.homeAdv",
          meta: { homeAdv }
        })
      );
    }
  }

  const eloSpread = num(input.eloSpread ?? input.elo?.spread);
  if (eloSpread != null && Math.abs(eloSpread) >= 40) {
    const signed = formatSignedPct((eloSpread / 400) * 100, 0);
    reasons.push(
      createReason({
        code: "elo_spread",
        label: `Elo edge ${eloSpread > 0 ? "+" : ""}${Math.round(eloSpread)} (${signed || "n/a"} vs 400)`,
        value: eloSpread,
        unit: "elo",
        polarity: eloSpread >= 0 ? "positive" : "negative",
        source: "elo.spread",
        meta: { eloSpread }
      })
    );
  }

  const oddsReason = reasonOddsSupport({
    pick,
    pickProb: confidence,
    odds: input.odds,
    marketOdds: input.marketOdds,
    shin: input.shinImplied || input.shin
  });
  if (oddsReason) reasons.push(oddsReason);

  const pO25 = num(input.probs?.pO25);
  if (pO25 != null && (market === "over25" || market === "under25")) {
    reasons.push(
      createReason({
        code: "ou25_prob",
        label: `Over 2.5 probability ${pO25.toFixed(0)}%`,
        value: pO25,
        unit: "%",
        polarity: pO25 >= 55 ? "positive" : pO25 <= 45 ? "negative" : "neutral",
        source: "probs.pO25"
      })
    );
  }

  const clean = reasons.filter(Boolean);

  return {
    pick: pick || "",
    confidence: confidence == null ? null : Number(confidence.toFixed(1)),
    reasons: clean,
    formHome,
    formAway,
    expectedGoals,
    reasoning: clean.map((r) => r.label)
  };
}

export const PredictionExplanation = { build: buildPredictionExplanation };
