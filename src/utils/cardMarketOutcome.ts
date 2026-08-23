import type { CardMarketValidations, PredictionRow, SettlementOutcome } from "../types";
import { deriveAlignedOuPick, deriveCardGoalsPick } from "./marketPicks";

export type CardMarketId = "recommended" | "goals" | "corners" | "shots" | "cards";
export type MarketOutcome = SettlementOutcome | null;

const FINAL = new Set(["FT", "AET", "PEN"]);

export function isFinalMatchStatus(status?: string): boolean {
  return FINAL.has(String(status || "").toUpperCase());
}

/** A settled (non-pending) outcome the UI can render as final. */
export function isSettledOutcome(outcome: MarketOutcome): boolean {
  return (
    outcome === "win" ||
    outcome === "loss" ||
    outcome === "push" ||
    outcome === "half_win" ||
    outcome === "half_loss"
  );
}

/**
 * The single Over/Under comparison in the app, with full Asian semantics.
 * Client-side mirror of server-utils/asianTotals.js `settleOuAsian` (kept in
 * sync by tests; src/ never imports server-utils):
 *   integer line — actual == line settles as "push" (stake returned)
 *   half line    — strict over/under, no push (unchanged behaviour)
 *   quarter line — 50/50 split over the neighbouring integer + half components;
 *                  a push on one component yields "half_win" / "half_loss"
 */
export function gradeOverUnder(
  side: "over" | "under",
  line: number,
  total: number | null | undefined
): MarketOutcome {
  const value = Number(total);
  if (total == null || !Number.isFinite(value)) return "pending";
  const q = Math.round(line * 4);
  if (!Number.isFinite(line) || Math.abs(line * 4 - q) > 1e-9) return "pending";
  const components = q % 2 === 0 ? [q / 4] : [q / 4 - 0.25, q / 4 + 0.25];

  const settle = (component: number): "win" | "loss" | "push" => {
    if (value === component) return "push"; // only reachable on integer components
    if (side === "over") return value > component ? "win" : "loss";
    return value < component ? "win" : "loss";
  };
  const outcomes = components.map(settle);
  if (outcomes.length === 1) return outcomes[0];
  const [a, b] = outcomes;
  if (a === b) return a;
  return a === "win" || b === "win" ? "half_win" : "half_loss";
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
  if (marketId === "cards") {
    return row.probs?.cards ? deriveAlignedOuPick(row.probs.cards.total, row.marketOdds?.cards) : null;
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
  // Each family reads its own total — cards is the raw count (yellow + red), never cardsPoints.
  const raw =
    marketId === "corners"
      ? row.marketResults?.cornersTotal
      : marketId === "cards"
        ? row.marketResults?.cardsTotal
        : row.marketResults?.shotsOnTargetTotal;
  const total = Number(raw);
  return raw == null || !Number.isFinite(total) ? null : total;
}

/** Tailwind text color for settled / pending market lines. */
export function outcomeTextClass(outcome: MarketOutcome): string {
  if (outcome === "win" || outcome === "half_win") return "text-[var(--fp-success)]";
  if (outcome === "loss" || outcome === "half_loss") return "text-[var(--fp-danger)]";
  // Push reads as "stake returned" — informational, neither success nor danger.
  if (outcome === "push") return "text-[var(--fp-text-muted)]";
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
  if (isSettledOutcome(local)) return local;

  // No official total yet: fall back to whatever was persisted.
  if (isSettledOutcome(fromStore)) return fromStore;
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
    shots: resolveCardMarketOutcome("shots", row, stored),
    cards: resolveCardMarketOutcome("cards", row, stored)
  };
}
