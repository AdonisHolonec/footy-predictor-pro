/**
 * Closing Line Value report aggregates (authenticated / admin / cron only).
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(vals) {
  const a = vals.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function mean(vals) {
  const a = vals.filter((x) => Number.isFinite(x));
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function monthKey(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "unknown";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * @param {Array<{
 *   clvPct?: number|null,
 *   odd?: number|null,
 *   closingOdd?: number|null,
 *   leagueId?: number|string|null,
 *   market?: string|null,
 *   modelVersion?: string|null,
 *   kickoffAt?: string|null,
 *   settled?: boolean
 * }>} events
 */
export function buildClvReport(events) {
  const rows = Array.isArray(events) ? events : [];
  const settled = rows.filter((e) => e && (e.settled !== false));
  const withClv = settled.filter((e) => e.clvPct != null && Number.isFinite(Number(e.clvPct)));
  const clvVals = withClv.map((e) => Number(e.clvPct));
  const positive = clvVals.filter((v) => v > 0).length;

  const group = (keyFn) => {
    const map = new Map();
    for (const e of withClv) {
      const key = String(keyFn(e) ?? "unknown");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(Number(e.clvPct));
    }
    return Array.from(map.entries())
      .map(([key, vals]) => ({
        key,
        n: vals.length,
        avgClv: mean(vals) != null ? Number(mean(vals).toFixed(3)) : null,
        medianClv: median(vals) != null ? Number(median(vals).toFixed(3)) : null,
        positivePct: vals.length ? Number(((vals.filter((v) => v > 0).length / vals.length) * 100).toFixed(1)) : null
      }))
      .sort((a, b) => b.n - a.n);
  };

  const coverage = settled.length ? withClv.length / settled.length : 0;

  return {
    ok: true,
    settled: settled.length,
    withClosing: withClv.length,
    coverage: Number((coverage * 100).toFixed(1)),
    avgClv: mean(clvVals) != null ? Number(mean(clvVals).toFixed(3)) : null,
    medianClv: median(clvVals) != null ? Number(median(clvVals).toFixed(3)) : null,
    positiveClvPct: clvVals.length ? Number(((positive / clvVals.length) * 100).toFixed(1)) : null,
    byLeague: group((e) => e.leagueId ?? "unknown"),
    byMarket: group((e) => e.market || "recommended"),
    byModel: group((e) => e.modelVersion || "unknown"),
    byMonth: group((e) => monthKey(e.kickoffAt))
  };
}

/** Derive CLV% from opening/staked odd vs closing odd. */
export function computeClvPct(stakedOdd, closingOdd) {
  const o = num(stakedOdd);
  const c = num(closingOdd);
  if (o == null || c == null || o <= 1 || c <= 1) return null;
  return Number((((o / c) - 1) * 100).toFixed(3));
}
