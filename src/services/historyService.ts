import { HistoryEntry, HistoryStats } from "../types";

export type LoadHistoryResult = {
  items: HistoryEntry[];
  stats: HistoryStats;
};

export async function loadHistory(
  days = 30,
  options?: { accessToken?: string | null; isAdmin?: boolean }
): Promise<LoadHistoryResult> {
  const qs = new URLSearchParams({ days: String(days), limit: "2000" });
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
