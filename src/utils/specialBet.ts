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
  matchingMarketOdd,
  parseOuSide,
  recommendedOdd,
  resolveFirstHalfGoalsActual,
  shotsDisplayOdd
} from "./marketPicks";

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
  /** Live momentum nudge (Sprint 2), display-only — only ever set on the "recommended" leg. */
  liveAdjustment?: SpecialBetLiveAdjustment | null;
};

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
  const goalsPick = deriveCardGoalsPick(row);
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
      outcome: resolveCardMarketOutcome("goals", enrichedRow, stored)
    },
    {
      id: "gg",
      label: labels.gg,
      pick: ggPick || "",
      probability: ggProbability,
      odd: ggPick ? Number(bttsOddForPick(row, ggPick) ?? NaN) : NaN,
      outcome: ggPick ? gradeGgOutcome(enrichedRow, ggPick) : null
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
      outcome: resolveCardMarketOutcome("corners", enrichedRow, stored)
    },
    {
      id: "shots",
      label: labels.shots,
      pick: shotsPick
        ? `${shotsPick.side === "over" ? "Over" : "Under"} ${shotsPick.line.toFixed(1)}`
        : "",
      probability: Number(shotsPick?.probability || 0),
      odd: shotsPick ? Number(shotsDisplayOdd(row, shotsPick.side, shotsPick.line) ?? NaN) : NaN,
      outcome: resolveCardMarketOutcome("shots", enrichedRow, stored)
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
      })()
    },
    {
      id: "cards",
      label: labels.cards,
      pick: cardsPick?.pick || "",
      probability: Number(cardsPick?.probability || 0),
      odd: cardsPick
        ? Number(matchingMarketOdd(row.marketOdds?.cards, cardsPick.side, cardsPick.line) ?? NaN)
        : NaN,
      outcome: null
    }
  ];

  return pool
    .filter((x) => x.pick && Number.isFinite(x.probability) && x.probability > 0 && hasValidOdd(x.odd))
    .sort((a, b) => b.probability - a.probability);
}

/** Top `legCount` plus up to 2 extra legs with probability ≥ 85%. */
export function pickSpecialBetLegs(candidates: SpecialBetLeg[], legCount: 2 | 3): SpecialBetLeg[] {
  const base = candidates.slice(0, legCount);
  const used = new Set(base.map((l) => l.id));
  const extras = candidates
    .filter((c) => !used.has(c.id) && c.probability >= SPECIAL_BET_STRONG_SIGNAL)
    .slice(0, MAX_EXTRA_STRONG_LEGS);
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
