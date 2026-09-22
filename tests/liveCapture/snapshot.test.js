/**
 * Live Predictor Lab — Phase 1. The snapshot: what is recorded, and which slot it lands in.
 *
 * Everything here is pure, so nothing is faked. The two properties that matter most
 * for a research dataset are pinned hardest: a missing statistic is NEVER a zero, and
 * the capture rule is decided by the field name alone, so it is deterministic and the
 * per-fixture storage cap is structural.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CAPTURED_STATS,
  CLOCK_RUNNING_STATUSES,
  COVERAGE_WINDOWS,
  IN_PLAY_MARKER_STATUSES,
  LIVE_CAPTURE_SCHEMA_VERSION,
  MAX_CHANGE_LEVEL,
  MAX_EVENTS,
  buildLiveCaptureSnapshot,
  clampMinuteStep,
  coverageWindowForMinute,
  extractCaptureEvents,
  extractCaptureStats,
  maxFieldsPerFixture,
  resolveSnapshotSlots,
  snapshotHasStats
} from "../../server-utils/liveCapture/liveCaptureSnapshot.js";
import { extractFixtureMarketStats } from "../../server-utils/teamMarketRolling.js";
import { AWAY, HOME, liveRow, statsBlock } from "./fakeKv.js";

const NOW = Date.parse("2026-09-21T16:20:30.000Z");
const build = (over) => buildLiveCaptureSnapshot(liveRow(over), NOW);

// ------------------------------------------------------------------ 1. normalisation

test("1. a live row becomes the Phase 1 snapshot, with our clock and the provider's kept apart", () => {
  const { ok, snapshot, events } = build();
  assert.equal(ok, true);
  assert.deepEqual(snapshot, {
    v: LIVE_CAPTURE_SCHEMA_VERSION,
    fixtureId: 9001,
    capturedAt: "2026-09-21T16:20:30.000Z",
    capturedAtMs: NOW,
    kickoffAt: "2026-09-21T16:00:00.000Z",
    leagueId: 39,
    season: 2026,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    status: "1H",
    elapsedMinute: 16,
    extraMinute: null,
    providerPeriodFirstStart: "2026-09-21T16:00:00.000Z",
    providerPeriodSecondStart: null,
    homeScore: 0,
    awayScore: 0,
    possessionHome: 55,
    possessionAway: 45,
    shotsTotalHome: 4,
    shotsTotalAway: 2,
    shotsOnTargetHome: 2,
    shotsOnTargetAway: 0,
    cornersHome: 1,
    cornersAway: 0,
    yellowCardsHome: 0,
    yellowCardsAway: 1,
    redCardsHome: null,
    redCardsAway: null,
    shotsInsideBoxHome: 3,
    shotsInsideBoxAway: 1,
    shotsOutsideBoxHome: 1,
    shotsOutsideBoxAway: 1,
    expectedGoalsHome: 0.41,
    expectedGoalsAway: 0.12,
    scoreSource: "cache",
    statsSource: "fresh",
    statsStatus: "ok",
    statsReason: null,
    sideResolution: "teamId",
    eventsSource: "fresh",
    eventsReason: null,
    eventCount: 1,
    eventsRef: "E:1"
  });
  assert.equal(events.length, 1);
});

test("1b. capture time is OUR clock — never kickoff, never an event minute, never the provider's", () => {
  const a = buildLiveCaptureSnapshot(liveRow(), NOW).snapshot;
  const b = buildLiveCaptureSnapshot(liveRow(), NOW + 61_000).snapshot;
  assert.equal(b.capturedAtMs - a.capturedAtMs, 61_000, "capturedAt moves with our clock only");
  assert.equal(a.elapsedMinute, b.elapsedMinute, "the provider minute is untouched by it");
  assert.equal(a.kickoffAt, b.kickoffAt);
  assert.equal(buildLiveCaptureSnapshot(liveRow(), null).ok, false, "no clock, no snapshot");
  assert.equal(buildLiveCaptureSnapshot(liveRow(), 0).reason, "malformed_captured_at");
});

test("1c. a snapshot carries join REFERENCES only — no model output, no copied baseline", () => {
  const keys = Object.keys(build().snapshot).join(" ").toLowerCase();
  for (const banned of ["prob", "lambda", "confidence", "recommend", "odds", "signal", "model", "prediction", "payload"]) {
    assert.equal(keys.includes(banned), false, `snapshot must not carry "${banned}"`);
  }
});

// ------------------------------------------------------------------ 2. null vs zero

test("2. a missing statistic is NEVER a zero", () => {
  const absent = [null, "", " ", "%", " % ", false, true, "n/a", Number.NaN, -1];
  for (const value of absent) {
    const stats = extractCaptureStats(
      [statsBlock(HOME, { shotsTotal: value, possession: value }), statsBlock(AWAY, { shotsTotal: 3 })],
      HOME,
      AWAY
    );
    assert.equal(stats.home.shotsTotal, null, `shotsTotal ${JSON.stringify(value)} must be unknown`);
    assert.equal(stats.home.possession, null, `possession ${JSON.stringify(value)} must be unknown`);
    assert.equal(stats.away.shotsTotal, 3);
  }
  // A row that is not there at all is unknown too.
  const noRow = extractCaptureStats([statsBlock(HOME, {}), statsBlock(AWAY, { corners: 2 })], HOME, AWAY);
  for (const [name] of CAPTURED_STATS) assert.equal(noRow.home[name], null, `${name} with no row`);
});

test("2b. a real zero IS a zero, as a number or as the provider's string", () => {
  const stats = extractCaptureStats(
    [
      statsBlock(HOME, { shotsTotal: 0, corners: "0", possession: "0%", redCards: 0, expectedGoals: "0.00" }),
      statsBlock(AWAY, { shotsTotal: "7", possession: "55%" })
    ],
    HOME,
    AWAY
  );
  assert.deepEqual(
    { s: stats.home.shotsTotal, c: stats.home.corners, p: stats.home.possession, r: stats.home.redCards, x: stats.home.expectedGoals },
    { s: 0, c: 0, p: 0, r: 0, x: 0 }
  );
  assert.equal(stats.away.shotsTotal, 7);
  assert.equal(stats.away.possession, 55);
});

test("2c. the snapshot keeps the nulls: an all-null block is 'all_null', not a row of zeros", () => {
  const allNull = Object.fromEntries(CAPTURED_STATS.map(([name]) => [name, null]));
  const { snapshot } = build({
    statsResult: { ok: true, fromCache: false, reason: null, response: [statsBlock(HOME, allNull), statsBlock(AWAY, allNull)] }
  });
  assert.equal(snapshot.statsStatus, "all_null");
  for (const [name] of CAPTURED_STATS) {
    assert.equal(snapshot[`${name}Home`], null);
    assert.equal(snapshot[`${name}Away`], null);
  }
  assert.equal(snapshotHasStats(snapshot), false, "an all-null snapshot is not 'usable'");
  assert.equal(snapshotHasStats(build().snapshot), true);
});

test("2d. score and provider clock follow the same rule", () => {
  const { snapshot } = build({ score: { home: null, away: undefined }, elapsed: null, extra: "" });
  assert.equal(snapshot.homeScore, null);
  assert.equal(snapshot.awayScore, null);
  assert.equal(snapshot.elapsedMinute, null);
  assert.equal(snapshot.extraMinute, null);
  assert.equal(build({ score: { home: 0, away: 0 }, elapsed: 0, extra: 0 }).snapshot.extraMinute, 0, "a real 0 stays 0");
});

test("2e. same semantics as the Predictor V3 path's reader, without importing it at runtime", () => {
  const values = { possession: "61%", shotsTotal: 0, shotsOnTarget: "", corners: null, yellowCards: "2", redCards: " ", shotsInsideBox: 5, expectedGoals: "1.37" };
  const payload = { response: [statsBlock(HOME, values), statsBlock(AWAY, { shotsTotal: 9 })] };
  const theirs = extractFixtureMarketStats(payload)[0];
  const ours = extractCaptureStats(payload.response, HOME, AWAY).home;
  assert.deepEqual(
    { possession: ours.possession, shotsTotal: ours.shotsTotal, shotsOnTarget: ours.shotsOnTarget, corners: ours.corners, yellowCards: ours.yellowCards, redCards: ours.redCards, shotsInsideBox: ours.shotsInsideBox, expectedGoals: ours.expectedGoals },
    { possession: theirs.possession, shotsTotal: theirs.shotsTotal, shotsOnTarget: theirs.sot, corners: theirs.corners, yellowCards: theirs.yellowCards, redCards: theirs.redCards, shotsInsideBox: theirs.shotsInsideBox, expectedGoals: theirs.xg }
  );
  // …and the capture module does not depend on that module (or on anything else).
  const source = readFileSync(new URL("../../server-utils/liveCapture/liveCaptureSnapshot.js", import.meta.url), "utf8");
  assert.equal(/^\s*import\s/m.test(source), false, "liveCaptureSnapshot.js must stay import-free");
});

// ------------------------------------------------------------------ 3. what the payload really was

test("3. statistics status says what arrived, where the widget collapses it all to null", () => {
  const ok = [statsBlock(HOME, { corners: 3 }), statsBlock(AWAY, { corners: 1 })];
  assert.equal(extractCaptureStats(ok, HOME, AWAY).status, "ok");
  assert.equal(extractCaptureStats([], HOME, AWAY).status, "empty");
  assert.equal(extractCaptureStats(null, HOME, AWAY).status, "empty");
  const oneSided = extractCaptureStats([statsBlock(AWAY, { corners: 1 })], HOME, AWAY);
  assert.equal(oneSided.status, "one_sided");
  assert.equal(oneSided.home, null, "the missing side stays missing");
  assert.equal(oneSided.away.corners, 1);

  const denied = build({ statsResult: { ok: false, fromCache: false, reason: "api_budget_hard_stop", response: null } }).snapshot;
  assert.equal(denied.statsStatus, "request_failed");
  assert.equal(denied.statsReason, "api_budget_hard_stop");
  assert.equal(denied.shotsTotalHome, null);
  assert.equal(build({ statsResult: undefined }).snapshot.statsStatus, "not_fetched");
});

test("3b. sides are resolved by team id; a positional fallback is recorded, never silent", () => {
  const swapped = [statsBlock(AWAY, { corners: 9 }), statsBlock(HOME, { corners: 2 })];
  const byId = extractCaptureStats(swapped, HOME, AWAY);
  assert.equal(byId.sideResolution, "teamId");
  assert.equal(byId.home.corners, 2, "block order must not decide the side");
  assert.equal(byId.away.corners, 9);

  const unknownIds = extractCaptureStats([statsBlock(1, { corners: 4 }), statsBlock(2, { corners: 5 })], HOME, AWAY);
  assert.equal(unknownIds.sideResolution, "positional");
  assert.equal(unknownIds.home.corners, 4);
});

test("3c. provenance: fresh, cache, unavailable and never-fetched are four different things", () => {
  const cached = build({
    statsResult: { ...liveRow().statsResult, fromCache: true },
    eventsResult: { ...liveRow().eventsResult, fromCache: true }
  }).snapshot;
  assert.equal(cached.statsSource, "cache");
  assert.equal(cached.eventsSource, "cache");
  const failed = build({ eventsResult: { ok: false, fromCache: false, reason: "api_local_rate_limit", response: null } }).snapshot;
  assert.equal(failed.eventsSource, "unavailable");
  assert.equal(failed.eventsReason, "api_local_rate_limit");
  assert.equal(failed.eventCount, null, "unknown events are not 'zero events'");
  assert.equal(failed.eventsRef, null);
  const none = build({ statsResult: undefined, eventsResult: undefined }).snapshot;
  assert.equal(none.statsSource, "not_fetched");
  assert.equal(none.eventsSource, "not_fetched");
  assert.equal(build({ eventsResult: { ok: true, fromCache: false, response: [] } }).snapshot.eventCount, 0, "a fetched, empty list IS zero events");
  assert.equal(build({ scoreSource: "fresh" }).snapshot.scoreSource, "fresh");
});

// ------------------------------------------------------------------ 4. events

test("4. events keep the provider's own minute, extra, type and detail", () => {
  const events = extractCaptureEvents(
    [
      { time: { elapsed: 45, extra: null }, team: { id: HOME }, player: { id: 9, name: "H. Nine" }, assist: { id: 10, name: "H. Ten" }, type: "Goal", detail: "Normal Goal", comments: null },
      { time: { elapsed: 45, extra: 2 }, team: { id: AWAY }, player: { id: 4, name: "A. Four" }, assist: {}, type: "Card", detail: "Second Yellow card", comments: "Argument" },
      { time: { elapsed: 60, extra: null }, team: { id: 999 }, player: {}, assist: {}, type: "Var", detail: "Goal cancelled", comments: null },
      { time: { elapsed: null }, team: { id: HOME }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 70 }, team: { id: HOME }, type: "" }
    ],
    HOME,
    AWAY
  );
  assert.equal(events.length, 3, "an event with no minute or no type is dropped");
  assert.deepEqual(events[0], {
    minute: 45,
    extra: null,
    side: "home",
    teamId: HOME,
    type: "Goal",
    detail: "Normal Goal",
    playerId: 9,
    assistId: 10
  });
  // Ids, not names: the display names and the free-text comments are not stored at all.
  for (const ev of events) {
    for (const dropped of ["player", "assist", "comments"]) assert.equal(dropped in ev, false, `${dropped} must not be stored`);
  }
  assert.deepEqual([events[1].playerId, events[1].assistId], [4, null], "an assist with no id is null, not a missing key");
  assert.equal(events[0].extra, null, "45' is not 45+0'");
  assert.equal(events[1].extra, 2);
  assert.equal(events[1].detail, "Second Yellow card", "the raw detail survives, so a dismissal is never reclassified");
  assert.deepEqual([events[2].side, events[2].teamId], [null, 999], "an unattributable event keeps its team id and is not guessed");
});

test("4b. the event list is capped", () => {
  const many = Array.from({ length: MAX_EVENTS + 25 }, (_, i) => ({
    time: { elapsed: i % 90 },
    team: { id: HOME },
    type: "Card",
    detail: "Yellow Card"
  }));
  assert.equal(extractCaptureEvents(many, HOME, AWAY).length, MAX_EVENTS);
  assert.deepEqual(extractCaptureEvents("nope", HOME, AWAY), []);
});

// ------------------------------------------------------------------ 5. the capture rule

const slotsOf = (over, step) => resolveSnapshotSlots(build(over).snapshot, step);

test("5. elapsed-time progression: one time slot per `minuteStep` match minutes", () => {
  assert.deepEqual(slotsOf({ elapsed: 0 }, 3).slots, ["M:1:0"]);
  assert.deepEqual(slotsOf({ elapsed: 2 }, 3).slots, ["M:1:0"], "same bucket — a duplicate");
  assert.deepEqual(slotsOf({ elapsed: 3 }, 3).slots, ["M:1:3"], "next bucket — a new observation");
  assert.deepEqual(slotsOf({ elapsed: 16 }, 3).slots, ["M:1:15"]);
  assert.deepEqual(slotsOf({ elapsed: 16 }, 1).slots, ["M:1:16"]);
  assert.deepEqual(slotsOf({ elapsed: 16 }, 5).slots, ["M:1:15"]);
});

test("5b. first-half stoppage and the second half never collide", () => {
  assert.deepEqual(slotsOf({ status: "1H", elapsed: 45, extra: 3 }, 3).slots, ["M:1:48"]);
  assert.deepEqual(slotsOf({ status: "2H", elapsed: 48 }, 3).slots, ["M:2:48"]);
  assert.deepEqual(slotsOf({ status: "2H", elapsed: 46 }, 3).slots, ["M:2:45"]);
  assert.deepEqual(slotsOf({ status: "ET", elapsed: 95 }, 3).slots, ["M:3:93"]);
  // LIVE / VAR do not name their period, so the provider minute decides.
  assert.deepEqual(slotsOf({ status: "VAR", elapsed: 30 }, 3).slots, ["M:1:30"]);
  assert.deepEqual(slotsOf({ status: "LIVE", elapsed: 70 }, 3).slots, ["M:2:69"]);
  assert.deepEqual(slotsOf({ status: "LIVE", elapsed: 100 }, 3).slots, ["M:3:99"]);
});

test("5c. a score that did NOT change never suppresses a snapshot", () => {
  const at16 = slotsOf({ elapsed: 16, score: { home: 0, away: 0 } }, 3);
  const at19 = slotsOf({ elapsed: 19, score: { home: 0, away: 0 } }, 3);
  assert.notDeepEqual(at16.slots, at19.slots, "time alone opens a new slot, carrying whatever stats moved");
});

test("5d. a meaningful state change gets its own slot, even inside a taken time bucket", () => {
  assert.deepEqual(slotsOf({ elapsed: 16, score: { home: 0, away: 0 } }, 3).slots, ["M:1:15"], "0-0 with no reds is just the time slot");
  assert.deepEqual(slotsOf({ elapsed: 17, score: { home: 1, away: 0 } }, 3).slots, ["M:1:15", "C:1"], "a goal in the same bucket");
  assert.deepEqual(slotsOf({ elapsed: 17, score: { home: 1, away: 1 } }, 3).slots, ["M:1:15", "C:2"]);
  const red = liveRow({ elapsed: 17, score: { home: 1, away: 1 } });
  red.statsResult.response[0] = statsBlock(HOME, { redCards: 1 });
  assert.deepEqual(resolveSnapshotSlots(buildLiveCaptureSnapshot(red, NOW).snapshot, 3).slots, ["M:1:15", "C:3"], "a red card counts");
  // `null + 2` is 2 in JavaScript — an unknown side must not be read as "0 goals" here either.
  assert.deepEqual(slotsOf({ elapsed: 17, score: { home: null, away: 2 } }, 3).slots, ["M:1:15"], "an unknown score opens no change slot");
  assert.deepEqual(slotsOf({ elapsed: 17, score: { home: 2, away: undefined } }, 3).slots, ["M:1:15"]);
  assert.equal(slotsOf({ elapsed: 80, score: { home: 40, away: 40 } }, 3).slots.at(-1), `C:${MAX_CHANGE_LEVEL}`, "the level is clamped");
});

test("5e. a frozen clock yields ONE marker — half time is never captured on every poll", () => {
  for (const status of IN_PLAY_MARKER_STATUSES) {
    const a = slotsOf({ status, elapsed: 45 }, 3);
    const b = slotsOf({ status, elapsed: 45, score: { home: 2, away: 2 } }, 3);
    assert.deepEqual(a.slots, [`S:${status}`]);
    assert.deepEqual(b.slots, a.slots, "same marker whatever else the poll carries");
  }
  assert.deepEqual(slotsOf({ status: "FT", elapsed: 90 }, 3), { ok: true, kind: "terminal", slots: ["T:FT"], matchMinute: null, period: null });
  assert.deepEqual(slotsOf({ status: "AET", elapsed: 120 }, 3).slots, ["T:AET"]);
  assert.deepEqual(slotsOf({ status: "PST", elapsed: null }, 3).slots, ["T:PST"], "why a trajectory stopped is worth a marker");
});

test("5f. what is not live is not captured, and an unknown minute is not guessed", () => {
  assert.deepEqual(slotsOf({ status: "NS", elapsed: null }, 3), { ok: false, reason: "not_live" });
  assert.deepEqual(slotsOf({ status: "TBD" }, 3), { ok: false, reason: "not_live" });
  assert.deepEqual(slotsOf({ status: "1H", elapsed: null }, 3), { ok: false, reason: "no_elapsed" });
  assert.equal(build({ status: "" }).reason, "malformed_status");
  assert.equal(build({ fixtureId: "abc" }).reason, "malformed_fixture_id");
  assert.equal(build({ fixtureId: 0 }).reason, "malformed_fixture_id");
});

test("5g. the running and marker sets are exactly the statuses the live poll treats as in play", () => {
  const source = readFileSync(new URL("../../api/fixtures.js", import.meta.url), "utf8");
  const literal = source.match(/const LIVE_IN_PLAY_STATUSES = new Set\(\[([^\]]+)\]\)/)[1];
  const inPlay = literal.split(",").map((s) => s.trim().replace(/"/g, "")).sort();
  assert.deepEqual([...CLOCK_RUNNING_STATUSES, ...IN_PLAY_MARKER_STATUSES].sort(), inPlay);
});

// ------------------------------------------------------------------ 6. the hard cap

test("6. the per-fixture cap is structural: no provider input can create more fields", () => {
  const statuses = [...CLOCK_RUNNING_STATUSES, ...IN_PLAY_MARKER_STATUSES, "FT", "AET", "PEN", "CANC", "PST", "ABD", "AWD", "WO"];
  for (const step of [1, 3, 5]) {
    const seen = new Set();
    for (const status of statuses) {
      for (let elapsed = 0; elapsed <= 260; elapsed += 1) {
        for (const extra of [null, 0, 7, 45]) {
          for (const goals of [0, 1, 17, 90]) {
            const r = resolveSnapshotSlots(
              { status, elapsedMinute: elapsed, extraMinute: extra, homeScore: goals, awayScore: 0, redCardsHome: null, redCardsAway: 2 },
              step
            );
            if (r.ok) r.slots.forEach((s) => seen.add(s));
          }
        }
      }
    }
    const cap = maxFieldsPerFixture(step) - MAX_EVENTS;
    assert.ok(seen.size <= cap, `step ${step}: ${seen.size} distinct slots exceed the cap of ${cap}`);
  }
});

test("6b. the cap follows match duration and the capture cadence", () => {
  // 60 + 60 + 40 match minutes of slot table; one slot per `step` minutes.
  assert.equal(MAX_EVENTS, 40);
  assert.equal(maxFieldsPerFixture(1), 160 + 30 + 13 + 40);
  assert.equal(maxFieldsPerFixture(3), 20 + 20 + 14 + 30 + 13 + 40);
  assert.equal(maxFieldsPerFixture(5), 12 + 12 + 8 + 30 + 13 + 40);
  assert.equal(clampMinuteStep(undefined), 3);
  assert.equal(clampMinuteStep(""), 3);
  assert.equal(clampMinuteStep("0"), 1);
  assert.equal(clampMinuteStep(99), 5);
  assert.equal(clampMinuteStep("2"), 2);
});

// ------------------------------------------------------------------ 7. windows

test("7. research windows are hit within ±2 minutes and never manufactured", () => {
  assert.deepEqual(COVERAGE_WINDOWS, [15, 30, 45, 60, 75]);
  assert.deepEqual([13, 14, 15, 16, 17].map(coverageWindowForMinute), [15, 15, 15, 15, 15]);
  assert.deepEqual([12, 18, 20, 52, 90].map(coverageWindowForMinute), [null, null, null, null, null]);
  assert.equal(coverageWindowForMinute(null), null);
  assert.equal(coverageWindowForMinute(undefined), null);
  assert.equal(coverageWindowForMinute("x"), null);
  assert.equal(coverageWindowForMinute(47), 45);
  assert.equal(coverageWindowForMinute(77), 75);
});

// ------------------------------------------------------------------ 8. bytes

/**
 * Measured with this same builder BEFORE the review's H2 fix (MAX_EVENTS 80, player and
 * assist names and comments stored). Every `E:n` field holds the list as it stood, so
 * the cumulative figure is the sum of E:1 … E:cap — the O(n²) term the fix bounds.
 */
const BEFORE_H2 = Object.freeze({ eventStateAt40: 7855, cumulativeEventStates: 636093, worstFixtureStep3: 727176 });

/** A realistic provider event, names and all — what the builder is handed in production. */
function providerEvent(i) {
  const kind = i % 5 === 0 ? ["Goal", "Normal Goal"] : i % 3 === 0 ? ["subst", "Substitution 3"] : ["Card", "Yellow Card"];
  return {
    time: { elapsed: i % 95, extra: null },
    team: { id: i % 2 ? HOME : AWAY },
    player: { id: 1000 + i, name: "Firstname Lastname" },
    assist: { id: 2000 + i, name: "Assist Name" },
    type: kind[0],
    detail: kind[1],
    comments: i % 4 === 0 ? "Foul" : null
  };
}

/** The bytes of the `E:n` field the store writes for an n-event list (its exact shape, see liveCaptureStore.planRow). */
function eventStateBytes(n) {
  const row = liveRow();
  row.eventsResult.response = Array.from({ length: n }, (_, i) => providerEvent(i));
  const { snapshot, events } = buildLiveCaptureSnapshot(row, NOW);
  return JSON.stringify({ v: 1, fixtureId: 9001, capturedAt: snapshot.capturedAt, capturedAtMs: NOW, source: "fresh", events }).length;
}

test("8. per-fixture bytes are bounded: ids not names, and at most 40 event states", () => {
  const snapshotBytes = JSON.stringify({ ...build().snapshot, slot: "M:1:15" }).length;
  const states = Array.from({ length: MAX_EVENTS }, (_, i) => eventStateBytes(i + 1));
  const cumulative = states.reduce((a, b) => a + b, 0);
  const worstFixture = (maxFieldsPerFixture(3) - MAX_EVENTS) * snapshotBytes + cumulative;

  assert.ok(states.at(-1) <= BEFORE_H2.eventStateAt40 * 0.7, `E:40 is ${states.at(-1)} B, was ${BEFORE_H2.eventStateAt40} B`);
  assert.ok(cumulative <= BEFORE_H2.cumulativeEventStates * 0.2, `E:1…E:${MAX_EVENTS} total ${cumulative} B, was ${BEFORE_H2.cumulativeEventStates} B`);
  assert.ok(worstFixture <= BEFORE_H2.worstFixtureStep3 * 0.3, `worst fixture ${worstFixture} B, was ${BEFORE_H2.worstFixtureStep3} B`);
  assert.ok(worstFixture <= 210_000, `hard ceiling: a pathological fixture stays near 200 KB, got ${worstFixture} B`);
  assert.ok(snapshotBytes <= 1_100, `a snapshot stays about 1 KB, got ${snapshotBytes} B`);

  // Past the cap the state cannot grow, so the sum above IS the worst case.
  assert.equal(eventStateBytes(MAX_EVENTS + 30), eventStateBytes(MAX_EVENTS));
  assert.equal(buildLiveCaptureSnapshot({ ...liveRow(), eventsResult: { ...liveRow().eventsResult, response: Array.from({ length: 70 }, (_, i) => providerEvent(i)) } }, NOW).snapshot.eventsRef, `E:${MAX_EVENTS}`);
});

test("8b. what a later model needs survives the trim: goals, cards, substitutions, VAR verdicts and who was involved", () => {
  const events = extractCaptureEvents(
    [
      { time: { elapsed: 12, extra: null }, team: { id: HOME }, player: { id: 1, name: "Scorer" }, assist: { id: 2, name: "Passer" }, type: "Goal", detail: "Normal Goal", comments: null },
      { time: { elapsed: 30, extra: null }, team: { id: AWAY }, player: { id: 3, name: "X" }, assist: { id: null, name: null }, type: "Card", detail: "Red Card", comments: "Violent conduct" },
      { time: { elapsed: 46, extra: null }, team: { id: HOME }, player: { id: 4, name: "Out" }, assist: { id: 5, name: "In" }, type: "subst", detail: "Substitution 1", comments: null },
      { time: { elapsed: 63, extra: null }, team: { id: AWAY }, player: { id: 6, name: "Y" }, assist: { id: null, name: null }, type: "Var", detail: "Goal Disallowed - offside", comments: null },
      { time: { elapsed: 90, extra: 4 }, team: { id: HOME }, player: { id: 7, name: "Z" }, assist: { id: null, name: null }, type: "Goal", detail: "Penalty", comments: null }
    ],
    HOME,
    AWAY
  );
  assert.deepEqual(
    events.map((e) => [e.minute, e.extra, e.side, e.type, e.detail, e.playerId, e.assistId]),
    [
      [12, null, "home", "Goal", "Normal Goal", 1, 2],
      [30, null, "away", "Card", "Red Card", 3, null],
      [46, null, "home", "subst", "Substitution 1", 4, 5],
      [63, null, "away", "Var", "Goal Disallowed - offside", 6, null],
      [90, 4, "home", "Goal", "Penalty", 7, null]
    ]
  );
  assert.deepEqual(Object.keys(events[0]).sort(), ["assistId", "detail", "extra", "minute", "playerId", "side", "teamId", "type"]);
});
