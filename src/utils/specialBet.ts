import type { CardMarketValidations, PredictionRow } from "../types";
import {
  outcomeTextClass,
  resolveCardMarketOutcome,
  type CardMarketId,
  type MarketOutcome
} from "./cardMarketOutcome";
import {
  deriveAlignedOuPick,
  deriveCardGoalsPick,
  goalsOddForLine,
  listGoalsPickCandidates,
  matchingMarketOdd,
  parseGoalsOuPick,
  parseOuSide,
  recommendedOdd,
  resolveFirstHalfGoalsActual,
  shotsDisplayOdd,
  type GoalsOuPick
} from "./marketPicks";
import { resolveMarketFamilyKey, type MarketFamilyKey } from "./formatRecommendation";

export type SpecialBetLegId = CardMarketId | "ht" | "gg" | "cards";

export type SpecialBetLiveAdjustment = NonNullable<
  NonNullable<PredictionRow["confidenceEngine"]>["liveAdjustment"]
>;

export type SpecialBetLeg = {
  id: SpecialBetLegId;
  label: string;
  pick: string;
  probability: number;
  odd: number;
  outcome: MarketOutcome;
  /** Market family this leg belongs to (Goals / Corners / Cards / BTTS / 1X2 / Double Chance / Shots) — drives one-per-family diversity in pickSpecialBetLegs(). */
  family: MarketFamilyKey;
  /** Live momentum nudge (Sprint 2), display-only — only ever set on the "recommended" leg. */
  liveAdjustment?: SpecialBetLiveAdjustment | null;
};

/**
 * Prefer the highest-probability goals O/U that also has a real book quote.
 * Without this, Over 1.5 can win on model % while lacking goals15 odds and get
 * filtered out of the special-bet pool entirely.
 */
function deriveSpecialBetGoalsPick(row: PredictionRow): GoalsOuPick | null {
  const exclude = parseGoalsOuPick(row.recommended?.pick);
  const candidates = listGoalsPickCandidates(row).filter((c) => {
    if (!exclude) return true;
    return !(c.side === exclude.side && Math.abs(c.line - exclude.line) < 1e-6);
  });
  for (const c of candidates) {
    if (goalsOddForLine(row, c.line, c.side) != null) return c;
  }
  return candidates[0] || deriveCardGoalsPick(row);
}

export type SpecialBetLabels = {
  main: string;
  goals: string;
  corners: string;
  shots: string;
  ht: string;
  gg: string;
  cards: string;
};

/** Compact display badge for the "recommended" leg's live momentum nudge (Sprint 2). Neutral is not shown — matches the notification threshold pattern (Sprint 3) of only surfacing non-stable signal. */
export function specialBetLiveAdjustmentBadge(
  liveAdjustment?: SpecialBetLiveAdjustment | null
): { delta: string; tone: "success" | "danger" } | null {
  if (!liveAdjustment || liveAdjustment.reason === "neutral") return null;
  return {
    delta: liveAdjustment.delta > 0 ? `+${liveAdjustment.delta}` : String(liveAdjustment.delta),
    tone: liveAdjustment.reason === "aligned" ? "success" : "danger"
  };
}

/** Same threshold as HOT chips on MatchCard. */
export const SPECIAL_BET_STRONG_SIGNAL = 85;
const MAX_EXTRA_STRONG_LEGS = 2;

function hasValidOdd(n: unknown): n is number {
  const v = Number(n);
  return Number.isFinite(v) && v > 1;
}

function bttsOddForPick(row: PredictionRow, pick: "GG" | "NGG"): number | null {
  const yes = Number(row.marketOdds?.btts?.odd);
  if (!Number.isFinite(yes) || yes <= 1) return null;
  if (pick === "GG") return yes;
  // Book often stores only BTTS Yes; derive No as complement when needed.
  const no = yes / (yes - 1);
  return Number.isFinite(no) && no > 1 ? no : null;
}

function deriveCardsPick(row: PredictionRow): {
  pick: string;
  side: "over" | "under";
  line: number;
  probability: number;
} | null {
  const quote = row.marketOdds?.cards;
  const line = Number(quote?.line);
  const lineOk = Number.isFinite(line) && line > 0 ? line : 3.5;

  const fromVe = (row.valueEngine?.markets || []).find((m) =>
    /card|booking|cartona/i.test(`${m?.type || ""} ${m?.family || ""}`)
  );
  if (fromVe && Number(fromVe.probability) > 0) {
    const side =
      parseOuSide(String(fromVe.type || "")) ||
      (Number(fromVe.probability) >= 50 ? "over" : "under");
    const veLine = Number(fromVe.line);
    const useLine = Number.isFinite(veLine) && veLine > 0 ? veLine : lineOk;
    return {
      pick: `${side === "over" ? "Over" : "Under"} ${useLine.toFixed(1)}`,
      side,
      line: useLine,
      probability: Number(fromVe.probability)
    };
  }

  const pred = String(row.predictions?.cards || "").trim();
  if (pred) {
    const side = parseOuSide(pred);
    if (side) {
      const m = pred.match(/(\d+(?:[.,]\d+)?)/);
      const parsedLine = m ? Number(m[1].replace(",", ".")) : lineOk;
      return {
        pick: pred,
        side,
        line: Number.isFinite(parsedLine) ? parsedLine : lineOk,
        // Without model %, treat as lean — only enters special bet if odds exist and we
        // later require strong signal for extras; base pool needs probability > 0.
        probability: 55
      };
    }
  }

  // Fallback: prefer Over when over odd is the shorter price (higher implied), else Under.
  if (quote && (hasValidOdd(quote.over) || hasValidOdd(quote.under) || hasValidOdd(quote.odd))) {
    const over = Number(quote.over ?? quote.odd);
    const under = Number(quote.under);
    if (hasValidOdd(over) && hasValidOdd(under)) {
      const side = over <= under ? "over" : "under";
      return {
        pick: `${side === "over" ? "Over" : "Under"} ${lineOk.toFixed(1)}`,
        side,
        line: lineOk,
        probability: 52
      };
    }
  }
  return null;
}

function gradeGgOutcome(row: PredictionRow, pick: "GG" | "NGG"): MarketOutcome {
  if (!["FT", "AET", "PEN"].includes(String(row.status || "").toUpperCase())) return null;
  const home = row.score?.home;
  const away = row.score?.away;
  if (home == null || away == null) return "pending";
  const h = Number(home);
  const a = Number(away);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return "pending";
  const gg = h > 0 && a > 0;
  const ok = pick === "GG" ? gg : !gg;
  return ok ? "win" : "loss";
}

/**
 * All special-bet candidates with bookmaker odds, sorted by probability (desc).
 */
export function listSpecialBetCandidates(
  row: PredictionRow,
  labels: SpecialBetLabels,
  stored?: CardMarketValidations | null,
  marketResults?: PredictionRow["marketResults"] | null
): SpecialBetLeg[] {
  const conf = Number(row.recommended?.confidence);
  const confPct = Number.isFinite(conf) ? conf : 0;
  const goalsPick = deriveSpecialBetGoalsPick(row);
  const cornersPick = row.probs?.corners
    ? deriveAlignedOuPick(row.probs.corners.total, row.marketOdds?.corners)
    : null;
  const shotsPick = row.probs?.shotsOnTarget
    ? deriveAlignedOuPick(row.probs.shotsOnTarget.total, row.marketOdds?.shotsOnTarget)
    : null;
  const firstHalfPick = row.probs?.firstHalf
    ? row.probs.firstHalf.pO15 >= 50
      ? { pick: "Over 1.5 FH", side: "over" as const, line: 1.5, probability: row.probs.firstHalf.pO15 }
      : {
          pick: "Under 1.5 FH",
          side: "under" as const,
          line: 1.5,
          probability: 100 - row.probs.firstHalf.pO15
        }
    : null;

  const pGG = Number(row.probs?.pGG);
  const ggPick: "GG" | "NGG" | null = Number.isFinite(pGG)
    ? pGG >= 50
      ? "GG"
      : "NGG"
    : null;
  const ggProbability = ggPick === "GG" ? pGG : ggPick === "NGG" ? 100 - pGG : 0;
  const cardsPick = deriveCardsPick(row);

  const enrichedRow: PredictionRow = {
    ...row,
    marketResults: marketResults ?? row.marketResults
  };

  const pool: SpecialBetLeg[] = [
    {
      id: "recommended",
      label: labels.main,
      pick: row.recommended?.pick || "",
      probability: confPct,
      odd: Number(recommendedOdd(row)),
      outcome: resolveCardMarketOutcome("recommended", enrichedRow, stored),
      family: resolveMarketFamilyKey(row.recommended?.pick, row.recommended?.family),
      liveAdjustment: row.confidenceEngine?.liveAdjustment ?? null
    },
    {
      id: "goals",
      label: labels.goals,
      pick: goalsPick
        ? `${goalsPick.side === "over" ? "Over" : "Under"} ${goalsPick.line.toFixed(1)}`
        : "",
      probability: Number(goalsPick?.probability || 0),
      odd: goalsPick ? Number(goalsOddForLine(row, goalsPick.line, goalsPick.side) ?? NaN) : NaN,
      outcome: resolveCardMarketOutcome("goals", enrichedRow, stored),
      family: "GOALS"
    },
    {
      id: "gg",
      label: labels.gg,
      pick: ggPick || "",
      probability: ggProbability,
      odd: ggPick ? Number(bttsOddForPick(row, ggPick) ?? NaN) : NaN,
      outcome: ggPick ? gradeGgOutcome(enrichedRow, ggPick) : null,
      family: "BTTS"
    },
    {
      id: "corners",
      label: labels.corners,
      pick: cornersPick
        ? `${cornersPick.side === "over" ? "Over" : "Under"} ${cornersPick.line.toFixed(1)}`
        : "",
      probability: Number(cornersPick?.probability || 0),
      odd: cornersPick
        ? Number(
            matchingMarketOdd(row.marketOdds?.corners, cornersPick.side, cornersPick.line) ??
              row.marketOdds?.corners?.odd ??
              NaN
          )
        : NaN,
      outcome: resolveCardMarketOutcome("corners", enrichedRow, stored),
      family: "CORNERS"
    },
    {
      id: "shots",
      label: labels.shots,
      pick: shotsPick
        ? `${shotsPick.side === "over" ? "Over" : "Under"} ${shotsPick.line.toFixed(1)}`
        : "",
      probability: Number(shotsPick?.probability || 0),
      odd: shotsPick ? Number(shotsDisplayOdd(row, shotsPick.side, shotsPick.line) ?? NaN) : NaN,
      outcome: resolveCardMarketOutcome("shots", enrichedRow, stored),
      family: "SHOTS"
    },
    {
      id: "ht",
      label: labels.ht,
      pick: firstHalfPick?.pick || "",
      probability: Number(firstHalfPick?.probability || 0),
      odd: firstHalfPick
        ? Number(
            matchingMarketOdd(row.marketOdds?.firstHalfGoals, firstHalfPick.side, firstHalfPick.line) ??
              row.marketOdds?.firstHalfGoals?.odd ??
              NaN
          )
        : NaN,
      outcome: ((): MarketOutcome => {
        if (!firstHalfPick) return null;
        if (!["FT", "AET", "PEN"].includes(String(row.status || "").toUpperCase())) return null;
        const ht = resolveFirstHalfGoalsActual(enrichedRow);
        if (ht == null || !Number.isFinite(Number(ht))) return "pending";
        const ok =
          firstHalfPick.side === "over"
            ? Number(ht) > firstHalfPick.line
            : Number(ht) < firstHalfPick.line;
        return ok ? "win" : "loss";
      })(),
      // First-half goals totals are the same underlying market as full-match Goals
      // (highly correlated) — grouped into GOALS so an accumulator never carries both.
      family: "GOALS"
    },
    {
      id: "cards",
      label: labels.cards,
      pick: cardsPick?.pick || "",
      probability: Number(cardsPick?.probability || 0),
      odd: cardsPick
        ? Number(matchingMarketOdd(row.marketOdds?.cards, cardsPick.side, cardsPick.line) ?? NaN)
        : NaN,
      outcome: null,
      family: "CARDS"
    }
  ];

  return pool
    .filter((x) => x.pick && Number.isFinite(x.probability) && x.probability > 0 && hasValidOdd(x.odd))
    .sort(compareSpecialBetCandidates);
}

/**
 * Fixed slot order used only when Recommendation Scores tie — keeps the
 * generator fully deterministic across engines without changing quality ranking.
 */
const LEG_ID_TIEBREAK: Record<SpecialBetLegId, number> = {
  recommended: 0,
  goals: 1,
  gg: 2,
  corners: 3,
  shots: 4,
  ht: 5,
  cards: 6
};

function compareSpecialBetCandidates(a: SpecialBetLeg, b: SpecialBetLeg): number {
  const byScore = b.probability - a.probability;
  if (byScore !== 0) return byScore;
  return (LEG_ID_TIEBREAK[a.id] ?? 99) - (LEG_ID_TIEBREAK[b.id] ?? 99);
}

/**
 * Selects `legCount` base legs plus up to `MAX_EXTRA_STRONG_LEGS` extra legs with
 * probability ≥ SPECIAL_BET_STRONG_SIGNAL — greedily, by market family diversity.
 *
 * Pipeline (Phase 1):
 *   1. Re-sort by Recommendation Score desc (defensive — listSpecialBetCandidates
 *      already sorts; this guarantees callers cannot bypass determinism).
 *   2. Take the highest-scoring remaining candidate.
 *   3. Mark its MarketFamilyKey as used and skip every other same-family candidate.
 *   4. Repeat until `legCount`, then optionally append premium extras (≥85%).
 *
 * Same-family pairs that are impossible after this pass include two Corners
 * lines, Goals + HT Goals, duplicated BTTS/Cards/1X2/Double Chance, etc.
 * 1X2 and Double Chance remain DISTINCT families in Phase 1 (Home Win + 1X is
 * Phase 2 correlation, not same-family diversity).
 *
 * Deterministic — no randomness; score ties break via LEG_ID_TIEBREAK.
 *
 * ---------------------------------------------------------------------------
 * Phase 2 — Correlation Matrix (DO NOT IMPLEMENT HERE)
 * ---------------------------------------------------------------------------
 * After family diversity, optionally reject cross-family pairs that are still
 * strongly dependent, e.g.:
 *   - 1X2 Home Win + Double Chance 1X
 *   - Over 2.5 Goals + BTTS Yes
 *   - Under 2.5 Goals + BTTS No
 *   - Goals total + Team Goals (when that slot exists)
 *
 * Integration without touching PredictorV3 / recommendation engine / odds:
 *   - Keep listSpecialBetCandidates() and MarketFamilyKey as-is.
 *   - Add a pure `areStronglyCorrelated(a, b): boolean` table in this module
 *     (or a sibling `specialBetCorrelation.ts`) keyed by family + pick shape.
 *   - Inside pickSpecialBetLegs, after the family check, also skip a candidate
 *     when it correlates with any already-selected leg.
 *   - UI continues to only render pickSpecialBetLegs output — no component
 *     filtering. Probabilities / confidence / odds stay read-only inputs.
 */
export function pickSpecialBetLegs(candidates: SpecialBetLeg[], legCount: 2 | 3): SpecialBetLeg[] {
  const ranked = [...candidates].sort(compareSpecialBetCandidates);
  const usedFamilies = new Set<MarketFamilyKey>();

  const base: SpecialBetLeg[] = [];
  for (const candidate of ranked) {
    if (base.length >= legCount) break;
    if (usedFamilies.has(candidate.family)) continue;
    base.push(candidate);
    usedFamilies.add(candidate.family);
  }

  const usedIds = new Set(base.map((l) => l.id));
  const extras: SpecialBetLeg[] = [];
  for (const candidate of ranked) {
    if (extras.length >= MAX_EXTRA_STRONG_LEGS) break;
    if (usedIds.has(candidate.id) || usedFamilies.has(candidate.family)) continue;
    if (candidate.probability < SPECIAL_BET_STRONG_SIGNAL) continue;
    extras.push(candidate);
    usedFamilies.add(candidate.family);
  }

  return [...base, ...extras];
}

/**
 * Build special-bet legs that all contribute to the combined odd.
 * Only legs with bookmaker odds > 1 are included.
 */
export function buildSpecialBetLegs(
  row: PredictionRow,
  labels: SpecialBetLabels,
  legCount: 2 | 3,
  stored?: CardMarketValidations | null,
  marketResults?: PredictionRow["marketResults"] | null
): SpecialBetLeg[] {
  return pickSpecialBetLegs(listSpecialBetCandidates(row, labels, stored, marketResults), legCount);
}

export function specialBetCombinedOdd(legs: SpecialBetLeg[]): number | null {
  if (legs.length < 2) return null;
  const odds = legs.map((l) => Number(l.odd)).filter((n) => Number.isFinite(n) && n > 1);
  if (odds.length !== legs.length || odds.length < 2) return null;
  return odds.reduce((acc, v) => acc * v, 1);
}

/** Combined accumulator tone: win only if every leg won; loss if any lost; else pending/gray. */
export function specialBetCombinedOutcome(legs: SpecialBetLeg[]): MarketOutcome {
  if (!legs.length) return null;
  if (legs.some((l) => l.outcome === "loss")) return "loss";
  if (legs.every((l) => l.outcome === "win")) return "win";
  if (legs.some((l) => l.outcome === "pending" || l.outcome == null)) return "pending";
  return "pending";
}

export { outcomeTextClass };
export type { MarketOutcome };
