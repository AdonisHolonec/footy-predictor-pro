/**
 * Health insights (S4).
 *
 * Turns the observability bundle into sentences an operator can act on. The dashboard
 * already renders a dozen raw figures; a number without a reading is a question, not an
 * answer, so every insight here leads with what the figure MEANS and keeps the digits as
 * supporting evidence.
 *
 * Pure and side-effect free on purpose: the judgement calls — what counts as a healthy
 * edge, when a backlog stops being normal — are the part worth testing, and they should
 * not be buried in JSX.
 *
 * Reads only. Nothing here feeds back into predictions, recommendations or settlement.
 */

import type { AlertThresholds, HealthDashboardBundle } from "../types";

export type InsightTone = "good" | "watch" | "bad" | "unknown";

export type InsightFigure = {
  label: string;
  value: string;
};

export type HealthInsight = {
  id: string;
  title: string;
  /** The single number worth leading with, already formatted. */
  headline: string;
  /** One sentence: what this means. Never a restatement of the headline. */
  verdict: string;
  tone: InsightTone;
  figures: InsightFigure[];
};

/**
 * A recommended pick priced against a book carrying its margin should land slightly
 * negative. Far below means the model disagrees with the market in the wrong direction;
 * far above means the claimed edge is too good to be true and usually points at stale odds.
 */
const EDGE_HEALTHY_MIN_PCT = -6;
const EDGE_HEALTHY_MAX_PCT = 3;
const EDGE_SUSPICIOUS_PCT = 10;

/** Above this share, grading falls back to line heuristics often enough to matter. */
const UNKNOWN_FAMILY_WATCH_PCT = 25;

/**
 * Used only until the server's own figures arrive. The authority is `bundle.thresholds`,
 * derived from the alert rule table and already carrying any env override — a card that
 * disagreed with the alert fired on the same number would be worse than no card.
 */
type ResolvedThresholds = { [K in keyof AlertThresholds]: number };

const DEFAULT_THRESHOLDS: ResolvedThresholds = {
  settlementPendingWarn: 5,
  settlementPendingCritical: 20,
  settlementStaleMinutes: 1440,
  snapshotStaleMinutes: 2880,
  benchmarkBacklogWatch: 200,
  predictionFailuresWatch: 3
};

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A published threshold that is missing or unusable falls back rather than poisoning a comparison. */
function thresholdsOf(bundle: HealthDashboardBundle): ResolvedThresholds {
  const published = bundle.thresholds;
  if (!published) return DEFAULT_THRESHOLDS;

  const resolved = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as Array<keyof AlertThresholds>) {
    const value = num(published[key]);
    if (value != null) resolved[key] = value;
  }
  return resolved;
}

function fmtPct(value: number | null | undefined, digits = 1): string {
  const n = num(value);
  return n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function fmtPlainPct(value: number | null | undefined, digits = 1): string {
  const n = num(value);
  return n == null ? "—" : `${n.toFixed(digits)}%`;
}

function fmtCount(value: number | null | undefined): string {
  const n = num(value);
  return n == null ? "—" : String(Math.round(n));
}

function fmtMs(value: number | null | undefined): string {
  const n = num(value);
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

/** Ages are read at a glance, so they degrade to the coarsest useful unit. */
export function fmtAge(minutes: number | null | undefined): string {
  const n = num(minutes);
  if (n == null) return "never";
  if (n < 60) return `${Math.round(n)}m ago`;
  if (n < 2880) return `${Math.round(n / 60)}h ago`;
  return `${Math.round(n / 1440)}d ago`;
}

const UNKNOWN: Pick<HealthInsight, "headline" | "verdict" | "tone" | "figures"> = {
  headline: "—",
  verdict: "No data yet — this fills in once the daily snapshot has run at least once.",
  tone: "unknown",
  figures: []
};

/**
 * Model edge. Reads `recommendedEv`, which grades the pick we actually surface — NOT
 * `valueMarketEv`, which grades the best-value market and is a different bet entirely.
 */
export function buildEdgeInsight(bundle: HealthDashboardBundle): HealthInsight {
  const base = { id: "model_edge", title: "Model edge" };
  const prediction = bundle.snapshot?.prediction;
  const ev = prediction?.recommendedEv;
  const median = num(ev?.median);

  if (!ev || median == null) return { ...base, ...UNKNOWN };

  const p25 = num(ev.p25);
  const p75 = num(ev.p75);
  const figures: InsightFigure[] = [
    {
      label: "Typical range",
      value: p25 != null && p75 != null ? `${fmtPct(p25)} to ${fmtPct(p75)}` : "—"
    },
    { label: "Below zero", value: fmtPlainPct(ev.negativePct, 0) },
    { label: "Avg confidence", value: fmtPlainPct(prediction?.avgConfidence, 0) },
    { label: "Avg odds", value: num(prediction?.avgOdds)?.toFixed(2) ?? "—" },
    { label: "Picks measured", value: fmtCount(ev.n) }
  ];

  if (median >= EDGE_HEALTHY_MIN_PCT && median <= EDGE_HEALTHY_MAX_PCT) {
    return {
      ...base,
      headline: fmtPct(median, 2),
      tone: "good",
      verdict:
        "Edge on the recommended pick sits just inside the bookmaker's margin — the expected shape for a calibrated model, not a problem to fix.",
      figures
    };
  }

  if (median < EDGE_HEALTHY_MIN_PCT) {
    return {
      ...base,
      headline: fmtPct(median, 2),
      tone: median < EDGE_HEALTHY_MIN_PCT * 2 ? "bad" : "watch",
      verdict:
        "Recommended picks are priced well below the market. Confidence is running ahead of the odds we can actually get.",
      figures
    };
  }

  return {
    ...base,
    headline: fmtPct(median, 2),
    tone: median >= EDGE_SUSPICIOUS_PCT ? "bad" : "watch",
    verdict:
      "Claimed edge is higher than a liquid market usually allows. Check odds freshness before reading this as real value.",
    figures
  };
}

/**
 * Settlement. The number that matters is not "how many rows" but "how many finished
 * fixtures the user still sees as Pending", which is what an ungraded recommended pick
 * looks like on a card.
 */
export function buildSettlementInsight(bundle: HealthDashboardBundle): HealthInsight {
  const base = { id: "settlement", title: "Settlement" };
  const health = bundle.settlementHealth;
  if (!health?.ok) return { ...base, ...UNKNOWN };

  const thresholds = thresholdsOf(bundle);
  const pending = num(health.recommendedStillPending) ?? 0;
  const age = num(health.ageMinutes);
  const unknownFamilyPct = num(bundle.snapshot?.prediction?.unknownFamilyPct);

  const figures: InsightFigure[] = [
    { label: "Last run", value: fmtAge(age) },
    { label: "Finished scanned", value: fmtCount(health.totals?.finishedScanned) },
    { label: "Graded this window", value: fmtCount(health.totals?.recommendedSettled) },
    { label: "Skipped on budget", value: fmtCount(health.totals?.skippedByBudget) },
    { label: "Picks without family", value: fmtPlainPct(unknownFamilyPct, 0) }
  ];

  if (age != null && age >= thresholds.settlementStaleMinutes) {
    return {
      ...base,
      headline: fmtAge(age),
      tone: "bad",
      verdict:
        "The settlement sync has stopped running. Every figure on this card is at least that old, including the backlog.",
      figures
    };
  }

  if (pending === 0) {
    return {
      ...base,
      headline: "0",
      tone: "good",
      verdict: "Every finished fixture has a graded recommended pick. Nothing is stuck showing Pending.",
      figures
    };
  }

  const overWatch = unknownFamilyPct != null && unknownFamilyPct >= UNKNOWN_FAMILY_WATCH_PCT;
  return {
    ...base,
    headline: fmtCount(pending),
    tone:
      pending >= thresholds.settlementPendingCritical
        ? "bad"
        : pending >= thresholds.settlementPendingWarn
          ? "watch"
          : "good",
    verdict:
      pending < thresholds.settlementPendingWarn
        ? `A small tail of ${pending} finished ${pending === 1 ? "fixture is" : "fixtures are"} still ungraded — usually the provider has no stats for that market yet, not a fault on our side.`
        : overWatch
          ? `${pending} finished fixtures show no verdict, and a large share of picks carry no stored market family — grading is falling back to line heuristics.`
          : `${pending} finished fixtures still show no verdict. Each one is a card the user reads as Pending.`,
    figures
  };
}

/**
 * Delivery. A persist failure is the serious entry here: the user was shown a prediction
 * that never reached the database, so it vanishes when they reconnect.
 */
export function buildDeliveryInsight(bundle: HealthDashboardBundle): HealthInsight {
  const base = { id: "delivery", title: "Delivery" };
  const health = bundle.predictionHealth;
  if (!health) return { ...base, ...UNKNOWN };

  const thresholds = thresholdsOf(bundle);
  const generated = num(health.generatedToday) ?? 0;
  const persistFailures =
    (num(health.persistFailures?.history) ?? 0) + (num(health.persistFailures?.ownership) ?? 0);
  const failures = num(health.failures) ?? 0;

  const figures: InsightFigure[] = [
    { label: "Live / cached", value: `${fmtCount(health.servedLive)} / ${fmtCount(health.servedFromCache)}` },
    { label: "Served from cache", value: fmtPlainPct(health.cacheServedPct, 0) },
    { label: "Generation p95", value: fmtMs(health.p95GenerationMs) },
    { label: "Cached response", value: fmtMs(health.avgCachedLatencyMs) },
    { label: "Upstream fallbacks", value: fmtCount(health.upstreamFallbacks) }
  ];

  if (persistFailures > 0) {
    return {
      ...base,
      headline: fmtCount(persistFailures),
      tone: "bad",
      verdict:
        "Predictions were shown to users but failed to save. Those disappear the moment the user reconnects — this outranks every latency figure on the page.",
      figures
    };
  }

  if (failures >= thresholds.predictionFailuresWatch) {
    return {
      ...base,
      headline: fmtCount(failures),
      // The rule table's own escalation for this counter is a little over 3x the warn band.
      tone: failures >= thresholds.predictionFailuresWatch * 3 ? "bad" : "watch",
      verdict: "Prediction requests are failing outright today. Users are seeing errors, not slow results.",
      figures
    };
  }

  if (generated === 0) {
    return {
      ...base,
      headline: "0",
      tone: "unknown",
      verdict: "No predictions served yet today, so there is nothing to read into the latency figures below.",
      figures
    };
  }

  return {
    ...base,
    headline: fmtCount(generated),
    tone: "good",
    verdict: `${generated} predictions delivered today with everything persisted. ${fmtPlainPct(health.cacheServedPct, 0)} came from cache, so most users never waited on the engine.`,
    figures
  };
}

/**
 * Freshness. Answers the question every other card depends on: can these numbers still be
 * trusted? A stopped cron is worse than a bad reading, because a bad reading is at least
 * current.
 */
export function buildFreshnessInsight(bundle: HealthDashboardBundle): HealthInsight {
  const base = { id: "freshness", title: "Data freshness" };
  const thresholds = thresholdsOf(bundle);
  const snapshot = bundle.snapshot;
  const benchmark = bundle.benchmarkHealth;
  const snapshotAge = num(snapshot?.ageMinutes);

  const failingJobs = snapshot?.cron?.failingJobs || [];
  const staleJobs = snapshot?.cron?.staleJobs || [];

  const figures: InsightFigure[] = [
    { label: "Snapshot window", value: snapshot?.windowDays ? `${snapshot.windowDays}d` : "—" },
    { label: "Benchmark coverage", value: fmtPlainPct(benchmark?.coveragePct, 0) },
    { label: "Benchmark backlog", value: fmtCount(benchmark?.backlog) },
    { label: "Last benchmark run", value: fmtAge(benchmark?.ageMinutes) }
  ];

  if (!snapshot) {
    return {
      ...base,
      headline: "—",
      tone: "unknown",
      verdict: "No snapshot has been written yet. The slow-moving cards stay empty until the daily cron runs.",
      figures
    };
  }

  if (failingJobs.length > 0) {
    return {
      ...base,
      headline: fmtAge(snapshotAge),
      tone: "bad",
      verdict: `Scheduled jobs are reporting failure: ${failingJobs.join(", ")}. Treat the other cards as stale until this clears.`,
      figures
    };
  }

  if (staleJobs.length > 0) {
    return {
      ...base,
      headline: fmtAge(snapshotAge),
      tone: "bad",
      verdict: `These jobs have not run in over a day: ${staleJobs.join(", ")}. Something is preventing them from being invoked.`,
      figures
    };
  }

  if (snapshotAge != null && snapshotAge >= thresholds.snapshotStaleMinutes) {
    return {
      ...base,
      headline: fmtAge(snapshotAge),
      tone: "watch",
      verdict: "The snapshot is old enough that the edge and settlement cards may no longer describe today.",
      figures
    };
  }

  const backlog = num(benchmark?.backlog) ?? 0;
  if (backlog >= thresholds.benchmarkBacklogWatch) {
    return {
      ...base,
      headline: fmtAge(snapshotAge),
      tone: "watch",
      verdict: `Snapshot is current, but ${backlog} fixtures are waiting to be benchmarked — accrual is limited by the API budget, not broken.`,
      figures
    };
  }

  return {
    ...base,
    headline: fmtAge(snapshotAge),
    tone: "good",
    verdict: "Every scheduled job ran and succeeded, so the figures on this page describe the current state.",
    figures
  };
}

/** Ordered worst-first so the card that needs attention is the one read first. */
const TONE_RANK: Record<InsightTone, number> = { bad: 0, watch: 1, unknown: 2, good: 3 };

export function buildHealthInsights(bundle: HealthDashboardBundle | null | undefined): HealthInsight[] {
  if (!bundle) return [];
  return [
    buildEdgeInsight(bundle),
    buildSettlementInsight(bundle),
    buildDeliveryInsight(bundle),
    buildFreshnessInsight(bundle)
  ].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}
