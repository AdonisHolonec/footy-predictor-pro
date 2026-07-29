import { createClient } from "@vercel/kv";

const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.Database_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(60, Math.floor((end.getTime() - now.getTime()) / 1000));
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
  await kv.set(`footy_ops_metrics:${dateISO}`, payload, { ex: secondsUntilUtcMidnight() });
  // Durable history copy (no midnight TTL) for daily reports
  await kv.set(`footy_ops_metrics_history:${dateISO}`, payload);
  return payload;
}

/** Increment a failure counter without counting a full route observation. */
export async function bumpFailure(kind) {
  const failureKind = String(kind || "");
  if (!["prediction", "api", "cache"].includes(failureKind)) return null;
  try {
    const day = await readDay();
    day.failures[failureKind] = Number(day.failures[failureKind] || 0) + 1;
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
  try {
    const day = await readDay();
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
    routes: {
      predict: summarizeChannel(day.routes.predict),
      fixtures: summarizeChannel(day.routes.fixtures),
      api: summarizeChannel(day.routes.api),
      cache: summarizeChannel(day.routes.cache)
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
      const hist = (await kv.get(`footy_ops_metrics_history:${dateISO}`)) || (await kv.get(`footy_ops_metrics:${dateISO}`));
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
