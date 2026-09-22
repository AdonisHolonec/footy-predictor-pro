/**
 * Live Predictor Lab — Phase 1: the coverage ledger.
 *
 * The ledger is DERIVED AT READ TIME from the capture store; nothing is written for
 * it. A maintained aggregate would need a read-modify-write per poll — the dominant
 * Redis amplifier this project already removed once — and it would lose updates
 * whenever two instances captured at the same moment, under-reporting coverage. The
 * snapshots ARE the record, so the ledger cannot disagree with them.
 *
 * Reads cost KV commands too (one per day set, one per fixture hash), but only when
 * an admin or the cron secret asks — never on the live path.
 *
 * MISSING STAYS MISSING. A window nobody observed is reported as not covered. Nothing
 * here interpolates, back-fills or infers a snapshot that was not taken.
 *
 * WHY A GAP HAPPENED is reported only where it is knowable:
 *   · a stored snapshot says what its statistics request did (statsStatus/statsReason)
 *   · the sampled counters say how often a poll was stale, denied by the budget
 *     circuit, malformed, or failed to store
 *   · an empty stretch with no evidence is `unobserved` — capture rides on
 *     user-driven polling, so "nobody was watching" is the honest default, never
 *     "the provider had no data"
 */
import {
  COVERAGE_WINDOWS,
  FINAL_STATUSES,
  coverageWindowForMinute,
  maxFieldsPerFixture,
  snapshotHasStats
} from "./liveCaptureSnapshot.js";
import {
  LIVE_CAPTURE_COUNTERS,
  liveCaptureCountersKey,
  liveCaptureDayKey,
  liveCaptureFixtureKey,
  readLiveCaptureConfig
} from "./liveCaptureStore.js";

const FINAL = new Set(FINAL_STATUSES);
const DAY_MS = 24 * 60 * 60 * 1000;
/** Two in-play observations further apart than this (on OUR clock) are a gap worth naming. */
export const GAP_THRESHOLD_SECONDS = 10 * 60;
export const MAX_COVERAGE_DAYS = 7;
/** One HGETALL per fixture: bound what a single admin read can cost. */
export const MAX_FIXTURES_PER_READ = 150;
const FIXTURE_ROWS_IN_RESPONSE = 60;

function parseField(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Same naming and rounding as getBenchmarkHealth.coveragePct: one decimal, null on a zero denominator. */
function pct(part, whole) {
  return whole > 0 ? round1((part / whole) * 100) : null;
}

const isInPlayField = (name) => name.startsWith("M:") || name.startsWith("C:") || name.startsWith("S:");

/**
 * One fixture's coverage, from the fields of its capture hash. Pure.
 *
 * Window membership uses the provider's `elapsedMinute` alone: the provider holds it
 * at 45 / 90 through stoppage time, so first-half stoppage can never be mistaken for
 * the 60' window. The HT marker is the state AT 45', so it covers that window too.
 */
export function summarizeFixtureCapture(fixtureId, fields) {
  const entries = Object.entries(fields && typeof fields === "object" ? fields : {});
  const snapshots = [];
  let eventStates = 0;
  let approxBytes = 0;

  for (const [name, raw] of entries) {
    approxBytes += name.length + (typeof raw === "string" ? raw.length : JSON.stringify(raw ?? null).length);
    if (name.startsWith("E:")) {
      eventStates += 1;
      continue;
    }
    const parsed = parseField(raw);
    if (parsed) snapshots.push({ ...parsed, field: name });
  }

  const windows = Object.fromEntries(COVERAGE_WINDOWS.map((w) => [w, false]));
  let fullTime = false;
  const statsStatus = {};
  const statsSources = {};
  let usable = 0;

  for (const snap of snapshots) {
    if (snap.field.startsWith("T:") && FINAL.has(String(snap.status || ""))) fullTime = true;
    if (snap.field === "S:HT") windows[45] = true;
    if (snap.field.startsWith("M:") || snap.field.startsWith("C:")) {
      const window = coverageWindowForMinute(snap.elapsedMinute);
      if (window !== null) windows[window] = true;
    }
    if (snapshotHasStats(snap)) usable += 1;
    if (snap.statsStatus) statsStatus[snap.statsStatus] = (statsStatus[snap.statsStatus] || 0) + 1;
    if (snap.statsSource) statsSources[snap.statsSource] = (statsSources[snap.statsSource] || 0) + 1;
  }

  // Gaps are measured on OUR clock between consecutive in-play observations. One
  // observation can sit under both a time slot and a change slot, so dedupe by time.
  const inPlayTimes = [
    ...new Set(
      snapshots
        .filter((s) => isInPlayField(s.field))
        .map((s) => Number(s.capturedAtMs))
        .filter((ms) => Number.isFinite(ms))
    )
  ].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < inPlayTimes.length; i += 1) {
    const seconds = Math.round((inPlayTimes[i] - inPlayTimes[i - 1]) / 1000);
    if (seconds > GAP_THRESHOLD_SECONDS) {
      gaps.push({
        from: new Date(inPlayTimes[i - 1]).toISOString(),
        to: new Date(inPlayTimes[i]).toISOString(),
        seconds
      });
    }
  }

  const allTimes = snapshots.map((s) => Number(s.capturedAtMs)).filter((ms) => Number.isFinite(ms));
  const identity = snapshots.find((s) => s.kickoffAt || s.leagueId) || snapshots[0] || null;
  const completeSequence = COVERAGE_WINDOWS.every((w) => windows[w]);

  return {
    fixtureId: Number(fixtureId),
    kickoffAt: identity?.kickoffAt ?? null,
    leagueId: identity?.leagueId ?? null,
    snapshots: snapshots.length,
    usableSnapshots: usable,
    eventStates,
    fields: entries.length,
    approxBytes,
    windows,
    fullTime,
    completeSequence,
    completeTrajectory: completeSequence && fullTime,
    firstCapturedAt: allTimes.length ? new Date(Math.min(...allTimes)).toISOString() : null,
    lastCapturedAt: allTimes.length ? new Date(Math.max(...allTimes)).toISOString() : null,
    gaps,
    maxGapSeconds: gaps.reduce((max, g) => Math.max(max, g.seconds), 0),
    statsStatus,
    statsSources
  };
}

/** The ledger totals, from per-fixture summaries. Pure. */
export function summarizeLiveCaptureCoverage(fixtureSummaries) {
  const all = Array.isArray(fixtureSummaries) ? fixtureSummaries : [];
  const captured = all.filter((f) => f.snapshots > 0);
  const counts = captured.map((f) => f.snapshots);
  const total = counts.reduce((a, b) => a + b, 0);
  const withGaps = captured.filter((f) => f.gaps.length > 0);
  const completeSequence = captured.filter((f) => f.completeSequence).length;

  const statsStatus = {};
  for (const f of captured) {
    for (const [status, n] of Object.entries(f.statsStatus || {})) statsStatus[status] = (statsStatus[status] || 0) + n;
  }

  return {
    fixturesObserved: all.length,
    fixturesWithSnapshot: captured.length,
    fixturesObservedNotCaptured: all.length - captured.length,
    fixturesWithUsableSnapshot: captured.filter((f) => f.usableSnapshots > 0).length,
    windows: Object.fromEntries(COVERAGE_WINDOWS.map((w) => [w, captured.filter((f) => f.windows?.[w]).length])),
    fullTime: captured.filter((f) => f.fullTime).length,
    completeSequence,
    completeTrajectory: captured.filter((f) => f.completeTrajectory).length,
    coveragePct: pct(captured.length, all.length),
    completeSequencePct: pct(completeSequence, captured.length),
    snapshotsTotal: total,
    snapshotsPerFixture: {
      avg: counts.length ? round1(total / counts.length) : null,
      min: counts.length ? Math.min(...counts) : null,
      max: counts.length ? Math.max(...counts) : null
    },
    gaps: {
      fixturesWithGaps: withGaps.length,
      gapsTotal: withGaps.reduce((sum, f) => sum + f.gaps.length, 0),
      maxGapSeconds: withGaps.reduce((max, f) => Math.max(max, f.maxGapSeconds), 0),
      thresholdSeconds: GAP_THRESHOLD_SECONDS
    },
    // Knowable reasons only. Whatever is not explained here is `unobserved`: no fresh
    // poll reached that stretch, because nobody had the match open.
    statsStatus
  };
}

function utcDays(nowMs, days) {
  const out = [];
  for (let i = 0; i < days; i += 1) out.push(new Date(nowMs - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

async function resolveKv(deps) {
  if (deps.kv) return deps.kv;
  const { kv } = await import("../fetcher.js");
  return kv;
}

/**
 * Read the ledger. Bounded: at most MAX_COVERAGE_DAYS day sets and
 * MAX_FIXTURES_PER_READ fixture hashes per call; anything beyond is reported as
 * truncated rather than silently dropped.
 */
export async function readLiveCaptureCoverage({ days = 1 } = {}, deps = {}) {
  const kv = await resolveKv(deps);
  const nowMs = (deps.now || Date.now)();
  const span = Math.max(1, Math.min(Math.round(Number(days)) || 1, MAX_COVERAGE_DAYS));
  const dayList = utcDays(nowMs, span);

  const memberLists = await Promise.all(dayList.map((day) => kv.smembers(liveCaptureDayKey(day))));
  const ids = [
    ...new Set(
      memberLists
        .flatMap((members) => (Array.isArray(members) ? members : []))
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  ];
  const readIds = ids.slice(0, MAX_FIXTURES_PER_READ);

  const hashes = await Promise.all(readIds.map((id) => kv.hgetall(liveCaptureFixtureKey(id))));
  const fixtures = readIds.map((id, index) => summarizeFixtureCapture(id, hashes[index] || {}));

  const counterRows = await Promise.all(dayList.map((day) => kv.hgetall(liveCaptureCountersKey(day))));
  const counters = {};
  dayList.forEach((day, index) => {
    const row = counterRows[index] || {};
    counters[day] = Object.fromEntries(LIVE_CAPTURE_COUNTERS.map((name) => [name, Number(row[name] || 0)]));
  });

  return {
    days: dayList,
    coverage: summarizeLiveCaptureCoverage(fixtures),
    counters,
    storage: {
      fixtureKeys: fixtures.filter((f) => f.fields > 0).length,
      fieldsTotal: fixtures.reduce((sum, f) => sum + f.fields, 0),
      approxBytes: fixtures.reduce((sum, f) => sum + f.approxBytes, 0),
      largestFixtureFields: fixtures.reduce((max, f) => Math.max(max, f.fields), 0)
    },
    truncated: ids.length > readIds.length ? { fixturesObserved: ids.length, fixturesRead: readIds.length } : null,
    fixtures
  };
}

/**
 * GET /api/backtest?view=health&sub=live-capture[&days=1..7]
 *
 * Authorisation is the dispatcher's: `health` is in api/backtest.js's gatedViews, so
 * this is reached only with the cron secret or an admin JWT. It returns aggregates and
 * per-fixture coverage flags — never a snapshot body.
 */
export async function handleLiveCaptureCoverage(req, res, deps = {}) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }
  try {
    const config = deps.config || readLiveCaptureConfig();
    const ledger = await readLiveCaptureCoverage({ days: req.query?.days }, deps);
    const rows = [...ledger.fixtures]
      .sort((a, b) => String(b.lastCapturedAt || "").localeCompare(String(a.lastCapturedAt || "")))
      .slice(0, FIXTURE_ROWS_IN_RESPONSE)
      .map(({ approxBytes: _approxBytes, ...row }) => row);
    return res.status(200).json({
      ok: true,
      generatedAt: new Date((deps.now || Date.now)()).toISOString(),
      capture: {
        enabled: config.enabled,
        disabledReason: config.disabledReason ?? null,
        // Per PROCESS, per UTC day — not a platform-wide figure (see liveCaptureStore.js).
        dailyCommandCap: config.dailyCommandCap ?? null,
        minuteStep: config.minuteStep,
        ttlDays: Math.round(config.ttlSeconds / (24 * 60 * 60)),
        maxFieldsPerFixture: maxFieldsPerFixture(config.minuteStep)
      },
      days: ledger.days,
      coverage: ledger.coverage,
      counters: ledger.counters,
      storage: ledger.storage,
      truncated: ledger.truncated,
      fixtures: rows
    });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error?.message || "Live capture ledger unavailable" });
  }
}
