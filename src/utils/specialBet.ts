import type { CardMarketValidations, PredictionRow } from "../types";
import {
  outcomeTextClass,
  resolveCardMarketOutcome,
  type CardMarketId,
  type MarketOutcome
} from "./cardMarketOutcome";
import {
  deriveAlignedOuPick,
  matchingMarketOdd,
  recommendedOdd
} from "./marketPicks";

export type SpecialBetLeg = {
  id: CardMarketId | "ht";
  label: string;
  pick: string;
  probability: number;
  odd: number;
  outcome: MarketOutcome;
};

function hasValidOdd(n: unknown): n is number {
  const v = Number(n);
  return Number.isFinite(v) && v > 1;
}

/**
 * Build special-bet legs that all contribute to the combined odd.
 * Only legs with bookmaker odds > 1 are included (so displayed product matches listed picks).
 */
export function buildSpecialBetLegs(
  row: PredictionRow,
  labels: { main: string; corners: string; shots: string; ht: string },
  legCount: 2 | 3,
  stored?: CardMarketValidations | null,
  marketResults?: PredictionRow["marketResults"] | null
): SpecialBetLeg[] {
  const conf = Number(row.recommended?.confidence);
  const confPct = Number.isFinite(conf) ? conf : 0;
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

  const enrichedRow: PredictionRow = {
    ...row,
    marketResults: marketResults ?? row.marketResults
  };

  const candidates: SpecialBetLeg[] = [
    {
      id: "recommended",
      label: labels.main,
      pick: row.recommended?.pick || "",
      probability: confPct,
      odd: Number(recommendedOdd(row)),
      outcome: resolveCardMarketOutcome("recommended", enrichedRow, stored)
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
      odd: shotsPick
        ? Number(
            matchingMarketOdd(row.marketOdds?.shotsOnTarget, shotsPick.side, shotsPick.line) ??
              row.marketOdds?.shotsOnTarget?.odd ??
              NaN
          )
        : NaN,
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
      outcome: (() => {
        if (!firstHalfPick) return null;
        if (!["FT", "AET", "PEN"].includes(String(row.status || "").toUpperCase())) return null;
        const ht = enrichedRow.marketResults?.firstHalfGoals;
        if (ht == null || !Number.isFinite(Number(ht))) return "pending";
        const ok =
          firstHalfPick.side === "over"
            ? Number(ht) > firstHalfPick.line
            : Number(ht) < firstHalfPick.line;
        return ok ? "win" : "loss";
      })()
    }
  ]
    .filter((x) => x.pick && Number.isFinite(x.probability) && x.probability > 0 && hasValidOdd(x.odd))
    .sort((a, b) => b.probability - a.probability);

  return candidates.slice(0, legCount);
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
