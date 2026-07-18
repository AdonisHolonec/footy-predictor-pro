import type { UsageSnapshot } from "../types/index";
import { fetchWithAuth } from "../utils/apiAuth";

export async function loadUsageSnapshot(): Promise<UsageSnapshot> {
  const response = await fetchWithAuth("/api/fixtures?usageOnly=1&usageDays=7");
  const json = await response.json();
  if (!json?.ok) throw new Error(json?.error || "Nu am putut incarca usage.");
  return {
    today: json.usage || { count: 0, limit: 100, updatedAt: null },
    yesterday: json.yesterday || { count: 0, limit: 100, updatedAt: null },
    history: Array.isArray(json.history) ? json.history : [],
    cache: json.cache
      ? {
          date: json.cache.date,
          hits: Number(json.cache.hits) || 0,
          misses: Number(json.cache.misses) || 0,
          inflightJoins: Number(json.cache.inflightJoins) || 0,
          hitRatio: json.cache.hitRatio == null ? null : Number(json.cache.hitRatio),
          processHitRatio: json.cache.processHitRatio == null ? null : Number(json.cache.processHitRatio),
          updatedAt: json.cache.updatedAt ?? null
        }
      : null
  };
}
