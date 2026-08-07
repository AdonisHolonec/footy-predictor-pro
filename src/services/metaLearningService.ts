import { fetchWithAuth } from "../utils/apiAuth";

/**
 * Client for the Meta Learning & Benchmark Intelligence admin views.
 * Mirrors predictionBenchmarkService.ts's conventions (fetchWithAuth + ok-envelope).
 *
 * Sprint 1 exposes Data Health only — coverage and statistical POWER, deliberately no
 * performance verdict. See docs/META_LEARNING_BENCHMARK_INTELLIGENCE.md.
 */

export type MetaReadiness =
  | "insufficient_data"
  | "leaning_possible"
  | "dominant_possible"
  | "no_external_counterpart";

export type MetaCoverage = {
  ourSelections: number;
  ourSettled: number;
  providerSelections: number;
  providerPrimarySelections: number;
  providerSecondarySelections: number;
  benchmarkRows: number;
  /** Share of our settled picks that can be compared against the provider at all. */
  comparabilityPct: number | null;
  noExternalCounterpartPct: number | null;
  agreeNullPct: number | null;
  adviceSourcedPct: number | null;
  providerAbstentionPct: number | null;
  providerPricedCoveragePct: number | null;
  settlementDisagreementsDropped: number;
  teamIdsRecovered: number;
};

export type MetaPower = {
  pairedSettled: number;
  settledPairs: number;
  bothCorrect: number;
  bothWrong: number;
  onlyOursCorrect: number;
  onlyTheirsCorrect: number;
  /** only-ours + only-theirs: the real sample size of any head-to-head claim. */
  discordantN: number;
  pairsPerDay: number | null;
  discordantPerDay: number | null;
  minDiscordantLeaning: number;
  minDiscordantDominant: number;
  readiness: MetaReadiness;
  projectedDaysToLeaning: number | null;
  projectedDaysToDominant: number | null;
};

export type MetaFamilyRow = {
  family: string;
  externallyComparable: boolean;
  ourSelections: number;
  ourSettled: number;
  pairedSettled: number;
  settledPairs: number;
  bothCorrect: number;
  bothWrong: number;
  onlyOursCorrect: number;
  onlyTheirsCorrect: number;
  discordantN: number;
  readiness: MetaReadiness;
  projectedDaysToLeaning: number | null;
  projectedDaysToDominant: number | null;
};

export type MetaDataHealth = {
  window: { days: number; contexts: number };
  coverage: MetaCoverage;
  power: MetaPower;
  byFamily: MetaFamilyRow[];
};

export type MetaDataHealthResponse = {
  ok: boolean;
  days: number;
  modelVersion: string;
  contextVersion: string;
  lastRun: { startedAt: string; finishedAt: string | null; ok: boolean; error: string | null } | null;
  health: MetaDataHealth;
};

async function getJson<T>(url: string, notFoundMessage: string): Promise<T> {
  const res = await fetchWithAuth(url);
  const json = (await res.json()) as T & { ok: boolean; error?: string };
  if (!json?.ok) throw new Error(json?.error || notFoundMessage);
  return json;
}

export async function loadMetaDataHealth(days = 90): Promise<MetaDataHealthResponse> {
  return getJson<MetaDataHealthResponse>(
    `/api/backtest?view=meta-data-health&days=${days}`,
    "Could not load meta-learning data health."
  );
}
