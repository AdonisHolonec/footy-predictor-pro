import type { CardMarketValidations, PredictionRow } from "../types";
import { deriveAlignedOuPick, deriveCardGoalsPick } from "./marketPicks";

export type CardMarketId = "recommended" | "goals" | "corners" | "shots";
export type MarketOutcome = "win" | "loss" | "pending" | null;

const FINAL = new Set(["FT", "AET", "PEN"]);

export function isFinalMatchStatus(status?: string): boolean {
  return FINAL.has(String(status || "").toUpperCase());
}

/**
 * The single Over/Under comparison in the app. Strict on both sides, which is
 * exact for the .5 lines every market here quotes (a total can never equal one).
 */
export function gradeOverUnder(
  side: "over" | "under",
  line: number,
  total: number | null | undefined
): MarketOutcome {
  const value = Number(total);
  if (total == null || !Number.isFinite(value)) return "pending";
  const ok = side === "over" ? value > line : value < line;
  return ok ? "win" : "loss";
}

/** The O/U selection each card market settles, derived once for every surface. */
export function deriveCardMarketPick(
  marketId: Exclude<CardMarketId, "recommended">,
  row: PredictionRow
): { side: "over" | "under"; line: number } | null {
  if (marketId === "goals") return deriveCardGoalsPick(row);
  if (marketId === "corners") {
    return row.probs?.corners ? deriveAlignedOuPick(row.probs.corners.total, row.marketOdds?.corners) : null;
  }
  return row.probs?.shotsOnTarget
    ? deriveAlignedOuPick(row.probs.shotsOnTarget.total, row.marketOdds?.shotsOnTarget)
    : null;
}

/**
 * The official figure a market settles against — the fixture statistics the
 * server hydrates into `marketResults`, or the final score for goals.
 */
export function officialTotalFor(
  marketId: Exclude<CardMarketId, "recommended">,
  row: PredictionRow
): number | null {
  if (marketId === "goals") {
    if (row.score?.home == null || row.score?.away == null) return null;
    const total = Number(row.score.home) + Number(row.score.away);
    return Number.isFinite(total) ? total : null;
  }
  const raw =
    marketId === "corners" ? row.marketResults?.cornersTotal : row.marketResults?.shotsOnTargetTotal;
  const total = Number(raw);
  return raw == null || !Number.isFinite(total) ? null : total;
}

/** Tailwind text color for settled / pending market lines. */
export function outcomeTextClass(outcome: MarketOutcome): string {
  if (outcome === "win") return "text-[var(--fp-success)]";
  if (outcome === "loss") return "text-[var(--fp-danger)]";
  if (outcome === "pending") return "text-[var(--fp-text-muted)]";
  return "text-[var(--fp-text)]";
}

/**
 * Resolve WIN/LOSS for a FocusCard market row.
 * Prefers history `cardMarketValidations` (source of truth for the global counter);
 * falls back to live score / marketResults after FT.
 */
export function resolveCardMarketOutcome(
  marketId: CardMarketId,
  row: PredictionRow,
  stored?: CardMarketValidations | null
): MarketOutcome {
  const fromStore = stored?.[marketId] ?? row.cardMarketValidations?.[marketId] ?? null;

  // The recommended pick is NEVER graded client-side. Its market family lives only on the
  // server (`recommended.family` + the fixture totals needed to settle Corners/Shots/Cards),
  // so any local fallback has to guess it from the pick string — which is exactly how a
  // Corners "Over 7.5" came to be graded against goals scored and rendered LOSE while the
  // Corners tile rendered WIN. Render whatever the server persisted, or nothing.
  if (marketId === "recommended") return fromStore;

  if (!isFinalMatchStatus(row.status)) {
    return fromStore === "pending" ? "pending" : null;
  }

  const pick = deriveCardMarketPick(marketId, row);
  // Nothing to settle against — the persisted verdict is all we have.
  if (!pick) return fromStore;

  // The official total decides, and it OUTRANKS the persisted verdict. That order is
  // the fix for the Special Bet showing LOSE on legs the market tiles showed WIN:
  // `cardMarketValidations` is a cache, written once and never corrected when the
  // fixture statistics land later, while the tiles graded the real total live. A stale
  // cache must not survive contact with the figure it was supposed to summarise.
  const local = gradeOverUnder(pick.side, pick.line, officialTotalFor(marketId, row));
  if (local === "win" || local === "loss") return local;

  // No official total yet: fall back to whatever was persisted.
  if (fromStore === "win" || fromStore === "loss") return fromStore;
  return "pending";
}

export function resolveAllCardMarketOutcomes(
  row: PredictionRow,
  stored?: CardMarketValidations | null
): CardMarketValidations {
  return {
    recommended: resolveCardMarketOutcome("recommended", row, stored),
    goals: resolveCardMarketOutcome("goals", row, stored),
    corners: resolveCardMarketOutcome("corners", row, stored),
    shots: resolveCardMarketOutcome("shots", row, stored)
  };
}
