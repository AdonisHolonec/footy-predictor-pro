import type { HealthDashboardBundle } from "../types";

export async function loadHealthDashboard(days = 7): Promise<HealthDashboardBundle> {
  const res = await fetch(`/api/backtest?view=health&days=${days}`);
  const json = await res.json();
  if (!json?.ok && json?.status == null) {
    throw new Error(json?.error || "Nu am putut încărca Health Dashboard.");
  }
  return json as HealthDashboardBundle;
}

export async function loadDailyReports(days = 7) {
  const res = await fetch(`/api/backtest?view=health&sub=report&days=${days}`);
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca daily reports.");
  return json;
}
