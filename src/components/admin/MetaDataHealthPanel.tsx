import { useCallback, useEffect, useState } from "react";
import { Card, StatTile, EmptyState, ErrorState, Skeleton } from "../../design-system";
import {
  loadMetaDataHealth,
  type MetaDataHealthResponse,
  type MetaFamilyRow,
  type MetaReadiness
} from "../../services/metaLearningService";

/**
 * Meta Learning — Data Health.
 *
 * Sprint 1 of the Meta Learning & Benchmark Intelligence layer. Reports COVERAGE and
 * STATISTICAL POWER, and deliberately reports no performance verdict: with roughly a
 * one-in-ten comparability ceiling against API-Football, this panel exists to tell an
 * operator whether any future "who is better" claim is answerable yet.
 *
 * Read-only. Nothing shown here affects PredictorV3, the pipeline, the Recommendation
 * Engine or ValueEngine. Layout follows BenchmarkPanel.tsx's conventions.
 */

const READINESS_LABEL: Record<MetaReadiness, string> = {
  insufficient_data: "Insufficient data",
  leaning_possible: "Leaning possible",
  dominant_possible: "Verdict possible",
  no_external_counterpart: "No external counterpart"
};

const READINESS_TONE: Record<MetaReadiness, "success" | "accent" | "neutral" | "danger"> = {
  insufficient_data: "neutral",
  leaning_possible: "accent",
  dominant_possible: "success",
  no_external_counterpart: "neutral"
};

function ReadinessChip({ readiness }: { readiness: MetaReadiness }) {
  const tone = READINESS_TONE[readiness] ?? "neutral";
  const toneClass =
    tone === "success"
      ? "bg-[color-mix(in_srgb,var(--fp-success)_18%,transparent)] text-[var(--fp-success)]"
      : tone === "accent"
        ? "bg-[color-mix(in_srgb,var(--fp-accent)_18%,transparent)] text-[var(--fp-accent)]"
        : "bg-[color-mix(in_srgb,var(--fp-text-muted)_16%,transparent)] text-[var(--fp-text-muted)]";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {READINESS_LABEL[readiness] ?? readiness}
    </span>
  );
}

/** null projection means "unknown" (no accrual observed yet) — never render it as "soon". */
function formatDays(days: number | null): string {
  if (days === 0) return "reached";
  if (days == null) return "unknown";
  if (days > 3650) return "> 10 years";
  return `~${days}d`;
}

function formatPct(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

export default function MetaDataHealthPanel() {
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MetaDataHealthResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadMetaDataHealth(days));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load meta-learning data health.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  const health = data?.health;
  const coverage = health?.coverage;
  const power = health?.power;

  if (!loading && health && coverage && coverage.ourSelections === 0) {
    return (
      <EmptyState
        title="No meta-learning data yet"
        description="Migration 040 may not be applied, or the meta-learning refresh cron (mode=meta-learning-refresh) has not run. It projects existing predictions_history and prediction_benchmarks rows — no upstream API calls."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--fp-text)]">Meta Learning — Data Health</h2>
          <p className="mt-0.5 text-xs text-[var(--fp-text-muted)]">
            Coverage and statistical power only. No performance verdict is shown until a segment has enough
            discordant pairs to support one.
            {data ? ` Scope: ${data.modelVersion} · ${data.contextVersion}` : ""}
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2 py-1 text-xs text-[var(--fp-text)]"
        >
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option>
          <option value={365}>Last 365 days</option>
        </select>
      </div>

      {loading && !health ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-[var(--fp-radius)]" />
          ))}
        </div>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-[var(--fp-text)]">
                Can we answer "who is better" yet?
              </h3>
              {power ? <ReadinessChip readiness={power.readiness} /> : null}
            </div>
            <p className="mt-1 text-xs text-[var(--fp-text-muted)]">
              A head-to-head claim's real sample size is the number of <strong>discordant</strong> pairs — fixtures
              where exactly one side was right. Pairs where both were right or both were wrong carry no information
              about which model is better.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="Discordant pairs"
                value={power ? String(power.discordantN) : "—"}
                hint={
                  power
                    ? `Need ${power.minDiscordantLeaning} for a leaning read, ${power.minDiscordantDominant} for a verdict`
                    : undefined
                }
                loading={loading}
              />
              <StatTile label="Settled paired fixtures" value={power ? String(power.pairedSettled) : "—"} loading={loading} />
              <StatTile
                label="Days to leaning read"
                value={power ? formatDays(power.projectedDaysToLeaning) : "—"}
                hint="Projected from the observed accrual rate in this window"
                loading={loading}
              />
              <StatTile
                label="Days to verdict"
                value={power ? formatDays(power.projectedDaysToDominant) : "—"}
                hint="Projected from the observed accrual rate in this window"
                loading={loading}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Both correct" value={power ? String(power.bothCorrect) : "—"} tone="success" />
              <StatTile label="Both wrong" value={power ? String(power.bothWrong) : "—"} tone="danger" />
              <StatTile label="Only ours correct" value={power ? String(power.onlyOursCorrect) : "—"} tone="accent" />
              <StatTile label="Only API correct" value={power ? String(power.onlyTheirsCorrect) : "—"} />
            </div>
          </Card>

          <Card>
            <h3 className="font-display text-sm font-semibold text-[var(--fp-text)]">Coverage</h3>
            <p className="mt-1 text-xs text-[var(--fp-text-muted)]">
              API-Football covers 1X2, goals over/under and (weakly, from free-text advice) BTTS and Double Chance.
              Corners, cards, shots and correct score have no external counterpart at all — those are reported
              separately below, never counted as misses.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="Comparability"
                value={formatPct(coverage?.comparabilityPct ?? null)}
                hint="Share of our settled picks that can be compared at all"
                loading={loading}
              />
              <StatTile
                label="No counterpart"
                value={formatPct(coverage?.noExternalCounterpartPct ?? null)}
                hint="Our picks in families API-Football does not cover"
                loading={loading}
              />
              <StatTile
                label="Provider abstentions"
                value={formatPct(coverage?.providerAbstentionPct ?? null)}
                hint="Fixtures where API-Football expressed no usable opinion (incl. the 33/33/33 no-data sentinel)"
                loading={loading}
              />
              <StatTile
                label="Advice-sourced"
                value={formatPct(coverage?.adviceSourcedPct ?? null)}
                hint="Provider picks parsed from free-text advice — excluded from verdicts by default"
                loading={loading}
              />
              <StatTile
                label="Not comparable (agree = null)"
                value={formatPct(coverage?.agreeNullPct ?? null)}
                hint="Benchmark rows with no comparable family or a mismatched O/U line"
                loading={loading}
              />
              <StatTile
                label="Provider price coverage"
                value={formatPct(coverage?.providerPricedCoveragePct ?? null)}
                hint="API-Football publishes no odds; its selections are priced counterfactually at the market odds we recorded"
                loading={loading}
              />
              <StatTile
                label="Our settled picks"
                value={coverage ? String(coverage.ourSettled) : "—"}
                loading={loading}
              />
              <StatTile
                label="Settlement conflicts dropped"
                value={coverage ? String(coverage.settlementDisagreementsDropped) : "—"}
                hint="Pairs where stored validation and re-grading disagreed — excluded rather than guessed"
                loading={loading}
                tone={coverage && coverage.settlementDisagreementsDropped > 0 ? "danger" : "neutral"}
              />
            </div>
          </Card>

          <Card>
            <h3 className="font-display text-sm font-semibold text-[var(--fp-text)]">By market family</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="text-[var(--fp-text-muted)]">
                    <th className="pb-2 pr-4 font-semibold">Family</th>
                    <th className="pb-2 pr-4 font-semibold">Our picks</th>
                    <th className="pb-2 pr-4 font-semibold">Settled</th>
                    <th className="pb-2 pr-4 font-semibold">Paired</th>
                    <th className="pb-2 pr-4 font-semibold">Discordant</th>
                    <th className="pb-2 pr-4 font-semibold">To verdict</th>
                    <th className="pb-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {!health?.byFamily?.length ? (
                    <tr>
                      <td colSpan={7} className="py-3 text-[var(--fp-text-muted)]">
                        No projected selections in this window yet.
                      </td>
                    </tr>
                  ) : (
                    health.byFamily.map((row: MetaFamilyRow) => (
                      <tr
                        key={row.family}
                        className={`border-t border-[var(--fp-border)] ${
                          row.externallyComparable ? "" : "opacity-60"
                        }`}
                      >
                        <td className="py-2 pr-4 font-medium text-[var(--fp-text)]">{row.family}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.ourSelections}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.ourSettled}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.pairedSettled}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.discordantN}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          {row.externallyComparable ? formatDays(row.projectedDaysToDominant) : "—"}
                        </td>
                        <td className="py-2">
                          <ReadinessChip readiness={row.readiness} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {data?.lastRun ? (
            <Card>
              <h3 className="font-display text-sm font-semibold text-[var(--fp-text)]">Last refresh</h3>
              <p className="mt-1 text-xs text-[var(--fp-text-muted)]">
                {data.lastRun.ok ? "Succeeded" : "Failed"} · started {new Date(data.lastRun.startedAt).toLocaleString()}
                {data.lastRun.finishedAt
                  ? ` · finished ${new Date(data.lastRun.finishedAt).toLocaleTimeString()}`
                  : ""}
                {data.lastRun.error ? ` · ${data.lastRun.error}` : ""}
              </p>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
