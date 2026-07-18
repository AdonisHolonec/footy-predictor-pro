import type { UsageSnapshot } from "../types/index";

export async function loadUsageSnapshot(): Promise<UsageSnapshot> {
  const response = await fetch("/api/fixtures?usageOnly=1&usageDays=7");
  const json = await response.json();
  if (!json?.ok) throw new Error(json?.error || "Nu am putut incarca usage.");
  return {
    today: json.usage || { count: 0, limit: 100, updatedAt: null },
    yesterday: json.yesterday || { count: 0, limit: 100, updatedAt: null },
    history: Array.isArray(json.history) ? json.history : []
  };
}
