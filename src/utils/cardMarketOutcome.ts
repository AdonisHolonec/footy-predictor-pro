import type { CardMarketValidations, PredictionRow } from "../types";
import { deriveAlignedOuPick, deriveCardGoalsPick } from "./marketPicks";

export type CardMarketId = "recommended" | "goals" | "corners" | "shots";
export type MarketOutcome = "win" | "loss" | "pending" | null;

const FINAL = new Set(["FT", "AET", "PEN"]);

export function isFinalMatchStatus(status?: string): boolean {
  return FINAL.has(String(status || "").toUpperCase());
}

function gradeOu(side: "over" | "under", line: number, total: number | null): MarketOutcome {
  if (total == null || !Number.isFinite(total)) return "pending";
  const ok = side === "over" ? total > line : total < line;
  return ok ? "win" : "loss";
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
  if (fromStore === "win" || fromStore === "loss") return fromStore;

  // The recommended pick is NEVER graded client-side. Its market family lives only on the
  // server (`recommended.family` + the fixture totals needed to settle Corners/Shots/Cards),
  // so any local fallback has to guess it from the pick string — which is exactly how a
  // Corners "Over 7.5" came to be graded against goals scored and rendered LOSE while the
  // Corners tile rendered WIN. Render whatever the server persisted, or nothing.
  if (marketId === "recommended") return fromStore;

  if (!isFinalMatchStatus(row.status)) {
    return fromStore === "pending" ? "pending" : null;
  }

  if (marketId === "goals") {
    const goals = deriveCardGoalsPick(row);
    if (!goals) return null;
    const home = row.score?.home;
    const away = row.score?.away;
    if (home == null || away == null) return "pending";
    const total = Number(home) + Number(away);
    if (!Number.isFinite(total)) return "pending";
    return gradeOu(goals.side, goals.line, total);
  }

  if (marketId === "corners") {
    const corners = row.probs?.corners
      ? deriveAlignedOuPick(row.probs.corners.total, row.marketOdds?.corners)
      : null;
    if (!corners) return null;
    const total = row.marketResults?.cornersTotal;
    if (total == null || !Number.isFinite(Number(total))) return fromStore === "pending" ? "pending" : "pending";
    return gradeOu(corners.side, corners.line, Number(total));
  }

  if (marketId === "shots") {
    const shots = row.probs?.shotsOnTarget
      ? deriveAlignedOuPick(row.probs.shotsOnTarget.total, row.marketOdds?.shotsOnTarget)
      : null;
    if (!shots) return null;
    const total = row.marketResults?.shotsOnTargetTotal;
    if (total == null || !Number.isFinite(Number(total))) return "pending";
    return gradeOu(shots.side, shots.line, Number(total));
  }

  return fromStore === "pending" ? "pending" : null;
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
