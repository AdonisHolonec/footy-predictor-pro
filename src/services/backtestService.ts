import { BacktestAnalyticsResponse, BacktestFilters, BacktestKpi, ModelLabBundle } from "../types";

export async function loadKpi(days = 45): Promise<BacktestKpi | null> {
  const res = await fetch(`/api/backtest?view=kpi&days=${days}`);
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca KPI.");
  return json.latest || null;
}

export async function loadModelLab(days = 90): Promise<ModelLabBundle> {
  const res = await fetch(`/api/backtest?view=model-lab&days=${days}`);
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca Model Lab.");
  return json as ModelLabBundle;
}

export type LoadAnalyticsParams = Partial<BacktestFilters> & {
  includeBets?: boolean;
};

function toQuery(params: LoadAnalyticsParams): string {
  const q = new URLSearchParams();
  q.set("view", "analytics");
  if (params.period) q.set("period", String(params.period));
  if (params.days != null) q.set("days", String(params.days));
  if (params.leagueId != null && params.leagueId !== ("" as unknown)) q.set("leagueId", String(params.leagueId));
  if (params.competition) q.set("competition", params.competition);
  if (params.market && params.market !== "all") q.set("market", params.market);
  if (params.side && params.side !== "all") q.set("side", params.side);
  if (params.minConfidence != null && params.minConfidence !== ("" as unknown)) {
    q.set("minConfidence", String(params.minConfidence));
  }
  if (params.maxConfidence != null && params.maxConfidence !== ("" as unknown)) {
    q.set("maxConfidence", String(params.maxConfidence));
  }
  if (params.minOdds != null && params.minOdds !== ("" as unknown)) q.set("minOdds", String(params.minOdds));
  if (params.maxOdds != null && params.maxOdds !== ("" as unknown)) q.set("maxOdds", String(params.maxOdds));
  if (params.requirePositiveEv) q.set("requirePositiveEv", "1");
  if (params.includeBets === false) q.set("includeBets", "0");
  return q.toString();
}

export async function loadAnalytics(params: LoadAnalyticsParams = {}): Promise<BacktestAnalyticsResponse> {
  const res = await fetch(`/api/backtest?${toQuery(params)}`);
  const json = (await res.json()) as BacktestAnalyticsResponse;
  if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca analytics backtest.");
  return json;
}

export function buildAnalyticsExportUrl(params: LoadAnalyticsParams, format: "csv" | "json"): string {
  const q = new URLSearchParams(toQuery(params));
  q.set("format", format);
  q.set("includeBets", "1");
  return `/api/backtest?${q.toString()}`;
}
