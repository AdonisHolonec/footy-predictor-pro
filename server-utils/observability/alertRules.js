/**
 * Alert rules (S5).
 *
 * Every threshold the ops layer reacts to, declared once. Before this module the numbers
 * lived inline inside buildOpsAlerts, which made two things impossible: seeing the whole
 * escalation policy at a glance, and keeping the dashboard's reading of a figure in step
 * with the alert fired on the same figure.
 *
 * A rule is data, not code: it names the value it watches, the bands that escalate it, and
 * the sentence it produces. The evaluator is the only thing that knows how to run them.
 *
 * This module changes no thresholds. It is a move, not a retune — the messages, levels,
 * ordering and severity it produces are identical to the inline version it replaces, which
 * is what tests/alertRules.test.js pins.
 */

/** Levels are the existing alert vocabulary; `low` is informational and never escalates. */
const LEVEL_RANK = { low: 1, medium: 2, high: 3 };

/**
 * Subsystem status is the Healthy/Warning/Critical rollup. `low` deliberately maps to
 * healthy: a benchmark backlog is worth mentioning, not worth colouring a subsystem.
 */
const LEVEL_TO_STATUS = { low: "healthy", medium: "warning", high: "critical" };

export const SUBSYSTEMS = [
  "prediction",
  "api",
  "cache",
  "settlement",
  "benchmark",
  "persistence",
  "snapshot",
  "cron",
  "infrastructure"
];

function envInt(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function quotaSoftPct() {
  return Math.max(50, Math.min(envInt("API_BUDGET_SOFT_PCT", 80), 99));
}

function quotaHardPct() {
  return Math.max(quotaSoftPct(), Math.min(envInt("API_BUDGET_HARD_PCT", 95), 100));
}

/**
 * Rule order is the order alerts appear in the dashboard list, so it is part of the
 * contract rather than an implementation detail.
 *
 * @typedef {object} AlertRule
 * @property {string} id
 * @property {string} subsystem
 * @property {(ctx: object) => number|null} value  Null means "not measurable", never zero.
 * @property {(ctx: object) => boolean} [applies]  Precondition beyond the threshold.
 * @property {"above"|"below"} [direction]         Default "above".
 * @property {Array|(() => Array)} bands           Ascending; the last match wins.
 * @property {(value: number, ctx: object) => string} message
 */

/** @type {AlertRule[]} */
export const ALERT_RULES = [
  {
    id: "prediction_failures",
    subsystem: "prediction",
    value: (ctx) => num(ctx.metrics?.failures?.prediction) ?? 0,
    bands: [
      { at: 3, level: "medium" },
      { at: 10, level: "high" }
    ],
    message: (value) => `Prediction failures today: ${value}`
  },
  {
    id: "api_failures",
    subsystem: "api",
    value: (ctx) => num(ctx.metrics?.failures?.api) ?? 0,
    bands: [
      { at: 5, level: "medium" },
      { at: 20, level: "high" }
    ],
    message: (value) => `Upstream API failures today: ${value}`
  },
  {
    id: "cache_failures",
    subsystem: "cache",
    value: (ctx) => num(ctx.metrics?.failures?.cache) ?? 0,
    bands: [
      { at: 3, level: "medium" },
      { at: 10, level: "high" }
    ],
    message: (value) => `Cache failures today: ${value}`
  },
  {
    id: "predict_error_rate",
    subsystem: "prediction",
    // A handful of requests can swing a rate to 100%, so the sample floor comes first.
    applies: (ctx) => (num(ctx.metrics?.routes?.predict?.count) ?? 0) >= 5,
    value: (ctx) => num(ctx.metrics?.routes?.predict?.errorRate),
    bands: [
      { at: 0.15, level: "medium" },
      { at: 0.35, level: "high" }
    ],
    message: (value, ctx) =>
      `Predict error rate ${(value * 100).toFixed(0)}% (n=${ctx.metrics.routes.predict.count})`
  },
  {
    id: "predict_latency",
    subsystem: "prediction",
    value: (ctx) => num(ctx.metrics?.routes?.predict?.p95Ms) ?? 0,
    bands: [{ at: 20000, level: "medium" }],
    message: (value) => `Predict p95 latency ${Math.round(value)}ms`
  },
  {
    id: "api_latency",
    subsystem: "api",
    value: (ctx) => num(ctx.metrics?.routes?.api?.p95Ms) ?? 0,
    bands: [{ at: 5000, level: "medium" }],
    message: (value) => `Upstream API p95 ${Math.round(value)}ms`
  },
  {
    id: "api_quota",
    subsystem: "api",
    // C10: soft and hard match apiBudgetCircuit, so the alert and the circuit trip together.
    value: (ctx) => (ctx.usage?.limit ? (ctx.usage.count / ctx.usage.limit) * 100 : 0),
    bands: () => [
      { at: quotaSoftPct(), level: "medium" },
      { at: quotaHardPct(), level: "high" }
    ],
    message: (value, ctx) =>
      `API quota ${value.toFixed(0)}% (${ctx.usage.count}/${ctx.usage.limit}) — circuit ${
        value >= quotaHardPct() ? "HARD" : "SOFT"
      }`
  },
  {
    id: "cache_hit_ratio",
    subsystem: "cache",
    applies: (ctx) =>
      ctx.cache?.hitRatio != null && (ctx.cache.hits || 0) + (ctx.cache.misses || 0) >= 20,
    value: (ctx) => num(ctx.cache?.hitRatio),
    direction: "below",
    bands: [{ at: 0.15, level: "medium" }],
    message: (value) => `Cache hit ratio ${(value * 100).toFixed(0)}%`
  },
  {
    id: "settlement_pending",
    subsystem: "settlement",
    // The signal that was missing when a settled Corners pick still showed "no result".
    value: (ctx) => num(ctx.settlement?.recommendedStillPending) ?? 0,
    bands: () => {
      const warn = Math.max(1, envInt("SETTLEMENT_PENDING_WARN", 5));
      return [
        { at: warn, level: "medium" },
        { at: Math.max(warn, envInt("SETTLEMENT_PENDING_CRITICAL", 20)), level: "high" }
      ];
    },
    message: (value) => `Finished fixtures with an ungraded recommended pick: ${value}`
  },
  {
    id: "settlement_stale",
    subsystem: "settlement",
    // A sync that stopped running is worse than one reporting a backlog.
    applies: (ctx) =>
      Boolean(ctx.settlement?.ok) && Number.isFinite(Number(ctx.settlement?.ageMinutes)),
    value: (ctx) => num(ctx.settlement?.ageMinutes),
    bands: () => [{ at: Math.max(60, envInt("SETTLEMENT_STALE_MINUTES", 1440)), level: "high" }],
    message: (value) => `Settlement sync last ran ${Math.round(value / 60)}h ago`
  },
  {
    id: "benchmark_backlog",
    subsystem: "benchmark",
    // A growing backlog means accrual is budget-bound, not that the sweep stopped.
    value: (ctx) => num(ctx.benchmark?.backlog) ?? 0,
    bands: [
      { at: 1, level: "low" },
      { at: 200, level: "medium" }
    ],
    message: (value) => `Benchmark sweep backlog: ${value} unbenchmarked fixtures in window`
  },
  {
    id: "persist_failures",
    subsystem: "persistence",
    // A prediction the user was shown that never reached the database is the
    // ownership/settlement class of bug, so any occurrence fires without a threshold.
    value: (ctx) =>
      (num(ctx.metrics?.counters?.persist_history_failed) ?? 0) +
      (num(ctx.metrics?.counters?.persist_ownership_failed) ?? 0),
    bands: [
      { at: 1, level: "medium" },
      { at: 5, level: "high" }
    ],
    message: (_value, ctx) =>
      `Persist warnings today — history: ${
        num(ctx.metrics?.counters?.persist_history_failed) ?? 0
      }, ownership: ${num(ctx.metrics?.counters?.persist_ownership_failed) ?? 0}`
  },
  {
    id: "ops_snapshot_stale",
    subsystem: "snapshot",
    // A stale snapshot means the slow-moving cards are lying about "today".
    value: (ctx) => num(ctx.snapshot?.ageMinutes),
    bands: [{ at: 2880, level: "medium" }],
    message: (value) => `Health snapshot is ${Math.round(value / 60)}h old`
  },
  {
    id: "cron_failing",
    subsystem: "cron",
    // Cron Health replaces the brief's Queue Health: this system has no queue, so what
    // matters is whether each scheduled job still runs and still succeeds.
    value: (ctx) => (ctx.snapshot?.cron?.failingJobs || []).length,
    bands: [{ at: 1, level: "high" }],
    message: (_value, ctx) =>
      `Cron jobs reporting failure: ${(ctx.snapshot.cron.failingJobs || []).join(", ")}`
  },
  {
    id: "cron_stale",
    subsystem: "cron",
    value: (ctx) => (ctx.snapshot?.cron?.staleJobs || []).length,
    bands: [{ at: 1, level: "medium" }],
    message: (_value, ctx) =>
      `Cron jobs not run in over 24h: ${(ctx.snapshot.cron.staleJobs || []).join(", ")}`
  },
  {
    id: "kv_down",
    subsystem: "infrastructure",
    value: (ctx) => (ctx.checks?.kv?.ok === false ? 1 : 0),
    bands: [{ at: 1, level: "high" }],
    message: () => "KV health check failed"
  },
  {
    id: "supabase_down",
    subsystem: "infrastructure",
    value: (ctx) => (ctx.checks?.supabase?.ok === false ? 1 : 0),
    bands: [{ at: 1, level: "high" }],
    message: () => "Supabase health check failed"
  }
];

/** The threshold a named rule escalates at, read back off the rule itself. */
function bandAt(id, level) {
  const rule = ALERT_RULES.find((r) => r.id === id);
  if (!rule) return null;
  const bands = typeof rule.bands === "function" ? rule.bands() : rule.bands;
  return bands.find((b) => b.level === level)?.at ?? null;
}

/**
 * The subset of thresholds the dashboard needs in order to read a figure the same way the
 * alerting does. Derived from ALERT_RULES rather than restated, so the rule table stays the
 * only place a number is written down — and so env overrides reach the browser, which
 * cannot see process.env.
 *
 * Only thresholds with both an alert and a UI reading appear here. Judgements that exist
 * solely on one side (what counts as a plausible model edge, for instance) stay there.
 */
export function resolveThresholds() {
  return {
    settlementPendingWarn: bandAt("settlement_pending", "medium"),
    settlementPendingCritical: bandAt("settlement_pending", "high"),
    settlementStaleMinutes: bandAt("settlement_stale", "high"),
    snapshotStaleMinutes: bandAt("ops_snapshot_stale", "medium"),
    benchmarkBacklogWatch: bandAt("benchmark_backlog", "medium"),
    predictionFailuresWatch: bandAt("prediction_failures", "medium")
  };
}

/** The highest band the value has crossed, or null when the rule does not fire. */
function matchBand(rule, value) {
  const bands = typeof rule.bands === "function" ? rule.bands() : rule.bands;
  const below = rule.direction === "below";
  let matched = null;
  for (const band of bands) {
    if (below ? value < band.at : value >= band.at) matched = band;
  }
  return matched;
}

/**
 * Run every rule against one context.
 *
 * @param {object} ctx { metrics, usage, cache, checks, settlement, benchmark, snapshot }
 * @returns {{ alerts: Array, severity: string, subsystems: Record<string, string>, thresholds: object }}
 */
export function evaluateAlertRules(ctx = {}) {
  const alerts = [];
  const worstBySubsystem = {};

  for (const rule of ALERT_RULES) {
    if (rule.applies && !rule.applies(ctx)) continue;
    const value = rule.value(ctx);
    if (value == null) continue;

    const band = matchBand(rule, value);
    if (!band) continue;

    alerts.push({ id: rule.id, level: band.level, message: rule.message(value, ctx), value });

    const current = worstBySubsystem[rule.subsystem];
    if (!current || LEVEL_RANK[band.level] > LEVEL_RANK[current]) {
      worstBySubsystem[rule.subsystem] = band.level;
    }
  }

  const severity = alerts.some((a) => a.level === "high")
    ? "high"
    : alerts.some((a) => a.level === "medium")
      ? "medium"
      : "none";

  const subsystems = {};
  for (const name of SUBSYSTEMS) {
    subsystems[name] = worstBySubsystem[name] ? LEVEL_TO_STATUS[worstBySubsystem[name]] : "healthy";
  }

  return { alerts, severity, subsystems, thresholds: resolveThresholds() };
}

export default { ALERT_RULES, evaluateAlertRules, resolveThresholds, SUBSYSTEMS };
