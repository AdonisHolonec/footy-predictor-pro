import { HistoryEntry, HistoryStats } from "../types";

export type LoadHistoryResult = {
  items: HistoryEntry[];
  stats: HistoryStats;
};

/**
 * The observatory history read — opt-in to the light `?view=list` projection.
 *
 * This caller was the last one still on the FULL default. Measured in
 * production on the admin-global branch: 190 rows, 60,406,830 bytes, and a
 * `dbReadMs` past `statement_timeout` — for a surface that renders a scoreline,
 * a badge and a win/loss tally. The document was never read here:
 * `useAppController` is the only importer, and its `history` state reaches only
 * `usePerformanceTracker` and `historyStats`, neither of which touches `probs`,
 * `valueEngine`, `confidenceEngine`, `marketOdds`, `teamContext`,
 * `featureImportance`, `momentum` or `explanation`.
 *
 * Prediction hydration is NOT this path. `usePredictionsCache` asks for
 * `view=prediction-list`, and `hasLegacyPredictionShape` runs against `preds`,
 * never against this `history` — so narrowing here cannot re-arm the rehydrate.
 *
 * The server default stays FULL; only this client opts in. `view=list` reaches
 * `readPredictionsHistoryList` (admin-global) or
 * `readPredictionsHistoryListForUser` (`mine=1`), both column-only. The
 * anonymous branch serves aggregate stats regardless of `view`, so this is a
 * no-op there.
 */
export async function loadHistory(
  days = 30,
  options?: { accessToken?: string | null; isAdmin?: boolean }
): Promise<LoadHistoryResult> {
  const qs = new URLSearchParams({ days: String(days), limit: "2000", view: "list" });
  const headers: Record<string, string> = {};
  if (options?.accessToken) {
    // Admin observatory should default to global history (all users), not only personal picks.
    if (!options.isAdmin) qs.set("mine", "1");
    headers.Authorization = `Bearer ${options.accessToken}`;
  }
  const res = await fetch(`/api/history?${qs.toString()}`, { headers });
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca istoricul.");
  return {
    items: Array.isArray(json.items) ? json.items : [],
    stats: json.stats || { wins: 0, losses: 0, settled: 0, winRate: 0 }
  };
}
