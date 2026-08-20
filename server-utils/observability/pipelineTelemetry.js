/**
 * Per-request timing attribution for Predictor V3.
 *
 * One production Predict was measured at 48,744 ms for 35 fixtures — 1,393 ms
 * each — and nothing in the system could say where it went. `context.stageMarks`
 * is written by all thirteen stages and read by nothing, and stages 02-09
 * overwrite their entry on every fixture, so even reading it would only ever
 * describe the last fixture. This module is the reader that was missing.
 *
 * ACCUMULATE, never overwrite. A stage that runs once per fixture contributes
 * count/totalMs/maxMs/minMs, because the question is "where did 48 seconds go",
 * and a single timestamp cannot answer it.
 *
 * BOUNDED BY CONSTRUCTION. Per-fixture rows are capped at FIXTURE_CAP while the
 * run is in flight, and `summarize` emits only the slowest few. A 35-fixture
 * request must produce one structured log line, not 35.
 *
 * MEASUREMENT ONLY. Nothing here changes prediction output, persistence, fetch
 * semantics, concurrency or timeouts. Every function is pure over its own
 * accumulator; the only cost per stage is a Date.now() and a few additions.
 */

/** Hard ceiling on retained per-fixture rows. effectiveLimit is <= 50 today. */
export const FIXTURE_CAP = 200;

/** How many fixtures the summary describes individually. */
export const DEFAULT_SLOW_FIXTURE_LIMIT = 5;

/**
 * @returns {object} A fresh accumulator. One per request.
 */
export function createPipelineTelemetry() {
  return {
    startedAt: Date.now(),
    stages: Object.create(null),
    fixtures: [],
    current: null,
    droppedFixtures: 0
  };
}

/**
 * A usable accumulator: a plain object carrying the shape createPipelineTelemetry
 * makes. `typeof [] === "object"`, so an array would otherwise pass a truthiness
 * check and then throw on `.stages[id]` — telemetry must never be the reason a
 * prediction fails.
 */
function usable(telemetry) {
  return Boolean(
    telemetry &&
      typeof telemetry === "object" &&
      !Array.isArray(telemetry) &&
      telemetry.stages &&
      typeof telemetry.stages === "object" &&
      Array.isArray(telemetry.fixtures)
  );
}

function bucket(telemetry, stageId) {
  const id = String(stageId || "unknown");
  let b = telemetry.stages[id];
  if (!b) {
    b = { count: 0, totalMs: 0, maxMs: 0, minMs: null };
    telemetry.stages[id] = b;
  }
  return b;
}

/**
 * Record one execution of one stage.
 *
 * When a fixture is open the same duration is also attributed to that fixture,
 * which is what makes "which fixture was slow, and in which stage" answerable.
 *
 * @param {object} telemetry
 * @param {string} stageId
 * @param {number} ms
 */
export function recordStage(telemetry, stageId, ms) {
  if (!usable(telemetry)) return;
  // Absent is not zero. `Number(null)` is 0, which is finite and non-negative,
  // so a missing duration would otherwise be recorded as a real 0 ms execution
  // and inflate `count`. A genuine sub-millisecond stage must still count, so
  // the emptiness check has to happen before the coercion, not after it.
  if (ms === null || ms === undefined || ms === "") return;
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration < 0) return;

  const b = bucket(telemetry, stageId);
  b.count += 1;
  b.totalMs += duration;
  if (duration > b.maxMs) b.maxMs = duration;
  if (b.minMs === null || duration < b.minMs) b.minMs = duration;

  const fixture = telemetry.current;
  if (fixture) {
    fixture.totalMs += duration;
    const id = String(stageId || "unknown");
    fixture.stages[id] = (fixture.stages[id] || 0) + duration;
  }
}

/**
 * @param {object} telemetry
 * @param {number|string|null} fixtureId
 */
export function beginFixture(telemetry, fixtureId) {
  if (!usable(telemetry)) return;
  telemetry.current = {
    fixtureId: fixtureId == null ? null : Number(fixtureId),
    totalMs: 0,
    wallMs: 0,
    stages: Object.create(null)
  };
}

/**
 * Close the open fixture. `wallMs` is the loop's own measurement, so a gap
 * between it and the summed stage time is itself a signal — it is work the
 * stages do not account for.
 *
 * @param {object} telemetry
 * @param {number} wallMs
 */
export function endFixture(telemetry, wallMs) {
  if (!usable(telemetry)) return;
  const fixture = telemetry.current;
  telemetry.current = null;
  if (!fixture) return;

  const wall = Number(wallMs);
  fixture.wallMs = Number.isFinite(wall) && wall >= 0 ? wall : fixture.totalMs;

  if (telemetry.fixtures.length >= FIXTURE_CAP) {
    telemetry.droppedFixtures += 1;
    return;
  }
  telemetry.fixtures.push(fixture);
}

function dominant(fixture) {
  let best = null;
  for (const [id, ms] of Object.entries(fixture.stages)) {
    if (!best || ms > best.ms) best = { stage: id, ms };
  }
  return best;
}

/**
 * The one structured object a slow request logs.
 *
 * @param {object} telemetry
 * @param {object} [opts]
 * @param {number} [opts.totalMs] Whole-request duration, if the caller knows it.
 * @param {object} [opts.upstream] Upstream counters for this request.
 * @param {number} [opts.slowFixtureLimit]
 * @returns {object}
 */
export function summarize(telemetry, opts = {}) {
  if (!usable(telemetry)) {
    return { totalMs: 0, fixtureCount: 0, unattributedMs: 0, stages: {}, slowestFixtures: [] };
  }

  const limit = Number.isFinite(Number(opts.slowFixtureLimit))
    ? Math.max(0, Number(opts.slowFixtureLimit))
    : DEFAULT_SLOW_FIXTURE_LIMIT;

  const stages = {};
  for (const [id, b] of Object.entries(telemetry.stages)) {
    stages[id] = {
      count: b.count,
      totalMs: b.totalMs,
      maxMs: b.maxMs,
      minMs: b.minMs === null ? 0 : b.minMs,
      avgMs: b.count ? Math.round(b.totalMs / b.count) : 0
    };
  }

  const slowestFixtures = [...telemetry.fixtures]
    .sort((a, b) => b.wallMs - a.wallMs)
    .slice(0, limit)
    .map((f) => {
      const top = dominant(f);
      return {
        fixtureId: f.fixtureId,
        wallMs: f.wallMs,
        stageMs: f.totalMs,
        // Wall time the stages did not account for: loop overhead, or work
        // happening between stages rather than inside one.
        unattributedMs: Math.max(0, f.wallMs - f.totalMs),
        dominantStage: top ? top.stage : null,
        dominantStageMs: top ? top.ms : 0
      };
    });

  const totalMs = Number.isFinite(Number(opts.totalMs))
    ? Number(opts.totalMs)
    : Date.now() - telemetry.startedAt;

  const stageTotal = Object.values(stages).reduce((a, s) => a + s.totalMs, 0);

  const out = {
    totalMs,
    fixtureCount: telemetry.fixtures.length + telemetry.droppedFixtures,
    // The reconciliation the whole exercise exists for: if this is large, the
    // time is going somewhere no stage is measuring.
    unattributedMs: Math.max(0, totalMs - stageTotal),
    stages,
    slowestFixtures
  };
  if (telemetry.droppedFixtures) out.droppedFixtures = telemetry.droppedFixtures;
  if (opts.upstream && typeof opts.upstream === "object") out.upstream = opts.upstream;
  return out;
}

export default {
  FIXTURE_CAP,
  DEFAULT_SLOW_FIXTURE_LIMIT,
  createPipelineTelemetry,
  recordStage,
  beginFixture,
  endFixture,
  summarize
};
