/**
 * Live Predictor Lab — Phase 1. The coverage ledger.
 *
 * The ledger is derived at read time from the capture store, so these tests write
 * through the REAL writer and then read — the two cannot drift apart unnoticed.
 * The property guarded hardest: a window nobody observed stays unobserved.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  GAP_THRESHOLD_SECONDS,
  MAX_COVERAGE_DAYS,
  MAX_FIXTURES_PER_READ,
  handleLiveCaptureCoverage,
  readLiveCaptureCoverage,
  summarizeFixtureCapture,
  summarizeLiveCaptureCoverage
} from "../../server-utils/liveCapture/liveCaptureCoverage.js";
import {
  captureLivePoll,
  createLiveCaptureState,
  liveCaptureDayKey,
  liveCaptureFixtureKey,
  noteLivePollDenied,
  readLiveCaptureConfig
} from "../../server-utils/liveCapture/liveCaptureStore.js";
import { createFakeKv, liveRow } from "./fakeKv.js";

const KICKOFF = Date.parse("2026-09-21T16:00:00.000Z");
const ENABLED = readLiveCaptureConfig({ LIVE_CAPTURE_ENABLED: "1", LIVE_CAPTURE_DAILY_COMMAND_CAP: "100000" });
const NO_STATS = { statsResult: undefined, eventsResult: undefined };

/** Drive the real writer: one observation per entry of `timeline`. */
async function play(kv, fixtureId, timeline, state = createLiveCaptureState()) {
  for (const [status, elapsed, over = {}] of timeline) {
    const { atMinute, fresh = true, ...rowOver } = over;
    const at = KICKOFF + (atMinute ?? elapsed) * 60_000;
    await captureLivePoll(
      { rows: [liveRow({ fixtureId, status, elapsed, ...rowOver })], scoresFromCache: !fresh, nowMs: at },
      { kv, state, config: ENABLED, logWarn: () => {} }
    );
  }
  return state;
}

const fieldsOf = (kv, id) => Object.fromEntries(kv.hashes.get(liveCaptureFixtureKey(id)) || []);

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

// ------------------------------------------------------------------ one fixture

test("1. windows are covered only by an observation that really landed in them", async () => {
  const kv = createFakeKv();
  await play(kv, 1, [["1H", 14], ["1H", 31], ["2H", 61, { atMinute: 78 }]]);
  const s = summarizeFixtureCapture(1, fieldsOf(kv, 1));
  assert.deepEqual(s.windows, { 15: true, 30: true, 45: false, 60: true, 75: false });
  assert.equal(s.fullTime, false);
  assert.equal(s.completeSequence, false, "two windows were never seen — and are not invented");
  assert.equal(s.snapshots, 3);
  assert.equal(s.usableSnapshots, 3);
});

test("1b. the HT marker is the state at 45'; first-half stoppage is never the 60' window", async () => {
  const kv = createFakeKv();
  await play(kv, 2, [["HT", 45, { atMinute: 50 }]]);
  assert.equal(summarizeFixtureCapture(2, fieldsOf(kv, 2)).windows[45], true);

  const stoppage = createFakeKv();
  await play(stoppage, 3, [["1H", 45, { extra: 14, atMinute: 59 }]]); // 45+14 is "minute 59" on the clock
  const s = summarizeFixtureCapture(3, fieldsOf(stoppage, 3));
  assert.equal(s.windows[60], false, "the provider minute is 45, whatever the stoppage");
  assert.equal(s.windows[45], true);
});

test("1c. a complete trajectory needs all five windows AND the FT observation", async () => {
  const kv = createFakeKv();
  await play(kv, 4, [
    ["1H", 15],
    ["1H", 30],
    ["HT", 45, { atMinute: 47 }],
    ["2H", 60, { atMinute: 77 }],
    ["2H", 75, { atMinute: 92 }]
  ]);
  let s = summarizeFixtureCapture(4, fieldsOf(kv, 4));
  assert.equal(s.completeSequence, true);
  assert.equal(s.completeTrajectory, false, "no FT yet");

  await play(kv, 4, [["FT", 90, { atMinute: 110, score: { home: 1, away: 0 }, ...NO_STATS }]]);
  s = summarizeFixtureCapture(4, fieldsOf(kv, 4));
  assert.equal(s.fullTime, true);
  assert.equal(s.completeTrajectory, true);

  // A postponement is a terminal marker, but it is NOT a full-time observation.
  const pst = createFakeKv();
  await play(pst, 5, [["PST", null, { atMinute: 0, ...NO_STATS }]]);
  const p = summarizeFixtureCapture(5, fieldsOf(pst, 5));
  assert.equal(p.snapshots, 1);
  assert.equal(p.fullTime, false);
});

test("1d. gaps are measured on OUR clock between in-play observations", async () => {
  const kv = createFakeKv();
  await play(kv, 6, [["1H", 5], ["1H", 8], ["1H", 40], ["2H", 50, { atMinute: 66 }]]);
  const s = summarizeFixtureCapture(6, fieldsOf(kv, 6));
  assert.deepEqual(s.gaps.map((g) => g.seconds), [32 * 60, 26 * 60]);
  assert.equal(s.maxGapSeconds, 32 * 60);
  assert.ok(s.gaps.every((g) => g.seconds > GAP_THRESHOLD_SECONDS));
  assert.equal(s.firstCapturedAt, new Date(KICKOFF + 5 * 60_000).toISOString());
  assert.equal(s.lastCapturedAt, new Date(KICKOFF + 66 * 60_000).toISOString());
});

test("1e. why statistics were missing is reported from the snapshots themselves", async () => {
  const kv = createFakeKv();
  await play(kv, 7, [
    ["1H", 10],
    ["1H", 20, { statsResult: { ok: false, fromCache: false, reason: "api_budget_hard_stop", response: null } }],
    ["1H", 31, { statsResult: { ok: true, fromCache: true, reason: null, response: [] } }]
  ]);
  const s = summarizeFixtureCapture(7, fieldsOf(kv, 7));
  assert.deepEqual(s.statsStatus, { ok: 1, request_failed: 1, empty: 1 });
  assert.deepEqual(s.statsSources, { fresh: 1, unavailable: 1, cache: 1 });
  assert.equal(s.usableSnapshots, 1, "a snapshot without statistics is kept, but is not 'usable'");
});

test("1f. an empty or unreadable hash is a fixture with no snapshots, not a crash", () => {
  for (const fields of [null, undefined, {}, { "M:1:0": "not json" }, { "M:1:0": 12 }]) {
    const s = summarizeFixtureCapture(8, fields);
    assert.equal(s.snapshots, 0);
    assert.equal(s.completeSequence, false);
    assert.deepEqual(s.gaps, []);
  }
  // Values may arrive as JSON strings (no automatic deserialisation) — same result.
  const asString = { "M:1:15": JSON.stringify({ elapsedMinute: 15, capturedAtMs: KICKOFF, statsStatus: "ok", shotsTotalHome: 1 }) };
  const s = summarizeFixtureCapture(9, asString);
  assert.equal(s.windows[15], true);
  assert.equal(s.usableSnapshots, 1);
});

// ------------------------------------------------------------------ the ledger

test("2. the ledger answers the Phase 1 coverage questions", async () => {
  const kv = createFakeKv();
  const state = createLiveCaptureState();
  // 10: fully watched.  11: two windows.  12: seen only through cached polls — observed, never captured.
  await play(
    kv,
    10,
    [
      ["1H", 15],
      ["1H", 30],
      ["HT", 45, { atMinute: 47 }],
      ["2H", 60, { atMinute: 77 }],
      ["2H", 75, { atMinute: 92 }],
      ["FT", 90, { atMinute: 110, ...NO_STATS }]
    ],
    state
  );
  await play(kv, 11, [["1H", 16], ["2H", 74, { atMinute: 91 }]], state);
  await play(kv, 12, [["1H", 20, { fresh: false }]], state);

  const ledger = await readLiveCaptureCoverage({ days: 1 }, { kv, now: () => KICKOFF + 3 * 3600_000 });
  const c = ledger.coverage;
  assert.equal(c.fixturesObserved, 3);
  assert.equal(c.fixturesWithSnapshot, 2);
  assert.equal(c.fixturesObservedNotCaptured, 1);
  assert.equal(c.fixturesWithUsableSnapshot, 2);
  assert.deepEqual(c.windows, { 15: 2, 30: 1, 45: 1, 60: 1, 75: 2 });
  assert.equal(c.fullTime, 1);
  assert.equal(c.completeSequence, 1);
  assert.equal(c.completeTrajectory, 1);
  assert.equal(c.coveragePct, 66.7);
  assert.equal(c.completeSequencePct, 50);
  assert.deepEqual(c.snapshotsPerFixture, { avg: 4, min: 2, max: 6 });
  assert.equal(c.snapshotsTotal, 8);
  assert.equal(c.gaps.fixturesWithGaps, 2);
  assert.equal(c.gaps.thresholdSeconds, GAP_THRESHOLD_SECONDS);
  assert.equal(ledger.storage.fixtureKeys, 2);
  assert.ok(ledger.storage.approxBytes > 0);
  assert.equal(ledger.truncated, null);
});

test("2b. an empty ledger reports nulls, not invented percentages", () => {
  const c = summarizeLiveCaptureCoverage([]);
  assert.equal(c.fixturesObserved, 0);
  assert.equal(c.coveragePct, null);
  assert.equal(c.completeSequencePct, null);
  assert.deepEqual(c.snapshotsPerFixture, { avg: null, min: null, max: null });
  assert.deepEqual(summarizeLiveCaptureCoverage(null).windows, { 15: 0, 30: 0, 45: 0, 60: 0, 75: 0 });
});

test("2c. counters — including budget-denied polls — come back per UTC day", async () => {
  const kv = createFakeKv();
  const state = createLiveCaptureState();
  noteLivePollDenied("api_budget_hard_stop", { config: ENABLED, state });
  await play(kv, 20, [["1H", 15]], state);
  const ledger = await readLiveCaptureCoverage({ days: 2 }, { kv, now: () => KICKOFF + 3600_000 });
  assert.deepEqual(ledger.days, ["2026-09-21", "2026-09-20"]);
  assert.equal(ledger.counters["2026-09-21"].budget_denied, 1);
  assert.equal(ledger.counters["2026-09-21"].attempted, 1);
  assert.equal(ledger.counters["2026-09-20"].stored, 0, "a day with no data is zeros, not missing");
});

test("2d. a read is bounded, and says so when it had to stop", async () => {
  const kv = createFakeKv();
  const ids = Array.from({ length: MAX_FIXTURES_PER_READ + 5 }, (_, i) => 50_000 + i);
  kv.sets.set(liveCaptureDayKey("2026-09-21"), new Set(ids));
  const ledger = await readLiveCaptureCoverage({ days: 999 }, { kv, now: () => KICKOFF });
  assert.equal(ledger.days.length, MAX_COVERAGE_DAYS, "days are clamped");
  assert.equal(kv.commands.filter((c) => c[0] === "hgetall" && c[1].includes(":fx:")).length, MAX_FIXTURES_PER_READ);
  assert.deepEqual(ledger.truncated, { fixturesObserved: MAX_FIXTURES_PER_READ + 5, fixturesRead: MAX_FIXTURES_PER_READ });
  for (const bad of [0, -3, "x", null, undefined]) {
    const one = await readLiveCaptureCoverage({ days: bad }, { kv: createFakeKv(), now: () => KICKOFF });
    assert.equal(one.days.length, 1);
  }
});

// ------------------------------------------------------------------ the admin read

test("3. the read view returns aggregates and coverage flags — never a snapshot body", async () => {
  const kv = createFakeKv();
  await play(kv, 30, [["1H", 15], ["1H", 31]]);
  const res = mockRes();
  await handleLiveCaptureCoverage({ method: "GET", query: { days: "1" } }, res, { kv, config: ENABLED, now: () => KICKOFF + 3600_000 });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.capture, {
    enabled: true,
    disabledReason: null,
    dailyCommandCap: 100000,
    minuteStep: 3,
    ttlDays: 30,
    maxFieldsPerFixture: 137
  });
  assert.deepEqual(Object.keys(res.body).sort(), ["capture", "counters", "coverage", "days", "fixtures", "generatedAt", "ok", "storage", "truncated"]);
  assert.equal(res.body.fixtures.length, 1);
  assert.equal(res.body.fixtures[0].fixtureId, 30);

  const text = JSON.stringify(res.body);
  for (const leaked of ["shotsTotalHome", "possessionHome", "homeScore", "\"events\"", "A. Player", "capturedAtMs"]) {
    assert.equal(text.includes(leaked), false, `the response must not carry ${leaked}`);
  }
});

test("3b. it reports the flag honestly while capture is dark", async () => {
  const res = mockRes();
  await handleLiveCaptureCoverage({ method: "GET", query: {} }, res, { kv: createFakeKv(), config: readLiveCaptureConfig({}), now: () => KICKOFF });
  assert.equal(res.body.capture.enabled, false);
  assert.equal(res.body.capture.disabledReason, "flag_off");
  assert.equal(res.body.capture.dailyCommandCap, null);
  assert.equal(res.body.coverage.fixturesObserved, 0);

  // Flag on, no cap: the ledger says WHY capture is dark.
  const failedClosed = mockRes();
  await handleLiveCaptureCoverage({ method: "GET", query: {} }, failedClosed, { kv: createFakeKv(), config: readLiveCaptureConfig({ LIVE_CAPTURE_ENABLED: "1" }), now: () => KICKOFF });
  assert.deepEqual([failedClosed.body.capture.enabled, failedClosed.body.capture.disabledReason], [false, "invalid_command_cap"]);
});

test("3c. wrong method and a failing KV are refused cleanly", async () => {
  const post = mockRes();
  await handleLiveCaptureCoverage({ method: "POST", query: {} }, post, { kv: createFakeKv() });
  assert.equal(post.statusCode, 405);
  assert.equal(post.body.ok, false);

  const down = mockRes();
  const brokenKv = {
    smembers: async () => {
      throw new Error("ERR max requests limit exceeded");
    },
    hgetall: async () => null
  };
  await handleLiveCaptureCoverage({ method: "GET", query: {} }, down, { kv: brokenKv, config: ENABLED });
  assert.equal(down.statusCode, 503);
  assert.deepEqual(Object.keys(down.body).sort(), ["error", "ok"]);
});
