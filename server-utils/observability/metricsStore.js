import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@vercel/kv";

const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.Database_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}


function emptyChannel() {
  return {
    count: 0,
    errors: 0,
    sumMs: 0,
    maxMs: 0,
    /** Reservoir of recent durations for approx p50/p95 (capped). */
    samples: []
  };
}

function emptyDayMetrics() {
  return {
    date: todayISO(),
    routes: {
      predict: emptyChannel(),
      fixtures: emptyChannel(),
      api: emptyChannel(),
      cache: emptyChannel(),
      lambdaPredictionEngine: emptyChannel(),
      lambdaStrengthRatings: emptyChannel(),
      lambdaStandings: emptyChannel(),
      lambdaPartialStats: emptyChannel(),
      lambdaUefaFallback: emptyChannel(),
      lambdaInsufficientData: emptyChannel()
    },
    failures: {
      prediction: 0,
      api: 0,
      cache: 0
    },
    /**
     * Free-form daily counters (S2). Unlike `failures`, the key set is open so a new
     * signal can be counted without a schema step; days written before S2 read back as
     * {}. Names are namespaced by concern: predict_*, persist_*, api_*.
     */
    counters: {},
    updatedAt: null
  };
}

const SAMPLE_CAP = 48;

function pushSample(samples, ms) {
  const next = Array.isArray(samples) ? samples.slice() : [];
  next.push(Number(ms) || 0);
  if (next.length > SAMPLE_CAP) next.splice(0, next.length - SAMPLE_CAP);
  return next;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarizeChannel(ch) {
  const count = Number(ch?.count) || 0;
  const errors = Number(ch?.errors) || 0;
  const sumMs = Number(ch?.sumMs) || 0;
  const maxMs = Number(ch?.maxMs) || 0;
  const samples = Array.isArray(ch?.samples) ? ch.samples.map(Number).filter((n) => Number.isFinite(n)) : [];
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count,
    errors,
    errorRate: count ? Number((errors / count).toFixed(4)) : 0,
    avgMs: count ? Number((sumMs / count).toFixed(1)) : 0,
    maxMs,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95)
  };
}

async function readDay(dateISO = todayISO()) {
  try {
    const row = await kv.get(`footy_ops_metrics:${dateISO}`);
    if (!row || typeof row !== "object") return emptyDayMetrics();
    const base = emptyDayMetrics();
    base.date = dateISO;
    for (const key of Object.keys(base.routes)) {
      base.routes[key] = { ...emptyChannel(), ...(row.routes?.[key] || {}) };
    }
    base.failures = { ...base.failures, ...(row.failures || {}) };
    base.updatedAt = row.updatedAt || null;
    return base;
  } catch {
    return emptyDayMetrics();
  }
}

async function writeDay(day) {
  const dateISO = day.date || todayISO();
  const payload = { ...day, date: dateISO, updatedAt: new Date().toISOString() };
  // Single durable key per day (date is already in the key) — no midnight TTL,
  // no separate history copy needed.
  await kv.set(`footy_ops_metrics:${dateISO}`, payload);
  return payload;
}

/**
 * Invocation-scoped observation buffer.
 *
 * Every writer below mutates ONE document (`footy_ops_metrics:<date>`) through a
 * read-modify-write. Done per call that is GET+SET each time, and a single cache
 * miss fires four of them — the dominant Redis amplifier this buffer removes.
 *
 * Inside a scope the mutations are collected and applied to one document read,
 * written back once. Outside a scope nothing changes: callers that are not
 * wrapped (a script, a test, a stage invoked directly) keep the original
 * write-through behaviour, so this is additive rather than a migration.
 *
 * AsyncLocalStorage — not a module-level array — because Vercel reuses one
 * instance across CONCURRENT invocations; a shared array would let two requests
 * flush each other's buffers.
 */
const observationScope = new AsyncLocalStorage();

/** Mutations are described, not applied, while buffered. */
function applyObservation(day, { channel, durationMs, ok, failureKind }) {
  const ch = String(channel || "api");
  if (!day.routes[ch]) day.routes[ch] = emptyChannel();
  const bucket = day.routes[ch];
  bucket.count += 1;
  if (!ok) bucket.errors += 1;
  bucket.sumMs += durationMs;
  bucket.maxMs = Math.max(bucket.maxMs, durationMs);
  bucket.samples = pushSample(bucket.samples, durationMs);
  if (!ok && failureKind && day.failures[failureKind] != null) {
    day.failures[failureKind] += 1;
  }
  return day;
}

function applyFailure(day, failureKind) {
  day.failures[failureKind] = Number(day.failures[failureKind] || 0) + 1;
  return day;
}

function applyCounter(day, key, delta) {
  if (!day.counters || typeof day.counters !== "object") day.counters = {};
  day.counters[key] = Number(day.counters[key] || 0) + delta;
  return day;
}

/**
 * Apply everything buffered during one invocation: ONE read, ONE write.
 *
 * Never throws. Observability must not turn a successful product response into a
 * 5xx — the same contract every writer here already honours with its own catch.
 */
async function flushScope(store) {
  if (!store || !store.pending.length) return null;
  const pending = store.pending.splice(0, store.pending.length);

  /*
    Cache counters live in their own hash, so they flush independently of the
    ops document — and crucially they collapse by FIELD, not by observation.
    HINCRBY takes a single field, so a warm invocation that hits the cache 40
    times and misses 35 issues two commands instead of seventy-five.
  */
  const cacheDeltas = new Map();
  for (const m of pending) {
    if (m.kind !== "cacheStat") continue;
    cacheDeltas.set(m.field, (cacheDeltas.get(m.field) || 0) + 1);
  }
  for (const [field, delta] of cacheDeltas) {
    try {
      await kv.hincrby(cacheStatsKey(), field, delta);
    } catch {
      // Non-fatal, same contract as every other writer here.
    }
  }

  // Only the ops document needs the read-modify-write; skip it when an
  // invocation produced nothing but cache counters.
  const dayMutations = pending.filter((m) => m.kind !== "cacheStat");
  if (!dayMutations.length) return null;

  try {
    const day = await readDay();
    for (const m of dayMutations) {
      if (m.kind === "observation") applyObservation(day, m);
      else if (m.kind === "failure") applyFailure(day, m.failureKind);
      else if (m.kind === "counter") applyCounter(day, m.key, m.delta);
    }
    await writeDay(day);
    return day;
  } catch {
    return null;
  }
}

/**
 * Run `fn` with one buffered metrics document, flushed once when it settles.
 *
 * The flush is in `finally`, so it runs on the success path AND when the handler
 * throws — deterministic at the invocation boundary, no timer involved.
 *
 * TRADEOFF: if the runtime kills the invocation before `finally` (an OOM, a hard
 * timeout), that invocation's observations are lost. Bounded to abnormal
 * termination, and nothing in the product path reads these metrics back, so the
 * loss is confined to reporting.
 */
export async function withObservationScope(fn) {
  const store = { pending: [] };
  try {
    return await observationScope.run(store, fn);
  } finally {
    await flushScope(store);
  }
}

/** Exposed for tests: is a buffer currently active? */
export function hasActiveObservationScope() {
  return Boolean(observationScope.getStore());
}

/**
 * The daily cache hit/miss hash. Exported so the reader in fetcher.js and the
 * writer here cannot drift onto different keys.
 */
export function cacheStatsKey(dateISO = todayISO()) {
  return `footy_cache_stats:${dateISO}`;
}

/**
 * One cache hit / miss / in-flight join.
 *
 * `getWithCache` calls this on EVERY lookup, and a single warm invocation
 * makes ~75 of them, so writing straight through cost one HINCRBY per cache
 * read — 3,867 commands on the day this was measured, 38.6% of all Redis
 * traffic, for a counter no product path reads.
 *
 * Buffered inside an invocation scope and summed at the boundary. Outside a
 * scope it still writes immediately, so callers that are not wrapped keep
 * their existing behaviour rather than silently losing counts.
 */
export async function bumpCacheStat(field) {
  if (!field) return;
  const store = observationScope.getStore();
  if (store) {
    store.pending.push({ kind: "cacheStat", field });
    return;
  }
  try {
    await kv.hincrby(cacheStatsKey(), field, 1);
  } catch {
    // non-fatal
  }
}

/** Increment a failure counter without counting a full route observation. */
export async function bumpFailure(kind) {
  const failureKind = String(kind || "");
  if (!["prediction", "api", "cache"].includes(failureKind)) return null;
  const store = observationScope.getStore();
  if (store) {
    store.pending.push({ kind: "failure", failureKind });
    return null;
  }
  try {
    const day = await readDay();
    applyFailure(day, failureKind);
    await writeDay(day);
    return day;
  } catch {
    return null;
  }
}

/**
 * Increment a free-form daily counter (S2).
 *
 * Deliberately open-keyed: the signals it carries — how many predicts were served from
 * the DB cache vs generated live, how many persistence warnings fired — are read off
 * response headers by requestMonitor, so counting them needs no change inside the
 * prediction pipeline. Never throws.
 *
 * @param {string} name Counter key, e.g. "predict_served_cache".
 * @param {number} [by] Increment, default 1.
 */
export async function bumpCounter(name, by = 1) {
  const key = String(name || "").trim();
  if (!key) return null;
  const delta = Number(by);
  if (!Number.isFinite(delta) || delta === 0) return null;
  const store = observationScope.getStore();
  if (store) {
    store.pending.push({ kind: "counter", key, delta });
    return null;
  }
  try {
    const day = await readDay();
    applyCounter(day, key, delta);
    await writeDay(day);
    return day;
  } catch {
    return null;
  }
}

/**
 * Record a timed observation for a metrics channel.
 * @param {"predict"|"fixtures"|"api"|"cache"} channel
 * @param {{ durationMs: number, ok?: boolean, failureKind?: "prediction"|"api"|"cache"|null }} opts
 */
export async function recordObservation(channel, opts = {}) {
  const ch = String(channel || "api");
  const durationMs = Math.max(0, Number(opts.durationMs) || 0);
  const ok = opts.ok !== false;
  const failureKind = opts.failureKind || null;
  const store = observationScope.getStore();
  if (store) {
    store.pending.push({ kind: "observation", channel: ch, durationMs, ok, failureKind });
    return null;
  }
  try {
    const day = await readDay();
    applyObservation(day, { channel: ch, durationMs, ok, failureKind });
    await writeDay(day);
    return day;
  } catch {
    return null;
  }
}

export async function getOpsMetrics(dateISO = todayISO()) {
  const day = await readDay(dateISO);
  return {
    date: day.date,
    updatedAt: day.updatedAt,
    failures: day.failures,
    counters: day.counters && typeof day.counters === "object" ? day.counters : {},
    routes: {
      predict: summarizeChannel(day.routes.predict),
      // Split of `predict` by data source (S2). `predictLive` is the closest thing to
      // "generation time" available without instrumenting the pipeline: a cached predict
      // never enters the fixture loop, so its latency measures a different thing entirely
      // and averaging the two together hides both.
      predictLive: summarizeChannel(day.routes.predictLive),
      predictCached: summarizeChannel(day.routes.predictCached),
      fixtures: summarizeChannel(day.routes.fixtures),
      api: summarizeChannel(day.routes.api),
      cache: summarizeChannel(day.routes.cache),
      lambdaPredictionEngine: summarizeChannel(day.routes.lambdaPredictionEngine),
      lambdaStrengthRatings: summarizeChannel(day.routes.lambdaStrengthRatings),
      lambdaStandings: summarizeChannel(day.routes.lambdaStandings),
      lambdaPartialStats: summarizeChannel(day.routes.lambdaPartialStats),
      lambdaUefaFallback: summarizeChannel(day.routes.lambdaUefaFallback),
      lambdaInsufficientData: summarizeChannel(day.routes.lambdaInsufficientData)
    }
  };
}

export async function getOpsMetricsHistory(days = 7) {
  const safeDays = Math.max(1, Math.min(Number(days) || 7, 30));
  const rows = [];
  for (let i = 0; i < safeDays; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const dateISO = d.toISOString().slice(0, 10);
    try {
      const hist = await kv.get(`footy_ops_metrics:${dateISO}`);
      if (hist && typeof hist === "object") {
        rows.push({
          date: dateISO,
          failures: hist.failures || { prediction: 0, api: 0, cache: 0 },
          routes: {
            predict: summarizeChannel(hist.routes?.predict),
            fixtures: summarizeChannel(hist.routes?.fixtures),
            api: summarizeChannel(hist.routes?.api),
            cache: summarizeChannel(hist.routes?.cache)
          },
          updatedAt: hist.updatedAt || null
        });
      } else {
        rows.push({
          date: dateISO,
          failures: { prediction: 0, api: 0, cache: 0 },
          routes: {
            predict: summarizeChannel(emptyChannel()),
            fixtures: summarizeChannel(emptyChannel()),
            api: summarizeChannel(emptyChannel()),
            cache: summarizeChannel(emptyChannel())
          },
          updatedAt: null
        });
      }
    } catch {
      rows.push({
        date: dateISO,
        failures: { prediction: 0, api: 0, cache: 0 },
        routes: {
          predict: summarizeChannel(emptyChannel()),
          fixtures: summarizeChannel(emptyChannel()),
          api: summarizeChannel(emptyChannel()),
          cache: summarizeChannel(emptyChannel())
        },
        updatedAt: null
      });
    }
  }
  return rows;
}

export async function saveDailyReport(report) {
  const dateISO = report?.date || todayISO();
  const payload = { ...report, date: dateISO, savedAt: new Date().toISOString() };
  try {
    await kv.set(`footy_daily_report:${dateISO}`, payload);
    return payload;
  } catch {
    return null;
  }
}

export async function getDailyReport(dateISO = todayISO()) {
  try {
    return (await kv.get(`footy_daily_report:${dateISO}`)) || null;
  } catch {
    return null;
  }
}

export async function listDailyReports(days = 7) {
  const safeDays = Math.max(1, Math.min(Number(days) || 7, 30));
  const out = [];
  for (let i = 0; i < safeDays; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const dateISO = d.toISOString().slice(0, 10);
    const row = await getDailyReport(dateISO);
    if (row) out.push(row);
  }
  return out;
}
