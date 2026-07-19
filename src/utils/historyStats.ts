import type { HistoryEntry, HistoryStats } from "../types";

const MARKET_KEYS = ["recommended", "goals", "corners", "shots"] as const;

/** Per-fixture market outcomes for the success-rate counter (card rows). */
export function listCardMarketOutcomes(
  entry: HistoryEntry
): Array<"pending" | "win" | "loss"> {
  const stored = entry.cardMarketValidations;
  if (stored && typeof stored === "object") {
    const out: Array<"pending" | "win" | "loss"> = [];
    for (const key of MARKET_KEYS) {
      const v = stored[key];
      if (v === "win" || v === "loss" || v === "pending") out.push(v);
    }
    if (out.length) return out;
  }
  // Legacy: one outcome per fixture from recommended validation.
  if (entry.validation === "win" || entry.validation === "loss" || entry.validation === "pending") {
    return [entry.validation];
  }
  return [];
}

export function tallyEntryCardMarkets(entry: HistoryEntry): {
  wins: number;
  losses: number;
  pending: number;
} {
  let wins = 0;
  let losses = 0;
  let pending = 0;
  for (const v of listCardMarketOutcomes(entry)) {
    if (v === "win") wins += 1;
    else if (v === "loss") losses += 1;
    else pending += 1;
  }
  return { wins, losses, pending };
}

export function historyStatsFromRows(rows: HistoryEntry[]): HistoryStats {
  let wins = 0;
  let losses = 0;
  for (const row of rows || []) {
    const t = tallyEntryCardMarkets(row);
    wins += t.wins;
    losses += t.losses;
  }
  const settled = wins + losses;
  return { wins, losses, settled, winRate: settled ? (wins / settled) * 100 : 0 };
}
