import type { CardMarketValidations, PredictionRow } from "../types";
import { deriveBestOverUnderPick, deriveCardGoalsPick } from "./marketPicks";

export type CardMarketId = "recommended" | "goals" | "corners" | "shots";
export type MarketOutcome = "win" | "loss" | "pending" | null;

const FINAL = new Set(["FT", "AET", "PEN"]);

export function isFinalMatchStatus(status?: string): boolean {
  return FINAL.has(String(status || "").toUpperCase());
}

function evaluateTopPick(
  pick: string | undefined,
  score?: { home: number | null; away: number | null } | null
): boolean | null {
  if (!pick || !score) return null;
  if (score.home === null || score.away === null) return null;
  const home = Number(score.home);
  const away = Number(score.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const total = home + away;
  const normalized = String(pick).trim().toLowerCase();
  if (normalized === "1") return home > away;
  if (normalized === "2") return away > home;
  if (normalized === "x") return home === away;
  if (normalized === "1x") return home >= away;
  if (normalized === "12") return home !== away;
  if (normalized === "x2") return away >= home;
  if (normalized === "gg") return home > 0 && away > 0;
  if (normalized === "ngg") return home === 0 || away === 0;
  const overMatch = normalized.match(/^(?:peste|over)\s*(\d+(?:[.,]\d+)?)/);
  if (overMatch) return total > Number(overMatch[1].replace(",", "."));
  const underMatch = normalized.match(/^(?:sub|under)\s*(\d+(?:[.,]\d+)?)/);
  if (underMatch) return total < Number(underMatch[1].replace(",", "."));
  return null;
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

  if (!isFinalMatchStatus(row.status)) {
    return fromStore === "pending" ? "pending" : null;
  }

  if (marketId === "recommended") {
    const result = evaluateTopPick(row.recommended?.pick, row.score);
    if (result === true) return "win";
    if (result === false) return "loss";
    return "pending";
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
    const corners = row.probs?.corners ? deriveBestOverUnderPick(row.probs.corners.total) : null;
    if (!corners) return null;
    const total = row.marketResults?.cornersTotal;
    if (total == null || !Number.isFinite(Number(total))) return fromStore === "pending" ? "pending" : "pending";
    return gradeOu(corners.side, corners.line, Number(total));
  }

  if (marketId === "shots") {
    const shots = row.probs?.shotsOnTarget ? deriveBestOverUnderPick(row.probs.shotsOnTarget.total) : null;
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
