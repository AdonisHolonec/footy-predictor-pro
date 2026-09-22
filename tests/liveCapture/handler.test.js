/**
 * Live Predictor Lab — Phase 1. The hook inside the real live poll.
 *
 * This drives api/fixtures.js's actual handler (view=live) with the provider faked at
 * the getWithCache boundary — the first test to exercise handleLive at all. What it
 * holds the capture hook to:
 *
 *   · the response is byte-identical with capture dark, enabled, and failing
 *   · not one provider call is added, and a denied poll is never retried
 *   · a refused poll still answers exactly as it did before
 *
 * Needs --experimental-test-module-mocks (mock.module), like the other handler suites.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createFakeKv, statsBlock } from "./fakeKv.js";

const HOME = 501;
const AWAY = 502;
const providerCalls = [];
/** `delayMs` slows every faked provider read; `scoresReturnedAt` is when the /fixtures rows were handed back. */
const ctl = { scores: null, stats: () => null, events: () => null, delayMs: 0, scoresReturnedAt: 0 };
const narration = { delayMs: 0, finishedAt: [] };
const sleep = (ms) => (ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
let fakeKv = createFakeKv();

mock.module("@vercel/kv", {
  namedExports: {
    createClient: () => ({
      get: async () => null,
      set: async () => "OK",
      hincrby: async () => 1,
      hgetall: async () => null,
      incr: async () => 1,
      expire: async () => 1
    })
  }
});
mock.module("../../server-utils/fetcher.js", {
  namedExports: {
    getWithCache: async (endpoint, params) => {
      providerCalls.push([endpoint, { ...params }]);
      await sleep(ctl.delayMs);
      if (endpoint === "/fixtures") {
        ctl.scoresReturnedAt = Date.now();
        return ctl.scores;
      }
      if (endpoint === "/fixtures/statistics") return ctl.stats(params.fixture);
      if (endpoint === "/fixtures/events") return ctl.events(params.fixture);
      throw new Error(`unexpected provider endpoint ${endpoint}`);
    },
    getApiUsage: async () => ({ count: 0, limit: 7500 }),
    getApiUsageHistory: async () => [],
    getDailyCacheStats: async () => ({}),
    getLocalCacheStats: () => ({}),
    recordObservation: async () => null,
    // A stable proxy, so each test can swap the store underneath it.
    kv: { pipeline: () => fakeKv.pipeline() }
  }
});
mock.module("../../server-utils/momentum/narrateMatchState.js", {
  namedExports: {
    narrateMatchState: async () => {
      await sleep(narration.delayMs);
      narration.finishedAt.push(Date.now());
      return "narrative";
    }
  }
});
mock.module("../../server-utils/observability/requestMonitor.js", {
  namedExports: { attachRequestMonitor: () => {} }
});

process.env.CRON_SECRET = "test-cron-secret";
// The per-instance daily command cap is REQUIRED for capture to be on at all (test 10 removes it).
process.env.LIVE_CAPTURE_DAILY_COMMAND_CAP = "100000";
const { default: handler } = await import("../../api/fixtures.js");

function providerFixture(id, { status = "1H", elapsed = 16, extra = null, home = 0, away = 0 } = {}) {
  return {
    fixture: {
      id,
      date: "2026-09-21T16:00:00+00:00",
      referee: "R. Referee, England",
      status: { short: status, elapsed, extra },
      periods: { first: 1790006400, second: null }
    },
    league: { id: 39, season: 2026 },
    teams: { home: { id: HOME, name: "Home FC" }, away: { id: AWAY, name: "Away FC" } },
    goals: { home, away },
    score: { halftime: { home: null, away: null } }
  };
}

const statsOk = () => ({
  ok: true,
  fromCache: false,
  data: {
    response: [
      // "" is what the provider sends for an uncounted stat: the WIDGET reads it as 0.
      statsBlock(HOME, { possession: "58%", shotsTotal: 5, shotsOnTarget: 2, corners: "", yellowCards: 1, redCards: null }),
      statsBlock(AWAY, { possession: "42%", shotsTotal: 3, shotsOnTarget: 1, corners: 2, yellowCards: 0, redCards: null })
    ]
  }
});
const eventsOk = () => ({
  ok: true,
  fromCache: false,
  data: {
    response: [
      { time: { elapsed: 9, extra: null }, team: { id: HOME }, player: { id: 1, name: "H. One" }, assist: {}, type: "Card", detail: "Yellow Card" }
    ]
  }
});

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
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

async function livePoll(ids, { enabled }) {
  if (enabled) process.env.LIVE_CAPTURE_ENABLED = "1";
  else delete process.env.LIVE_CAPTURE_ENABLED;
  providerCalls.length = 0;
  const res = mockRes();
  await handler(
    { method: "GET", query: { view: "live", ids: ids.join(",") }, headers: { "x-cron-secret": "test-cron-secret" } },
    res
  );
  return { res, calls: providerCalls.map(([endpoint, params]) => `${endpoint}?${JSON.stringify(params)}`) };
}

function scenario(inPlayId, finishedId, notStartedId) {
  ctl.scores = {
    ok: true,
    fromCache: false,
    data: {
      response: [
        providerFixture(inPlayId),
        providerFixture(finishedId, { status: "FT", elapsed: 90, home: 2, away: 1 }),
        providerFixture(notStartedId, { status: "NS", elapsed: null })
      ]
    }
  };
  ctl.stats = () => statsOk();
  ctl.events = () => eventsOk();
}

test.beforeEach(() => {
  fakeKv = createFakeKv();
});

const LIVE_FIXTURE_KEYS = ["elapsed", "extra", "firstHalfGoals", "id", "liveEvents", "momentum", "momentumNarrative", "referee", "score", "status"];

test("1. dark: the live response is the documented contract, and KV is never touched", async () => {
  scenario(101, 102, 103);
  const { res, calls } = await livePoll([101, 102, 103], { enabled: false });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body), ["ok", "fixtures"]);
  for (const fx of res.body.fixtures) {
    assert.deepEqual(Object.keys(fx).sort(), LIVE_FIXTURE_KEYS, "no capture field may leak into the payload");
  }
  assert.deepEqual(calls, [
    '/fixtures?{"ids":"101-102-103"}',
    '/fixtures/statistics?{"fixture":101}',
    '/fixtures/events?{"fixture":101}'
  ]);
  assert.equal(fakeKv.state.pipelines, 0);
});

test("2. enabled: same bytes out, same provider calls in — and the observation is stored", async () => {
  scenario(201, 202, 203);
  const dark = await livePoll([201, 202, 203], { enabled: false });
  const lit = await livePoll([201, 202, 203], { enabled: true });

  assert.equal(JSON.stringify(lit.res.body), JSON.stringify(dark.res.body), "capture must not change one byte of the response");
  assert.deepEqual(lit.calls, dark.calls, "and must not add, repeat or reorder one provider call");
  assert.equal(lit.res.statusCode, 200);

  assert.equal(fakeKv.state.pipelines, 1, "one pipelined write for the whole poll");
  const inPlay = fakeKv.hashes.get("footy_live_capture:v1:fx:201");
  assert.deepEqual([...inPlay.keys()], ["M:1:15", "E:1"]);
  const snap = inPlay.get("M:1:15");
  assert.deepEqual(
    [snap.leagueId, snap.season, snap.kickoffAt, snap.homeTeamId, snap.awayTeamId, snap.status, snap.elapsedMinute, snap.scoreSource, snap.statsSource],
    [39, 2026, "2026-09-21T16:00:00.000Z", HOME, AWAY, "1H", 16, "fresh", "fresh"]
  );
  assert.equal(snap.providerPeriodFirstStart, "2026-09-21T16:00:00.000Z");

  // The reason capture reads the RAW payload: the widget turns "" into 0, the dataset must not.
  assert.equal(lit.res.body.fixtures[0].momentum.raw.home.corners, 0, "existing widget behaviour, untouched");
  assert.equal(snap.cornersHome, null, "the snapshot keeps 'unknown' as unknown");
  assert.equal(snap.cornersAway, 2);

  // FT was in the batch: its marker is stored with no statistics invented; NS is not captured.
  const ft = fakeKv.hashes.get("footy_live_capture:v1:fx:202").get("T:FT");
  assert.deepEqual([ft.homeScore, ft.awayScore, ft.statsSource, ft.shotsTotalHome], [2, 1, "not_fetched", null]);
  assert.equal(fakeKv.hashes.has("footy_live_capture:v1:fx:203"), false);
});

test("3. a failing KV changes nothing the client sees", async () => {
  scenario(301, 302, 303);
  const dark = await livePoll([301, 302, 303], { enabled: false });
  fakeKv = createFakeKv({ execError: new Error("ERR max requests limit exceeded") });
  const failing = await livePoll([301, 302, 303], { enabled: true });
  assert.equal(failing.res.statusCode, 200);
  assert.equal(JSON.stringify(failing.res.body), JSON.stringify(dark.res.body));
  assert.deepEqual(failing.calls, dark.calls);
});

test("4. a cached score read stores no in-play snapshot, and still fetches nothing extra", async () => {
  scenario(401, 402, 403);
  ctl.scores = { ...ctl.scores, fromCache: true };
  const { calls } = await livePoll([401, 402, 403], { enabled: true });
  assert.equal(calls.length, 3);
  assert.equal(fakeKv.hashes.has("footy_live_capture:v1:fx:401"), false, "no in-play snapshot from a replayed payload");
  assert.ok(fakeKv.hashes.get("footy_live_capture:v1:fx:402")?.has("T:FT"), "a settled FT may be recorded from cache");
  const [dayKey] = [...fakeKv.sets.keys()];
  assert.deepEqual([...fakeKv.sets.get(dayKey)].sort(), [401, 402], "both were observed");
});

test("5. a budget-denied poll answers exactly as before, is not retried, and writes nothing", async () => {
  for (const enabled of [false, true]) {
    ctl.scores = { ok: false, error: "Circuit breaker: daily API budget", reason: "api_budget_hard_stop", fromCache: false };
    const { res, calls } = await livePoll([501, 502], { enabled });
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { ok: false, error: "Circuit breaker: daily API budget" });
    assert.deepEqual(calls, ['/fixtures?{"ids":"501-502"}'], "one call, no retry, no statistics or events");
    assert.deepEqual(fakeKv.commands, []);
  }
});

test("6. statistics refused by the budget circuit: the widget hides momentum as before, capture records why", async () => {
  scenario(601, 602, 603);
  ctl.stats = () => ({ ok: false, reason: "api_budget_hard_stop", fromCache: false });
  const { res, calls } = await livePoll([601, 602, 603], { enabled: true });
  assert.equal(res.body.fixtures[0].momentum, null);
  assert.equal(calls.length, 3, "capture did not go and fetch what the circuit refused");
  const snap = fakeKv.hashes.get("footy_live_capture:v1:fx:601").get("M:1:15");
  assert.deepEqual(
    [snap.statsSource, snap.statsStatus, snap.statsReason, snap.shotsTotalHome],
    ["unavailable", "request_failed", "api_budget_hard_stop", null]
  );
});

// ------------------------------------------------------------------ wiring that must not drift

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES_SOURCE = readFileSync(join(ROOT, "api/fixtures.js"), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

test("7. the live handler still makes exactly its three provider calls, and the hook sits after them", () => {
  const live = codeOnly(
    FIXTURES_SOURCE.slice(
      FIXTURES_SOURCE.indexOf("// -------------------- Live-scores handler"),
      FIXTURES_SOURCE.indexOf("async function handleXg")
    )
  );
  assert.equal((live.match(/getWithCache\(/g) || []).length, 3);
  assert.ok(live.indexOf("captureLivePoll(") > live.indexOf("const fixtures = await Promise.all("), "capture runs after the provider results exist");
  assert.ok(live.indexOf("captureLivePoll(") < live.lastIndexOf("res.status(200).json("), "and before the response, so the runtime cannot drop it");
  assert.match(live, /noteLivePollDenied\(r\.reason\);\s*return res\.status\(502\)/, "a denied poll is only remembered");
  // The strip list that keeps server-only fields out of the payload is exactly as it was.
  assert.match(live, /\(\{ inPlay, homeTeamId, awayTeamId, homeTeamName, awayTeamName, \.\.\.f \}\)/);
  // The capture clock is read right after the fixture rows arrive — after the read, before anything else.
  const clockAt = live.indexOf("const captureNowMs = Date.now();");
  assert.ok(clockAt > live.indexOf('getWithCache("/fixtures", { ids: idsParam }'), "after the /fixtures read");
  assert.ok(clockAt < live.indexOf("if (!r.ok)"), "before the result is even inspected");
  assert.match(live, /captureLivePoll\(\{[^}]*nowMs: captureNowMs/, "and it is the clock the capture layer is handed");
});

test("9. capturedAt is stamped when the fixture rows arrive — not after statistics, events or narration", async () => {
  scenario(901, 902, 903);
  ctl.delayMs = 40;
  narration.delayMs = 40;
  narration.finishedAt.length = 0;
  try {
    const { res, calls } = await livePoll([901, 902, 903], { enabled: true });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 3);
    const snap = fakeKv.hashes.get("footy_live_capture:v1:fx:901").get("M:1:15");
    const lag = snap.capturedAtMs - ctl.scoresReturnedAt;
    assert.ok(lag >= 0, `stamped ${lag}ms BEFORE the rows arrived`);
    assert.ok(lag < 50, `stamped ${lag}ms after the rows arrived — it should be immediate`);
    // statistics/events (40 ms) then narration (40 ms) all finished well after the stamp.
    assert.ok(narration.finishedAt[0] - snap.capturedAtMs >= 75, `narration finished only ${narration.finishedAt[0] - snap.capturedAtMs}ms after the stamp`);
    const ft = fakeKv.hashes.get("footy_live_capture:v1:fx:902").get("T:FT");
    assert.equal(ft.capturedAtMs, snap.capturedAtMs, "one clock for every row of the poll");
  } finally {
    ctl.delayMs = 0;
    narration.delayMs = 0;
  }
});

test("10. flag on but no valid daily command cap: capture fails closed and the response is unchanged", async () => {
  scenario(1001, 1002, 1003);
  const dark = await livePoll([1001, 1002, 1003], { enabled: false });
  const saved = process.env.LIVE_CAPTURE_DAILY_COMMAND_CAP;
  try {
    for (const cap of [undefined, "", "0", "abc"]) {
      if (cap === undefined) delete process.env.LIVE_CAPTURE_DAILY_COMMAND_CAP;
      else process.env.LIVE_CAPTURE_DAILY_COMMAND_CAP = cap;
      const lit = await livePoll([1001, 1002, 1003], { enabled: true });
      assert.equal(lit.res.statusCode, 200);
      assert.equal(JSON.stringify(lit.res.body), JSON.stringify(dark.res.body));
      assert.deepEqual(lit.calls, dark.calls);
    }
    assert.equal(fakeKv.state.pipelines, 0, "not one pipeline was built");
    assert.deepEqual(fakeKv.commands, []);
  } finally {
    process.env.LIVE_CAPTURE_DAILY_COMMAND_CAP = saved;
  }
});

test("10b. an instance past its daily cap answers the live poll exactly as before, and sends nothing", async () => {
  scenario(1101, 1102, 1103);
  const dark = await livePoll([1101, 1102, 1103], { enabled: false });
  const saved = process.env.LIVE_CAPTURE_DAILY_COMMAND_CAP;
  process.env.LIVE_CAPTURE_DAILY_COMMAND_CAP = "3"; // the first poll alone needs more than this
  try {
    const capped = await livePoll([1101, 1102, 1103], { enabled: true });
    assert.equal(JSON.stringify(capped.res.body), JSON.stringify(dark.res.body));
    assert.deepEqual(capped.calls, dark.calls, "no provider call was added or repeated");
    assert.equal(fakeKv.state.pipelines, 0);
    assert.deepEqual(fakeKv.commands, []);
  } finally {
    process.env.LIVE_CAPTURE_DAILY_COMMAND_CAP = saved;
  }
});

test("8. no new serverless function, no new cron, no prediction-path or Postgres reach", () => {
  const listJs = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return listJs(full);
      return name.endsWith(".js") ? [full] : [];
    });
  assert.equal(listJs(join(ROOT, "api")).length, 12, "api/ is at the Hobby ceiling — capture adds no function");

  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  for (const cron of vercel.crons) assert.equal(/live|capture/i.test(cron.path), false, `cron ${cron.path}`);

  for (const file of listJs(join(ROOT, "server-utils/liveCapture"))) {
    const code = codeOnly(readFileSync(file, "utf8"));
    assert.equal(/PredictorV3|PredictionEngine|predictionsHistory|supabaseAdmin|ValueEngine|\.from\(/.test(code), false, file);
  }
});
