/**
 * Client-side Prediction Laboratory builder.
 * Recomputes from the latest PredictionRow so radar / table auto-update
 * when predict refreshes or live score merges into the selected match.
 */

import type { PredictionRow } from "../types";

export type LaboratoryRadarPoint = {
  metric: string;
  key: string;
  value: number;
};

export type LaboratoryComparisonRow = {
  metric: string;
  home: number | null;
  away: number | null;
  homeDisplay: string;
  awayDisplay: string;
  edge: number | null;
};

export type LaboratoryEvolutionStage = {
  stage: string;
  p1: number;
  pX: number;
  p2: number;
};

export type PredictionLaboratory = {
  version: string;
  updatedAt: string;
  available: boolean;
  fixtureId?: number | null;
  pick?: string | null;
  scores: {
    poisson: number;
    expectedGoals: number;
    standings: number;
    attack: number;
    defense: number;
    odds: number;
    confidence: number;
    expectedValue: number;
    bookmakerDifference: number;
    predictionEvolution: number;
  } | null;
  radar: LaboratoryRadarPoint[];
  comparison: {
    homeName: string;
    awayName: string;
    drawOdd: number | null;
    leagueAvg: number;
    rows: LaboratoryComparisonRow[];
  } | null;
  evolution: LaboratoryEvolutionStage[];
  bookmaker: {
    modelPct: number | null;
    impliedPct: number | null;
    differencePp: number | null;
    absDifferencePp: number | null;
    odd: number | null;
    score: number;
  } | null;
  metrics: Array<{
    key: string;
    label: string;
    value: number | null;
    display?: string;
    unit: string;
  }>;
  lambdas?: { home: number | null; away: number | null };
  expectedGoals?: { home: number | null; away: number | null };
};

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function num(v: unknown, fallback: number | null = null): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function pctFromProb(p: unknown): number | null {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return n > 1.5 ? clamp(n, 0, 100) : clamp(n * 100, 0, 100);
}

function impliedFromOdd(odd: unknown): number | null {
  const o = Number(odd);
  if (!Number.isFinite(o) || o <= 1) return null;
  return 100 / o;
}

function strengthToScore(atk: unknown, def: unknown, leagueAvg: unknown): number | null {
  const avg = Math.max(0.8, num(leagueAvg, 1.35) ?? 1.35);
  const a = num(atk, null);
  const d = num(def, null);
  if (a == null && d == null) return null;
  const atkScore = a == null ? 50 : clamp(50 + (a / avg - 1) * 55, 0, 100);
  const defScore = d == null ? 50 : clamp(50 + (avg / Math.max(0.2, d) - 1) * 55, 0, 100);
  if (a == null) return round1(defScore);
  if (d == null) return round1(atkScore);
  return round1((atkScore + defScore) / 2);
}

function standingsSideScore(snap?: { rank?: number; points?: number; played?: number } | null): number | null {
  if (!snap) return null;
  const rank = num(snap.rank, null);
  const pts = num(snap.points, null);
  const played = num(snap.played, null);
  let score = 50;
  if (rank != null && rank > 0) score = clamp(100 - (rank - 1) * 4.2, 18, 96);
  if (pts != null && played != null && played > 0) {
    const ppgScore = clamp((pts / played) * 28, 10, 98);
    score = rank != null ? score * 0.55 + ppgScore * 0.45 : ppgScore;
  }
  return round1(score);
}

function poissonScore(row: PredictionRow) {
  const raw = row.evaluation?.rawPoissonProbs1x2Pct || row.evaluation?.modelProbs1x2Pct;
  const p1 = pctFromProb(raw?.p1 ?? row.probs?.p1);
  const pX = pctFromProb(raw?.pX ?? row.probs?.pX);
  const p2 = pctFromProb(raw?.p2 ?? row.probs?.p2);
  if (p1 == null || pX == null || p2 == null) return 50;
  const maxP = Math.max(p1, pX, p2);
  const mass = num(row.modelMeta?.massCaptured, null);
  const clarity = clamp((maxP - 33.3) * 2.2, 0, 100);
  if (mass == null) return round1(clarity);
  return round1(clarity * 0.7 + clamp(mass * 100, 0, 100) * 0.3);
}

function expectedGoalsScore(row: PredictionRow) {
  const lh = num(row.lambdas?.home, null);
  const la = num(row.lambdas?.away, null);
  const hxg = num(row.luckStats?.hXG, null);
  const axg = num(row.luckStats?.aXG, null);
  if (lh == null && la == null && hxg == null && axg == null) return 45;
  const totalLam = (lh ?? 0) + (la ?? 0);
  const totalXg = (hxg ?? 0) + (axg ?? 0);
  const volume = clamp(totalLam > 0 ? (totalLam / 3.2) * 100 : (totalXg / 3.2) * 100, 20, 95);
  if (hxg == null || axg == null || lh == null || la == null) return round1(volume);
  const align = 100 - clamp((Math.abs(lh - hxg) + Math.abs(la - axg)) * 28, 0, 55);
  return round1(volume * 0.55 + align * 0.45);
}

function attackScore(row: PredictionRow) {
  const ce = num(row.confidenceEngine?.scores?.attack, null);
  if (ce != null) return round1(ce);
  const sm = row.modelMeta?.strengthMeta;
  const home = strengthToScore(sm?.atkH, null, row.modelMeta?.leagueParams?.leagueAvg);
  const away = strengthToScore(sm?.atkA, null, row.modelMeta?.leagueParams?.leagueAvg);
  if (home == null && away == null) return 50;
  return round1(((home ?? 50) + (away ?? 50)) / 2);
}

function defenseScore(row: PredictionRow) {
  const ce = num(row.confidenceEngine?.scores?.defense, null);
  if (ce != null) return round1(ce);
  const sm = row.modelMeta?.strengthMeta;
  const home = strengthToScore(null, sm?.defH, row.modelMeta?.leagueParams?.leagueAvg);
  const away = strengthToScore(null, sm?.defA, row.modelMeta?.leagueParams?.leagueAvg);
  if (home == null && away == null) return 50;
  return round1(((home ?? 50) + (away ?? 50)) / 2);
}

function standingsScore(row: PredictionRow) {
  const ce = num(row.confidenceEngine?.scores?.standings, null);
  if (ce != null) return round1(ce);
  const h = standingsSideScore(row.teamContext?.home);
  const a = standingsSideScore(row.teamContext?.away);
  if (h == null && a == null) return 48;
  return round1(((h ?? 50) + (a ?? 50)) / 2);
}

function oddsScore(row: PredictionRow) {
  const ce = num(row.confidenceEngine?.scores?.oddsConsensus, null);
  if (ce != null) return round1(ce);
  const h = num(row.odds?.home, null);
  const d = num(row.odds?.draw, null);
  const a = num(row.odds?.away, null);
  if (h == null || d == null || a == null) return 40;
  const inv = 1 / h + 1 / d + 1 / a;
  const overround = clamp((inv - 1) * 100, 0, 25);
  const books = num(row.odds?.bookmakersUsed ?? row.recommended?.bookmakersUsed, 0) ?? 0;
  return round1(clamp(books * 12, 20, 90) * 0.45 + clamp(100 - overround * 4, 25, 95) * 0.55);
}

function confidenceScore(row: PredictionRow) {
  const c = num(row.recommended?.confidence, null);
  if (c != null) return round1(clamp(c, 0, 100));
  const ce = num(row.confidenceEngine?.overall ?? row.confidenceEngine?.confidence, null);
  return ce != null ? round1(ce) : 50;
}

function expectedValueScore(row: PredictionRow) {
  const ev = num(row.valueEngine?.expectedValue, null) ?? num(row.valueBet?.ev, null);
  if (ev == null) return 42;
  return round1(clamp(50 + ev * 2, 5, 98));
}

function bookmakerDifference(row: PredictionRow) {
  const pick = String(row.recommended?.pick || "")
    .trim()
    .toLowerCase();
  let modelPct: number | null = null;
  let odd = num(row.recommended?.odd, null);

  if (pick === "1") {
    modelPct = pctFromProb(row.probs?.p1);
    odd = odd ?? num(row.odds?.home, null);
  } else if (pick === "x") {
    modelPct = pctFromProb(row.probs?.pX);
    odd = odd ?? num(row.odds?.draw, null);
  } else if (pick === "2") {
    modelPct = pctFromProb(row.probs?.p2);
    odd = odd ?? num(row.odds?.away, null);
  } else if (pick === "gg") {
    modelPct = pctFromProb(row.probs?.pGG);
    odd = odd ?? num(row.marketOdds?.btts?.odd, null);
  } else if (pick === "ngg") {
    modelPct = pctFromProb(row.probs?.pNGG ?? (row.probs?.pGG != null ? 100 - row.probs.pGG : null));
  } else if (/peste\s*2[.,]5/.test(pick)) {
    modelPct = pctFromProb(row.probs?.pO25);
    odd = odd ?? num(row.marketOdds?.goals25?.odd, null);
  } else if (/sub\s*2[.,]5/.test(pick)) {
    modelPct = pctFromProb(row.probs?.pU25 ?? (row.probs?.pO25 != null ? 100 - row.probs.pO25 : null));
    odd = odd ?? num(row.marketOdds?.goals25?.odd, null);
  }

  const impliedPct = impliedFromOdd(odd);
  const edge =
    num(row.valueEngine?.edge, null) ??
    (modelPct != null && impliedPct != null ? modelPct - impliedPct : null);
  const absDiff = edge == null ? null : Math.abs(edge);
  return {
    modelPct: modelPct == null ? null : round1(modelPct),
    impliedPct: impliedPct == null ? null : round1(impliedPct),
    differencePp: edge == null ? null : round1(edge),
    absDifferencePp: absDiff == null ? null : round1(absDiff),
    odd: odd == null ? null : round2(odd),
    score: absDiff == null ? 40 : round1(clamp(35 + absDiff * 2.8, 8, 98))
  };
}

function evolutionScore(stages: LaboratoryEvolutionStage[]) {
  if (stages.length < 2) return 55;
  let total = 0;
  let n = 0;
  for (let i = 1; i < stages.length; i++) {
    const a = stages[i - 1];
    const b = stages[i];
    total += Math.abs(a.p1 - b.p1) + Math.abs(a.pX - b.pX) + Math.abs(a.p2 - b.p2);
    n += 1;
  }
  return round1(clamp(100 - (n ? total / n : 0) * 1.8, 15, 98));
}

function buildEvolution(row: PredictionRow): LaboratoryEvolutionStage[] {
  const stages: LaboratoryEvolutionStage[] = [];
  const push = (label: string, triple?: { p1?: number; pX?: number; p2?: number } | null) => {
    if (!triple) return;
    const p1 = pctFromProb(triple.p1);
    const pX = pctFromProb(triple.pX);
    const p2 = pctFromProb(triple.p2);
    if (p1 == null || pX == null || p2 == null) return;
    stages.push({ stage: label, p1: round1(p1), pX: round1(pX), p2: round1(p2) });
  };

  const ev = row.evaluation || {};
  push("Poisson", ev.rawPoissonProbs1x2Pct);
  push("Calibrated", ev.calibratedProbs1x2Pct);
  push("Stacker", ev.stackerProbs1x2Pct);
  push("Model", ev.modelProbs1x2Pct);
  push("Final", { p1: row.probs?.p1, pX: row.probs?.pX, p2: row.probs?.p2 });

  const ih = impliedFromOdd(row.odds?.home);
  const ix = impliedFromOdd(row.odds?.draw);
  const ia = impliedFromOdd(row.odds?.away);
  if (ih != null && ix != null && ia != null) {
    const s = ih + ix + ia;
    stages.push({
      stage: "Market",
      p1: round1((ih / s) * 100),
      pX: round1((ix / s) * 100),
      p2: round1((ia / s) * 100)
    });
  }

  const deduped: LaboratoryEvolutionStage[] = [];
  for (const st of stages) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.p1 === st.p1 && prev.pX === st.pX && prev.p2 === st.p2) continue;
    deduped.push(st);
  }
  return deduped;
}

function buildComparison(row: PredictionRow) {
  const sm = row.modelMeta?.strengthMeta || {};
  const lh = num(row.lambdas?.home, null);
  const la = num(row.lambdas?.away, null);
  const hxg = num(row.luckStats?.hXG, null);
  const axg = num(row.luckStats?.aXG, null);
  const hCtx = row.teamContext?.home;
  const aCtx = row.teamContext?.away;
  const hStand = standingsSideScore(hCtx);
  const aStand = standingsSideScore(aCtx);

  const rows: LaboratoryComparisonRow[] = [
    {
      metric: "Poisson λ",
      home: lh,
      away: la,
      homeDisplay: lh == null ? "—" : lh.toFixed(2),
      awayDisplay: la == null ? "—" : la.toFixed(2),
      edge: lh != null && la != null ? round2(lh - la) : null
    },
    {
      metric: "Expected Goals",
      home: hxg,
      away: axg,
      homeDisplay: hxg == null ? "—" : hxg.toFixed(2),
      awayDisplay: axg == null ? "—" : axg.toFixed(2),
      edge: hxg != null && axg != null ? round2(hxg - axg) : null
    },
    {
      metric: "Attack Score",
      home: num(sm.atkH, null),
      away: num(sm.atkA, null),
      homeDisplay: sm.atkH != null ? Number(sm.atkH).toFixed(2) : "—",
      awayDisplay: sm.atkA != null ? Number(sm.atkA).toFixed(2) : "—",
      edge: sm.atkH != null && sm.atkA != null ? round2(Number(sm.atkH) - Number(sm.atkA)) : null
    },
    {
      metric: "Defense Score",
      home: num(sm.defH, null),
      away: num(sm.defA, null),
      homeDisplay: sm.defH != null ? Number(sm.defH).toFixed(2) : "—",
      awayDisplay: sm.defA != null ? Number(sm.defA).toFixed(2) : "—",
      edge: sm.defH != null && sm.defA != null ? round2(Number(sm.defA) - Number(sm.defH)) : null
    },
    {
      metric: "Standings Score",
      home: hStand,
      away: aStand,
      homeDisplay:
        hCtx?.rank != null
          ? `#${hCtx.rank}${hCtx.points != null ? ` · ${hCtx.points}p` : ""}`
          : hStand == null
            ? "—"
            : String(Math.round(hStand)),
      awayDisplay:
        aCtx?.rank != null
          ? `#${aCtx.rank}${aCtx.points != null ? ` · ${aCtx.points}p` : ""}`
          : aStand == null
            ? "—"
            : String(Math.round(aStand)),
      edge: hStand != null && aStand != null ? round1(hStand - aStand) : null
    },
    {
      metric: "Odds (1 / 2)",
      home: num(row.odds?.home, null),
      away: num(row.odds?.away, null),
      homeDisplay: row.odds?.home != null ? Number(row.odds.home).toFixed(2) : "—",
      awayDisplay: row.odds?.away != null ? Number(row.odds.away).toFixed(2) : "—",
      edge:
        row.odds?.home != null && row.odds?.away != null
          ? round2(Number(row.odds.away) - Number(row.odds.home))
          : null
    },
    {
      metric: "1X2 model %",
      home: pctFromProb(row.probs?.p1),
      away: pctFromProb(row.probs?.p2),
      homeDisplay: pctFromProb(row.probs?.p1) != null ? `${pctFromProb(row.probs?.p1)!.toFixed(1)}%` : "—",
      awayDisplay: pctFromProb(row.probs?.p2) != null ? `${pctFromProb(row.probs?.p2)!.toFixed(1)}%` : "—",
      edge:
        pctFromProb(row.probs?.p1) != null && pctFromProb(row.probs?.p2) != null
          ? round1(pctFromProb(row.probs?.p1)! - pctFromProb(row.probs?.p2)!)
          : null
    }
  ];

  return {
    homeName: row.teams?.home || "Home",
    awayName: row.teams?.away || "Away",
    drawOdd: row.odds?.draw != null ? Number(row.odds.draw) : null,
    leagueAvg: num(row.modelMeta?.leagueParams?.leagueAvg, 1.35) ?? 1.35,
    rows
  };
}

/** Derive laboratory diagnostics from a prediction row (always fresh). */
export function buildPredictionLaboratory(row: PredictionRow | null | undefined): PredictionLaboratory {
  if (!row || row.insufficientData) {
    return {
      version: "lab-v1",
      updatedAt: new Date().toISOString(),
      available: false,
      scores: null,
      radar: [],
      comparison: null,
      evolution: [],
      bookmaker: null,
      metrics: []
    };
  }

  // Prefer server payload when present, but always recompute so UI stays live.
  const book = bookmakerDifference(row);
  const evolution = buildEvolution(row);
  const scores = {
    poisson: poissonScore(row),
    expectedGoals: expectedGoalsScore(row),
    standings: standingsScore(row),
    attack: attackScore(row),
    defense: defenseScore(row),
    odds: oddsScore(row),
    confidence: confidenceScore(row),
    expectedValue: expectedValueScore(row),
    bookmakerDifference: book.score,
    predictionEvolution: evolutionScore(evolution)
  };

  const radar: LaboratoryRadarPoint[] = [
    { metric: "Poisson", key: "poisson", value: scores.poisson },
    { metric: "xG", key: "expectedGoals", value: scores.expectedGoals },
    { metric: "Standings", key: "standings", value: scores.standings },
    { metric: "Attack", key: "attack", value: scores.attack },
    { metric: "Defense", key: "defense", value: scores.defense },
    { metric: "Odds", key: "odds", value: scores.odds },
    { metric: "Confidence", key: "confidence", value: scores.confidence },
    { metric: "EV", key: "expectedValue", value: scores.expectedValue },
    { metric: "Book Δ", key: "bookmakerDifference", value: scores.bookmakerDifference },
    { metric: "Evolution", key: "predictionEvolution", value: scores.predictionEvolution }
  ];

  const evRaw = num(row.valueEngine?.expectedValue ?? row.valueBet?.ev, null);

  return {
    version: "lab-v1",
    updatedAt: new Date().toISOString(),
    available: true,
    fixtureId: row.id ?? null,
    pick: row.recommended?.pick ?? null,
    scores,
    radar,
    comparison: buildComparison(row),
    evolution,
    bookmaker: book,
    metrics: [
      { key: "poisson", label: "Poisson", value: scores.poisson, unit: "score" },
      { key: "expectedGoals", label: "Expected Goals", value: scores.expectedGoals, unit: "score" },
      { key: "standings", label: "Standings Score", value: scores.standings, unit: "score" },
      { key: "attack", label: "Attack Score", value: scores.attack, unit: "score" },
      { key: "defense", label: "Defense Score", value: scores.defense, unit: "score" },
      { key: "odds", label: "Odds Score", value: scores.odds, unit: "score" },
      { key: "confidence", label: "Confidence", value: scores.confidence, unit: "score" },
      {
        key: "expectedValue",
        label: "Expected Value",
        value: evRaw ?? scores.expectedValue,
        display: evRaw == null ? `${scores.expectedValue}` : `${evRaw >= 0 ? "+" : ""}${round1(evRaw)}%`,
        unit: "ev"
      },
      {
        key: "bookmakerDifference",
        label: "Bookmaker Difference",
        value: book.differencePp,
        display:
          book.differencePp == null
            ? "—"
            : `${book.differencePp >= 0 ? "+" : ""}${book.differencePp.toFixed(1)} pp`,
        unit: "pp"
      },
      {
        key: "predictionEvolution",
        label: "Prediction Evolution",
        value: scores.predictionEvolution,
        display: `${evolution.length} stages`,
        unit: "score"
      }
    ],
    lambdas: {
      home: num(row.lambdas?.home, null),
      away: num(row.lambdas?.away, null)
    },
    expectedGoals: {
      home: num(row.luckStats?.hXG, null),
      away: num(row.luckStats?.aXG, null)
    }
  };
}
