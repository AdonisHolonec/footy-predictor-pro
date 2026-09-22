/**
 * Live Predictor Lab — Phase 1. The KV writer behind the live poll.
 *
 * The claims here are about COMMANDS, so every assertion reads the fake's command
 * log: what was written, under which key, with which TTL — and, as importantly, what
 * was NOT sent. A writer that "didn't throw" proves nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COUNTER_FLUSH_INTERVAL_MS,
  DEFAULT_TTL_DAYS,
  LIVE_CAPTURE_KEY_PREFIX,
  captureLivePoll,
  createLiveCaptureState,
  liveCaptureCountersKey,
  liveCaptureDayKey,
  liveCaptureFixtureKey,
  noteLivePollDenied,
  parseDailyCommandCap,
  readLiveCaptureConfig
} from "../../server-utils/liveCapture/liveCaptureStore.js";
import { MAX_EVENTS, maxFieldsPerFixture } from "../../server-utils/liveCapture/liveCaptureSnapshot.js";
import { AWAY, HOME, createFakeKv, liveRow, statsBlock } from "./fakeKv.js";

const NOW = Date.parse("2026-09-21T16:20:30.000Z");
const DAY = "2026-09-21";
const TTL = DEFAULT_TTL_DAYS * 24 * 60 * 60;
/** A cap far above anything a test issues; the cap tests (section 10) set their own. */
const CAP = "100000";
const ENABLED = readLiveCaptureConfig({ LIVE_CAPTURE_ENABLED: "1", LIVE_CAPTURE_DAILY_COMMAND_CAP: CAP });

function harness(over = {}) {
  const kv = over.kv || createFakeKv();
  const state = over.state || createLiveCaptureState();
  const warnings = [];
  const deps = { kv, state, config: over.config || ENABLED, logWarn: (event, meta) => warnings.push({ event, meta }) };
  const poll = (rows, { fresh = true, at = NOW } = {}) =>
    captureLivePoll({ rows, scoresFromCache: !fresh, nowMs: at }, deps);
  return { kv, state, deps, warnings, poll };
}

const ops = (kv, op) => kv.commands.filter((c) => c[0] === op);

// ------------------------------------------------------------------ dark by default

test("1. dark by default: with the flag unset NOTHING is sent to KV", async () => {
  for (const env of [{}, { LIVE_CAPTURE_ENABLED: "0" }, { LIVE_CAPTURE_ENABLED: "true" }, { LIVE_CAPTURE_ENABLED: "" }]) {
    const config = readLiveCaptureConfig(env);
    assert.equal(config.enabled, false, JSON.stringify(env));
    const { kv, poll, state } = harness({ config });
    const summary = await poll([liveRow(), liveRow({ fixtureId: 9002, status: "FT" })]);
    assert.equal(summary.enabled, false);
    assert.equal(kv.state.pipelines, 0, "no pipeline was even built");
    assert.deepEqual(kv.commands, []);
    noteLivePollDenied("api_budget_hard_stop", { config, state });
    assert.deepEqual(state.pending, {}, "and nothing is remembered either");
  }
  // The flag alone is not enough: without a valid per-instance command cap it fails closed (test 10).
  const flagOnly = readLiveCaptureConfig({ LIVE_CAPTURE_ENABLED: "1" });
  assert.deepEqual([flagOnly.enabled, flagOnly.disabledReason], [false, "invalid_command_cap"]);
  assert.deepEqual([ENABLED.enabled, ENABLED.disabledReason, ENABLED.dailyCommandCap], [true, null, 100000]);
});

// ------------------------------------------------------------------ what a capture writes

test("2. a fresh in-play observation: one pipeline, write-if-absent, every key with a TTL", async () => {
  const { kv, poll } = harness();
  const summary = await poll([liveRow()]);

  assert.equal(kv.state.pipelines, 1);
  const fxKey = liveCaptureFixtureKey(9001);
  const shape = kv.commands.slice(0, 5).map(([op, key, a]) => (op === "expire" ? [op, key] : [op, key, a]));
  assert.deepEqual(shape, [
    ["hsetnx", fxKey, "M:1:15"],
    ["hsetnx", fxKey, "E:1"],
    ["expire", fxKey],
    ["sadd", liveCaptureDayKey(DAY), 9001],
    ["expire", liveCaptureDayKey(DAY)]
  ]);
  assert.equal(kv.ttl.get(fxKey), TTL, "the fixture hash expires");
  assert.equal(kv.ttl.get(liveCaptureDayKey(DAY)), TTL, "the day index expires");

  const stored = kv.hashes.get(fxKey).get("M:1:15");
  assert.equal(stored.slot, "M:1:15");
  assert.equal(stored.capturedAt, "2026-09-21T16:20:30.000Z");
  assert.equal(stored.scoreSource, "fresh");
  assert.equal(stored.shotsTotalHome, 4);
  assert.equal(stored.redCardsHome, null, "a null survives storage");
  assert.deepEqual(kv.hashes.get(fxKey).get("E:1").events.map((e) => e.detail), ["Yellow Card"]);

  assert.deepEqual(
    { stored: summary.stored, dedup: summary.deduplicated, skipped: summary.skipped, milestones: summary.milestones },
    { stored: 2, dedup: 0, skipped: 0, milestones: 1 },
    "minute 16 lands on the 15' window"
  );
});

test("2b. one poll, many fixtures — still ONE pipelined request", async () => {
  const { kv, poll } = harness();
  const rows = Array.from({ length: 24 }, (_, i) => liveRow({ fixtureId: 7000 + i }));
  const summary = await poll(rows);
  assert.equal(kv.state.pipelines, 1);
  assert.equal(summary.attempted, 24);
  assert.equal(ops(kv, "hsetnx").length, 48, "a time slot and an events state each");
});

// ------------------------------------------------------------------ duplicate suppression

test("3. the same observation again costs ZERO commands on a warm instance", async () => {
  const { kv, poll } = harness();
  await poll([liveRow()]);
  const before = kv.commands.length;
  const again = await poll([liveRow({ elapsed: 17 })], { at: NOW + 40_000 });
  assert.equal(kv.commands.length, before, "nothing was sent");
  assert.equal(again.stored, 0);
  assert.equal(again.deduplicated, 1, "same 3-minute bucket (the events state is unchanged too)");
});

test("3b. a cold instance re-sends, KV refuses, and the FIRST observation is kept", async () => {
  const kv = createFakeKv();
  await harness({ kv }).poll([liveRow()]);
  const cold = harness({ kv }); // new process memory, same store
  const later = await cold.poll([liveRow({ elapsed: 17 })], { at: NOW + 60_000 });
  assert.equal(later.stored, 0);
  assert.equal(later.deduplicated, 2, "time slot and events state both already exist");
  assert.equal(kv.hashes.get(liveCaptureFixtureKey(9001)).get("M:1:15").capturedAtMs, NOW, "never overwritten");
});

test("3c. time progression with an unchanged score is NOT suppressed", async () => {
  const { kv, poll } = harness();
  await poll([liveRow({ elapsed: 16 })]);
  const moved = liveRow({ elapsed: 19 });
  moved.statsResult.response[0] = statsBlock(HOME, { shotsTotal: 6, corners: 2 });
  const summary = await poll([moved], { at: NOW + 180_000 });
  assert.equal(summary.stored, 1);
  const fields = kv.fieldsOf(liveCaptureFixtureKey(9001));
  assert.deepEqual(fields.filter((f) => f.startsWith("M:")), ["M:1:15", "M:1:18"]);
  assert.equal(kv.hashes.get(liveCaptureFixtureKey(9001)).get("M:1:18").shotsTotalHome, 6, "the stats that moved are carried");
});

test("3d. a goal inside an already-taken time bucket is captured at once", async () => {
  const { kv, poll } = harness();
  await poll([liveRow({ elapsed: 15 })]);
  const summary = await poll([liveRow({ elapsed: 16, score: { home: 1, away: 0 } })], { at: NOW + 75_000 });
  assert.equal(summary.stored, 1);
  const goal = kv.hashes.get(liveCaptureFixtureKey(9001)).get("C:1");
  assert.deepEqual([goal.homeScore, goal.elapsedMinute, goal.slot], [1, 16, "C:1"]);
});

test("3e. half time is one marker, however long the break lasts", async () => {
  const { kv, poll } = harness();
  for (let i = 0; i < 12; i += 1) await poll([liveRow({ status: "HT", elapsed: 45 })], { at: NOW + i * 75_000 });
  assert.deepEqual(kv.fieldsOf(liveCaptureFixtureKey(9001)).filter((f) => f.startsWith("S:")), ["S:HT"]);
  assert.equal(ops(kv, "hsetnx").filter((c) => c[2] === "S:HT").length, 1, "and it was sent once");
});

// ------------------------------------------------------------------ timing

test("4. a cached score read is never stamped as a fresh in-play observation", async () => {
  const { kv, poll } = harness();
  const summary = await poll([liveRow()], { fresh: false });
  assert.equal(ops(kv, "hsetnx").length, 0, "no snapshot");
  assert.deepEqual(summary.skipReasons, { stale_scores: 1 });
  assert.deepEqual([...kv.sets.get(liveCaptureDayKey(DAY))], [9001], "but the fixture is recorded as OBSERVED");
});

test("4b. a terminal state is a settled fact: its marker may come from cache, and says so", async () => {
  const { kv, poll } = harness();
  const row = liveRow({ status: "FT", elapsed: 90, score: { home: 2, away: 1 }, statsResult: undefined, eventsResult: undefined });
  const summary = await poll([row], { fresh: false });
  const ft = kv.hashes.get(liveCaptureFixtureKey(9001)).get("T:FT");
  assert.deepEqual([ft.status, ft.homeScore, ft.awayScore, ft.scoreSource, ft.statsSource], ["FT", 2, 1, "cache", "not_fetched"]);
  assert.equal(ft.shotsTotalHome, null, "no statistics were fetched for it — and none are invented");
  assert.equal(summary.milestones, 1, "the FT observation is a coverage milestone");
});

test("4c. rows that are not live produce no commands at all", async () => {
  const { kv, poll } = harness();
  const summary = await poll([liveRow({ status: "NS", elapsed: null, statsResult: undefined, eventsResult: undefined })]);
  assert.deepEqual(kv.commands, []);
  assert.deepEqual(summary.skipReasons, { not_live: 1 });
});

test("4d. a malformed row is counted and does not stop the others", async () => {
  const { kv, poll } = harness();
  const summary = await poll([liveRow({ fixtureId: null }), liveRow({ fixtureId: 9005 })]);
  assert.equal(summary.malformed, 1);
  assert.deepEqual(summary.skipReasons, { malformed_fixture_id: 1 });
  assert.ok(kv.hashes.has(liveCaptureFixtureKey(9005)));
});

// ------------------------------------------------------------------ failure is non-fatal

test("5. a KV failure never throws, and the observation is retried by the next poll", async () => {
  const kv = createFakeKv({ execError: new Error("ERR max requests limit exceeded") });
  const h = harness({ kv });
  const failed = await h.poll([liveRow()]);
  assert.equal(failed.ok, false);
  assert.equal(failed.storageFailed, 2);
  assert.equal(failed.stored, 0);
  assert.deepEqual(h.warnings.map((w) => w.event), ["live_capture.store_failed"]);
  assert.equal(JSON.stringify(h.warnings).includes("shotsTotal"), false, "no payload in the log line");

  kv.state.execError = null; // KV recovers
  const retried = await h.poll([liveRow()], { at: NOW + 75_000 });
  assert.equal(retried.stored, 2, "the memo did not remember the failed write as done");
});

test("5b. a hung KV is cut off by the write timeout", async () => {
  const kv = createFakeKv({ execNeverResolves: true });
  const h = harness({ kv, config: { ...ENABLED, writeTimeoutMs: 25 } });
  const started = Date.now();
  const summary = await h.poll([liveRow()]);
  assert.ok(Date.now() - started < 1000, "returned promptly");
  assert.equal(summary.ok, false);
  assert.match(h.warnings[0].meta.error, /exceeded 25ms/);
});

test("5c. garbage input is survived", async () => {
  const { poll, kv } = harness();
  for (const rows of [null, undefined, "x", [], [null], [{}], [42]]) {
    const summary = await poll(rows);
    assert.equal(typeof summary, "object");
  }
  assert.equal(ops(kv, "hsetnx").length, 0);
  // A KV client with no pipeline at all must not escape either.
  const broken = await captureLivePoll(
    { rows: [liveRow()], scoresFromCache: false, nowMs: NOW },
    { kv: {}, state: createLiveCaptureState(), config: ENABLED, logWarn: () => {} }
  );
  assert.equal(broken.ok, false);
});

// ------------------------------------------------------------------ the cap

test("6. a whole match, polled every minute with goals and cards, stays under the hard cap", async () => {
  for (const step of [1, 3]) {
    const { kv, poll } = harness({ config: { ...ENABLED, minuteStep: step } });
    let at = NOW;
    let goals = 0;
    const tick = async (status, elapsed, extra = null) => {
      if (elapsed % 9 === 0) goals += 1;
      const row = liveRow({ status, elapsed, extra, score: { home: goals, away: 0 } });
      row.eventsResult.response = Array.from({ length: Math.min(goals * 3, 200) }, (_, i) => ({
        time: { elapsed: i % 120 },
        team: { id: AWAY },
        type: "Card",
        detail: "Yellow Card"
      }));
      at += 60_000;
      await poll([row], { at });
    };
    for (let m = 0; m <= 45; m += 1) await tick("1H", m);
    for (let x = 1; x <= 9; x += 1) await tick("1H", 45, x);
    for (let i = 0; i < 15; i += 1) await tick("HT", 45);
    for (let m = 46; m <= 90; m += 1) await tick("2H", m);
    for (let x = 1; x <= 12; x += 1) await tick("2H", 90, x);
    await tick("BT", 90);
    for (let m = 91; m <= 120; m += 1) await tick("ET", m);
    await tick("P", 120);
    await tick("PEN", 120);

    const fields = kv.fieldsOf(liveCaptureFixtureKey(9001));
    assert.ok(fields.length <= maxFieldsPerFixture(step), `step ${step}: ${fields.length} fields > cap ${maxFieldsPerFixture(step)}`);
    assert.ok(fields.filter((f) => f.startsWith("E:")).length <= MAX_EVENTS);
    for (const marker of ["T:PEN", "S:HT", "S:BT", "S:P"]) assert.ok(fields.includes(marker), `${marker} missing`);
  }
});

// ------------------------------------------------------------------ telemetry

test("7. counters are sampled: a few HINCRBYs per flush interval, on a pipeline that was going out anyway", async () => {
  const { kv, poll, state } = harness();
  await poll([liveRow()]); // the first pipeline flushes what is known so far
  assert.deepEqual(
    ops(kv, "hincrby").map(([, key, field, by]) => [key, field, by]),
    [[liveCaptureCountersKey(DAY), "attempted", 1]]
  );
  assert.equal(kv.ttl.get(liveCaptureCountersKey(DAY)), TTL, "the counters hash expires too");

  // Inside the interval: plenty of activity, no counter commands.
  for (let i = 1; i <= 5; i += 1) await poll([liveRow({ elapsed: 16 + i * 3 })], { at: NOW + i * 75_000 });
  assert.equal(ops(kv, "hincrby").length, 1, "still only the first flush");
  assert.ok(state.pending.stored >= 5, "the rest is held in process");

  // After the interval, the next real write carries them.
  await poll([liveRow({ elapsed: 40 })], { at: NOW + COUNTER_FLUSH_INTERVAL_MS + 1000 });
  const counters = Object.fromEntries(kv.hashes.get(liveCaptureCountersKey(DAY)));
  assert.equal(counters.attempted, 7);
  assert.ok(counters.stored >= 6);
  assert.ok(counters.milestone >= 2, "15' and 30' were reached");
});

test("7b. a budget-denied poll is remembered without a command — capture never goes to fetch it", async () => {
  const { kv, poll, state } = harness();
  noteLivePollDenied("api_budget_hard_stop", { config: ENABLED, state });
  noteLivePollDenied("api_local_rate_limit", { config: ENABLED, state });
  noteLivePollDenied(undefined, { config: ENABLED, state });
  assert.deepEqual(kv.commands, [], "remembering costs nothing");
  assert.deepEqual(state.pending, { budget_denied: 2, poll_failed: 1 });
  await poll([liveRow()]);
  const counters = Object.fromEntries(kv.hashes.get(liveCaptureCountersKey(DAY)));
  assert.deepEqual([counters.budget_denied, counters.poll_failed], [2, 1]);
});

test("7c. counters that could not be flushed are kept for the next flush", async () => {
  const kv = createFakeKv({ execError: new Error("down") });
  const h = harness({ kv });
  await h.poll([liveRow()]);
  assert.equal(h.state.pending.attempted, 1);
  assert.equal(h.state.pending.storage_failed, 2);
  kv.state.execError = null;
  await h.poll([liveRow()], { at: NOW + 75_000 });
  const counters = Object.fromEntries(kv.hashes.get(liveCaptureCountersKey(DAY)));
  assert.deepEqual([counters.attempted, counters.storage_failed], [2, 2]);
});

// ------------------------------------------------------------------ boundaries

test("8. config is clamped", () => {
  const config = readLiveCaptureConfig({ LIVE_CAPTURE_ENABLED: "1", LIVE_CAPTURE_TTL_DAYS: "9999", LIVE_CAPTURE_MINUTE_STEP: "0" });
  assert.deepEqual([config.ttlSeconds, config.minuteStep], [90 * 86400, 1]);
  assert.equal(readLiveCaptureConfig({ LIVE_CAPTURE_TTL_DAYS: "1" }).ttlSeconds, 7 * 86400);
  assert.equal(readLiveCaptureConfig({ LIVE_CAPTURE_TTL_DAYS: "abc" }).ttlSeconds, TTL);
  assert.equal(readLiveCaptureConfig({}).minuteStep, 3);
});

test("9. the capture layer reaches neither the provider, nor the prediction path, nor Postgres", () => {
  const dir = new URL("../../server-utils/liveCapture/", import.meta.url);
  for (const file of ["liveCaptureSnapshot.js", "liveCaptureStore.js", "liveCaptureCoverage.js"]) {
    const source = readFileSync(new URL(file, dir), "utf8");
    // Comments explain the very things this test forbids, so they are stripped first.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    const imports = [...code.matchAll(/(?:from|import\()\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(imports.length > 0 || file === "liveCaptureSnapshot.js", `${file}: no imports found — is the pattern still right?`);
    for (const spec of imports) {
      assert.ok(
        spec.startsWith("./") || spec === "../observability/logger.js" || spec === "../fetcher.js",
        `${file} imports ${spec}`
      );
    }
    for (const banned of ["getWithCache", "supabase", "predictions_history", "prediction_snapshots", "PredictionEngine", "pipeline/", "evaluateApiBudget", "fetch("]) {
      assert.equal(code.includes(banned), false, `${file} must not reference ${banned}`);
    }
  }
  assert.equal(LIVE_CAPTURE_KEY_PREFIX, "footy_live_capture:v1");
  assert.ok(!LIVE_CAPTURE_KEY_PREFIX.startsWith("req:") && !LIVE_CAPTURE_KEY_PREFIX.includes("prediction"));
});

// ------------------------------------------------------------------ the per-instance daily command cap
//
// The cap bounds ONE process for ONE UTC day. It is not a guard on the Upstash monthly
// quota: every warm instance has its own count. What these tests hold it to is exact
// accounting of the commands this store sends, a hard stop, a midnight reset, and
// never a KV command spent on the bookkeeping itself.

const capConfig = (cap) => readLiveCaptureConfig({ LIVE_CAPTURE_ENABLED: "1", LIVE_CAPTURE_DAILY_COMMAND_CAP: cap });
/** liveRow() on a cold instance: M:1:15 + E:1 + EXPIRE fx + SADD day + EXPIRE day + HINCRBY attempted + EXPIRE counters. */
const FIRST_POLL_COMMANDS = 7;
const manyRows = (n, over = {}) => Array.from({ length: n }, (_, i) => liveRow({ fixtureId: 7000 + i, ...over }));

test("10. with the flag on, a missing or invalid cap fails CLOSED — capture stays dark", async () => {
  for (const cap of [undefined, null, "", "   ", "0", "-5", "abc", "1.5", "NaN", "Infinity", "1e400", true]) {
    const config = capConfig(cap);
    assert.equal(config.enabled, false, `cap ${JSON.stringify(cap)} must not enable capture`);
    assert.equal(config.disabledReason, "invalid_command_cap");
    assert.equal(config.dailyCommandCap, null);
    const { kv, poll } = harness({ config });
    const summary = await poll([liveRow(), liveRow({ fixtureId: 9002, status: "FT" })]);
    assert.deepEqual([summary.enabled, summary.disabledReason], [false, "invalid_command_cap"]);
    assert.equal(kv.state.pipelines, 0);
    assert.deepEqual(kv.commands, []);
  }
  assert.deepEqual([parseDailyCommandCap("250"), parseDailyCommandCap(" 1e3 "), parseDailyCommandCap(42), parseDailyCommandCap("007")], [250, 1000, 42, 7]);
  assert.equal(capConfig("250").enabled, true);
  assert.equal(capConfig("250").dailyCommandCap, 250);

  // A hand-built config that forgot the cap is refused the same way.
  const noCap = await captureLivePoll(
    { rows: [liveRow()], scoresFromCache: false, nowMs: NOW },
    { kv: createFakeKv(), state: createLiveCaptureState(), config: { ...ENABLED, dailyCommandCap: undefined }, logWarn: () => {} }
  );
  assert.deepEqual([noCap.enabled, noCap.disabledReason], [false, "invalid_command_cap"]);
});

test("10b. every command put on the pipeline is counted: snapshots, expirations, day index and counters", async () => {
  const { kv, poll, state } = harness({ config: capConfig("1000") });
  const first = await poll([liveRow()]);
  assert.equal(kv.commands.length, FIRST_POLL_COMMANDS, "the fake saw exactly these commands");
  assert.deepEqual(
    kv.commands.map((c) => c[0]),
    ["hsetnx", "hsetnx", "expire", "sadd", "expire", "hincrby", "expire"],
    "and they are of every kind the store emits"
  );
  assert.equal(first.commands, FIRST_POLL_COMMANDS);
  assert.equal(state.commandsIssued, FIRST_POLL_COMMANDS, "the ledger equals what was sent — not requests, not snapshots");

  const second = await poll([liveRow({ elapsed: 19 })], { at: NOW + 180_000 });
  assert.equal(second.commands, 1, "one new time slot, nothing else was due");
  assert.equal(state.commandsIssued, kv.commands.length);

  const duplicate = await poll([liveRow({ elapsed: 20 })], { at: NOW + 200_000 });
  assert.equal(duplicate.commands, 0);
  assert.equal(state.commandsIssued, kv.commands.length, "a poll that sends nothing spends nothing");

  // A counter flush is spent from the same budget as the snapshots.
  const before = state.commandsIssued;
  const flush = await poll([liveRow({ elapsed: 40 })], { at: NOW + COUNTER_FLUSH_INTERVAL_MS + 1000 });
  assert.ok(ops(kv, "hincrby").length > 1, "the flush went out");
  assert.equal(state.commandsIssued - before, flush.commands);
  assert.equal(state.commandsIssued, kv.commands.length);
});

test("10c. the cap is reached: the poll that would cross it is refused WHOLE, and the rest of the UTC day is dark", async () => {
  // Non-snapshot commands count: a first poll is 7 commands, of which only 2 are snapshots.
  const tight = harness({ config: capConfig("6") });
  const refusedAtOnce = await tight.poll([liveRow()]);
  assert.equal(refusedAtOnce.capped, true, "7 > 6, even though only 2 snapshots were involved");
  assert.deepEqual(tight.kv.commands, []);

  const { kv, poll, state, warnings } = harness({ config: capConfig("9") });
  await poll([liveRow()]); // 7
  const fits = await poll([liveRow({ elapsed: 19 })], { at: NOW + 180_000 }); // +1 = 8
  assert.equal(fits.capped, false);
  assert.equal(state.commandsIssued, 8);

  const sentBefore = kv.commands.length;
  const over = await poll(manyRows(24, { elapsed: 22 }), { at: NOW + 360_000 }); // 24 × 5 = 120 commands: does not fit
  assert.equal(over.capped, true);
  assert.equal(over.ok, true, "being capped is not a failure");
  assert.deepEqual([over.stored, over.commands, over.attempted], [0, 0, 24]);
  assert.equal(kv.commands.length, sentBefore, "nothing was sent — not even the part that would have fit");
  assert.equal(kv.state.pipelines, 2, "no pipeline was built for the refused poll");
  assert.equal(state.commandsIssued, 8, "a refused poll spends nothing");
  assert.equal(state.capExhausted, true);
  assert.deepEqual(warnings.map((w) => w.event), ["live_capture.command_cap_reached"]);
  assert.deepEqual(warnings[0].meta, { day: DAY, dailyCommandCap: 9, commandsIssued: 8, refusedCommands: 120, scope: "per_instance" });

  // One command would still fit under the cap — but the day is dark now. No retry, no
  // partial send, no second log line; a goal in this stretch is simply not captured.
  for (let i = 1; i <= 5; i += 1) {
    const dark = await poll([liveRow({ elapsed: 22 + i * 3, score: { home: i, away: 0 } })], { at: NOW + 360_000 + i * 75_000 });
    assert.equal(dark.capped, true);
    assert.equal(dark.commands, 0);
    assert.deepEqual(dark.skipReasons, { command_cap: 1 });
  }
  assert.equal(kv.commands.length, sentBefore);
  assert.equal(kv.state.pipelines, 2);
  assert.equal(state.commandsIssued, 8);
  assert.equal(warnings.length, 1, "the notice is bounded: once per instance per UTC day");
  assert.equal(state.pending.command_capped, 6, "refusals are remembered for the next flush that can happen");
  assert.equal(kv.fieldsOf(liveCaptureFixtureKey(9001)).some((f) => f.startsWith("C:")), false, "dark means dark");
});

test("10d. the ledger resets at UTC midnight on this instance's clock, and capture resumes from zero", async () => {
  const { kv, poll, state, warnings } = harness({ config: capConfig("20") });
  const evening = Date.parse("2026-09-21T23:58:00.000Z");
  await poll([liveRow()], { at: evening }); // 7
  await poll([liveRow({ elapsed: 19 })], { at: evening + 60_000 }); // 8
  const refused = await poll(manyRows(24, { elapsed: 20 }), { at: evening + 90_000 });
  assert.equal(refused.capped, true);
  assert.deepEqual([state.commandDay, state.commandsIssued, state.capExhausted], ["2026-09-21", 8, true]);
  assert.equal(warnings.length, 1);

  const midnight = Date.parse("2026-09-22T00:00:00.000Z");
  const resumed = await poll([liveRow({ elapsed: 22 })], { at: midnight });
  assert.equal(resumed.capped, false);
  assert.deepEqual([state.commandDay, state.capExhausted], ["2026-09-22", false]);
  assert.equal(resumed.commands, 3, "M:1:21, plus the new day's index SADD + EXPIRE");
  assert.equal(state.commandsIssued, 3, "the count starts again from zero, not from 8");
  assert.ok(kv.fieldsOf(liveCaptureFixtureKey(9001)).includes("M:1:21"));
  assert.ok(kv.sets.has(liveCaptureDayKey("2026-09-22")));

  // The refusal counter can only reach KV once the instance may write again: it lands on the new day.
  await poll([liveRow({ elapsed: 40 })], { at: midnight + COUNTER_FLUSH_INTERVAL_MS + 1000 });
  const counters = Object.fromEntries(kv.hashes.get(liveCaptureCountersKey("2026-09-22")));
  assert.equal(counters.command_capped, 1);
  assert.equal(counters.attempted, 27, "1 + 24 (the refused poll was planned, not sent) + 1 + 1");
  assert.equal(state.commandsIssued, kv.commands.length - 8, "only this day's commands are on the ledger");

  // The notice is bounded per day, not per process lifetime: a new day that hits the cap logs again.
  const refusedAgain = await poll(manyRows(24, { elapsed: 45 }), { at: midnight + COUNTER_FLUSH_INTERVAL_MS + 2000 });
  assert.equal(refusedAgain.capped, true);
  assert.deepEqual(warnings.map((w) => w.meta.day), ["2026-09-21", "2026-09-22"]);
});

test("10d2. the ledger never rolls BACKWARDS: a poll stamped before midnight but handled after one stamped past it is charged to the new day", async () => {
  const { kv, poll, state, warnings } = harness({ config: capConfig("20") });
  const beforeMidnight = Date.parse("2026-09-21T23:59:59.900Z");
  const afterMidnight = Date.parse("2026-09-22T00:00:00.100Z");
  await poll([liveRow({ elapsed: 30 })], { at: afterMidnight }); // the new day: 7 commands
  assert.deepEqual([state.commandDay, state.commandsIssued], ["2026-09-22", 7]);

  // Two polls were in flight across midnight; the older one lands second.
  const late = await poll([liveRow({ elapsed: 27 })], { at: beforeMidnight }); // M:1:27 (1) + the 21st's day index (2)
  assert.equal(late.capped, false);
  assert.equal(late.commands, 3);
  assert.deepEqual([state.commandDay, state.commandsIssued], ["2026-09-22", 10], "charged to the 22nd, which was NOT reset to zero");
  assert.ok(kv.sets.has(liveCaptureDayKey("2026-09-21")), "the snapshot itself still belongs to the day it was observed on");

  // …and a late poll cannot clear a reached cap either.
  const refused = await poll(manyRows(24, { elapsed: 33 }), { at: afterMidnight + 1000 });
  assert.equal(refused.capped, true);
  assert.equal(warnings[0].meta.day, "2026-09-22");
  const lateAgain = await poll([liveRow({ elapsed: 28, score: { home: 1, away: 0 } })], { at: beforeMidnight + 10 });
  assert.equal(lateAgain.capped, true, "the 22nd is dark, and a poll stamped on the 21st does not reopen it");
  assert.deepEqual([state.commandDay, state.capExhausted, state.commandsIssued], ["2026-09-22", true, 10]);
});

test("10e. the accounting spends no KV command of its own, and a send that fails or hangs still counts", async () => {
  const { kv, poll, state } = harness({ config: capConfig("1000") });
  await poll([liveRow()]);
  await poll([liveRow({ elapsed: 19 })], { at: NOW + 180_000 });
  assert.deepEqual([...new Set(kv.commands.map((c) => c[0]))].sort(), ["expire", "hincrby", "hsetnx", "sadd"], "no GET, HGETALL, SMEMBERS or INCR of any kind");
  assert.equal(state.commandsIssued, kv.commands.length);

  const failing = harness({ kv: createFakeKv({ execError: new Error("ERR max requests limit exceeded") }), config: capConfig("1000") });
  const failed = await failing.poll([liveRow()]);
  assert.equal(failed.ok, false);
  assert.equal(failing.state.commandsIssued, FIRST_POLL_COMMANDS, "counted when sent, whatever KV answered");

  const hung = harness({ kv: createFakeKv({ execNeverResolves: true }), config: { ...capConfig("1000"), writeTimeoutMs: 20 } });
  const timedOut = await hung.poll([liveRow()]);
  assert.equal(timedOut.ok, false);
  assert.equal(hung.state.commandsIssued, FIRST_POLL_COMMANDS, "a timed-out pipeline has still spent its budget");
  assert.equal(hung.state.capExhausted, false, "a failure is not the cap");
});

test("10f. two in-process contexts are bounded independently — the cap is per instance, never shared", async () => {
  const kv = createFakeKv(); // one store underneath both "instances"
  const a = harness({ kv, config: capConfig("7") });
  const b = harness({ kv, config: capConfig("7") });

  await a.poll([liveRow()]); // a: 7 of 7
  const aOver = await a.poll([liveRow({ elapsed: 19 })], { at: NOW + 180_000 });
  assert.equal(aOver.capped, true);

  // b has a cold memo and its own ledger: it re-sends what a already wrote (KV says 0) and is charged for it.
  const bFirst = await b.poll([liveRow({ elapsed: 19 })], { at: NOW + 180_000 });
  assert.equal(bFirst.capped, false, "a's exhaustion means nothing to b");
  assert.deepEqual([bFirst.stored, bFirst.deduplicated], [1, 1], "M:1:18 was new in KV; E:1 already existed");
  assert.deepEqual([a.state.commandsIssued, b.state.commandsIssued], [7, 7]);
  const bOver = await b.poll([liveRow({ elapsed: 22 })], { at: NOW + 360_000 });
  assert.equal(bOver.capped, true, "b then hits its OWN cap");
  assert.equal(kv.commands.length, 14, "the store received both budgets in full: 2 × 7 — that is what 'per instance' costs");
});
