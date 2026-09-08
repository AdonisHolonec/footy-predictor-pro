import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGlobalSpecialBets,
  buildGlobalSystemBets,
  collectGlobalCandidates,
  diversifyGlobalCandidates,
  rankGlobalCandidates,
  selectVariantLegs
} from "../server-utils/globalSpecialBetEngine.js";

/**
 * Corner-margin canary telemetry — the canary's only observable surface.
 *
 * The engine already computed a `cornerMargin` summary and returned it, but
 * nothing consumed it: both callers cherry-pick named fields out of the built
 * object, so in production an operator could not tell whether the canary ran,
 * what margin was active, or what the resulting family mix was. One structured
 * event per build closes that gap.
 *
 * These tests assert the event and, just as importantly, that emitting it
 * changes nothing: same selections, same ranking, same diversification, same
 * returned object, and no System event at all.
 */

const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const KICKOFF = "2026-08-09T18:00:00.000Z";
const EVENT = "ticket.corner_margin";

/** Run `fn` with console.log captured; return the canary events it emitted. */
function captureEvents(fn) {
  const original = console.log;
  const lines = [];
  console.log = (text) => lines.push(text);
  let result;
  try {
    result = fn();
  } finally {
    console.log = original;
  }
  const events = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.event === EVENT);
  return { result, events, allLines: lines };
}

function fixture(id, leagueId, markets) {
  return {
    id,
    leagueId,
    kickoff: KICKOFF,
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    valueEngine: { markets }
  };
}

const market = (overrides = {}) => ({
  type: "Over 2.5",
  family: "Goals",
  line: 2.5,
  odds: 1.5,
  probability: 0.7,
  valueScore: 60,
  recommendable: true,
  tradable: true,
  betType: "over_under",
  period: "full_match",
  scope: "match",
  ...overrides
});

const cornersMarket = (probability, line = 9.5) =>
  market({ type: `Under ${line}`, family: "Corners", line, probability, betType: "total" });

/** Four fixtures, each led by corners over a close goals rival (gap 0.08). */
const rows = () =>
  [1, 2, 3, 4].map((i) => fixture(i, 39 + (i % 2), [cornersMarket(0.88), market({ probability: 0.8 })]));

const OPTIONS = () => ({ rows: rows(), leagueIds: [39, 40], now: NOW });

// ── the event fires, exactly once, either way ──────────────────────────────

test("[T1] OFF emits exactly one event reporting enabled:false", () => {
  const { events } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0 }, [3]));
  assert.equal(events.length, 1);
  assert.equal(events[0].enabled, false);
  assert.equal(events[0].margin, 0);
});

test("[T2] ON emits exactly one aggregate event reporting enabled:true", () => {
  const { events } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]));
  assert.equal(events.length, 1);
  assert.equal(events[0].enabled, true);
});

test("[T3] the active margin is reported verbatim", () => {
  for (const margin of [0.05, 0.15, 0.2]) {
    const { events } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: margin }, [3]));
    assert.equal(events[0].margin, margin);
  }
});

// ── the counters are right ─────────────────────────────────────────────────

test("[T4] cornersConsidered counts fixtures whose ranked head is corners", () => {
  const { events } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]));
  assert.equal(events[0].cornersConsidered, 4);
});

test("[T5] cornersYielded counts only the fixtures that actually yielded", () => {
  // Two fixtures lead by 0.08 (yield), two by 0.30 (keep).
  const mixed = [
    fixture(1, 39, [cornersMarket(0.88), market({ probability: 0.8 })]),
    fixture(2, 39, [cornersMarket(0.88), market({ probability: 0.8 })]),
    fixture(3, 40, [cornersMarket(0.95), market({ probability: 0.65 })]),
    fixture(4, 40, [cornersMarket(0.95), market({ probability: 0.65 })])
  ];
  const { events } = captureEvents(() =>
    buildGlobalSpecialBets({ rows: mixed, leagueIds: [39, 40], now: NOW, cornerMarginPp: 0.15 }, [3])
  );
  assert.equal(events[0].cornersConsidered, 4);
  assert.equal(events[0].cornersYielded, 2);
});

test("[T6] fixturesAffected equals cornersYielded", () => {
  // A yield is keyed by fixtureId, so the two can never diverge. Pinned so a
  // future change to one cannot silently desynchronise the other.
  const { events } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]));
  assert.equal(events[0].fixturesAffected, events[0].cornersYielded);
  assert.equal(events[0].fixturesAffected, 4);
});

test("[T7] poolFamilyMix reports the resulting family histogram", () => {
  const off = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0 }, [3]));
  const on = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]));
  assert.deepEqual(off.events[0].poolFamilyMix, { corners: 4 });
  assert.deepEqual(on.events[0].poolFamilyMix, { ou: 4 });
});

test("[T8] candidate count and pool size are reported", () => {
  const { result, events } = captureEvents(() =>
    buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3])
  );
  assert.equal(events[0].candidates, result.candidates.length);
  assert.equal(events[0].poolSize, result.pool.length);
  assert.equal(events[0].poolSize, 4);
});

// ── volume: one per build, never per market or fixture ─────────────────────

test("[T9] a build with three variants still emits ONE event", () => {
  const { events } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3, 5, 8]));
  assert.equal(events.length, 1, "one event per build, not per variant");
});

test("[T10] event count is independent of fixture and market count", () => {
  const many = Array.from({ length: 25 }, (_, i) =>
    fixture(i + 1, 39 + (i % 3), [
      cornersMarket(0.88),
      cornersMarket(0.86, 10.5),
      cornersMarket(0.84, 11.5),
      market({ probability: 0.8 }),
      market({ probability: 0.75, type: "Over 1.5", line: 1.5 })
    ])
  );
  const { events } = captureEvents(() =>
    buildGlobalSpecialBets({ rows: many, leagueIds: [39, 40, 41], now: NOW, cornerMarginPp: 0.15 }, [3, 5, 8])
  );
  assert.equal(events.length, 1, "25 fixtures x 5 markets must still emit exactly one event");
});

test("[T11] no market or fixture identifier is logged", () => {
  const { allLines } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]));
  const joined = allLines.join("\n");
  for (const leak of ["Under 9.5", "Over 2.5", "fixtureId", "selection", "odds"]) {
    assert.ok(!joined.includes(leak), `telemetry must not carry ${leak}`);
  }
});

// ── observational only ─────────────────────────────────────────────────────

test("[T12] telemetry does not alter the returned selections", () => {
  const quiet = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3, 5, 8]);
  const { result } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3, 5, 8]));
  assert.equal(JSON.stringify(result), JSON.stringify(quiet));
});

test("[T13] telemetry does not alter ranking or diversification", () => {
  const opts = OPTIONS();
  const collected = collectGlobalCandidates(opts);
  const expected = diversifyGlobalCandidates(rankGlobalCandidates(collected.candidates));
  const { result } = captureEvents(() => buildGlobalSpecialBets({ ...opts, cornerMarginPp: 0 }, [3]));
  assert.deepEqual(
    result.pool.map((c) => `${c.fixtureId}|${c.selection}`),
    expected.map((c) => `${c.fixtureId}|${c.selection}`)
  );
});

test("[T14] candidate objects are not mutated by the telemetry", () => {
  const opts = OPTIONS();
  const before = JSON.stringify(opts.rows);
  captureEvents(() => buildGlobalSpecialBets({ ...opts, cornerMarginPp: 0.15 }, [3]));
  assert.equal(JSON.stringify(opts.rows), before);
});

test("[T15] OFF still returns exactly the pre-canary object shape", () => {
  const { result } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0 }, [3]));
  assert.deepEqual(Object.keys(result).sort(), [
    "bets",
    "candidates",
    "examined",
    "pool",
    "rejected",
    "reusedByVariant",
    "unavailable"
  ]);
  assert.equal("cornerMargin" in result, false);
});

test("[T16] the ticket itself is unchanged by telemetry", () => {
  const opts = OPTIONS();
  const collected = collectGlobalCandidates(opts);
  const pool = diversifyGlobalCandidates(rankGlobalCandidates(collected.candidates));
  const expected = selectVariantLegs(pool, 3, new Set()).selections.map((s) => `${s.fixtureId}|${s.selection}`);
  const { result } = captureEvents(() => buildGlobalSpecialBets({ ...opts, cornerMarginPp: 0 }, [3]));
  assert.deepEqual(
    result.bets[3].selections.map((s) => `${s.fixtureId}|${s.selection}`),
    expected
  );
});

// ── System is out of scope and emits nothing ───────────────────────────────

test("[T17] the System path emits NO canary event", () => {
  const base = { rows: rows(), leagueIds: [39, 40], now: NOW, systemK: 3 };
  for (const margin of [0, 0.15]) {
    const { events } = captureEvents(() => buildGlobalSystemBets({ ...base, cornerMarginPp: margin }));
    assert.equal(events.length, 0, `System must not emit (margin ${margin})`);
  }
});

test("[T18] System selections stay identical with the canary on and off", () => {
  const base = { rows: rows(), leagueIds: [39, 40], now: NOW, systemK: 3 };
  const off = buildGlobalSystemBets({ ...base, cornerMarginPp: 0 });
  const on = buildGlobalSystemBets({ ...base, cornerMarginPp: 0.15 });
  assert.deepEqual(
    on.selections.map((s) => `${s.fixtureId}|${s.selection}`),
    off.selections.map((s) => `${s.fixtureId}|${s.selection}`)
  );
});

// ── env behaviour is untouched ─────────────────────────────────────────────

test("[T19] an invalid env value stays OFF, keeps its warning, and reports enabled:false", () => {
  const previous = process.env.CORNER_MARGIN_PP;
  process.env.CORNER_MARGIN_PP = "abc";
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (text) => warnings.push(String(text));
  try {
    const { events } = captureEvents(() => buildGlobalSpecialBets(OPTIONS(), [3]));
    assert.equal(events.length, 1);
    assert.equal(events[0].enabled, false);
    assert.equal(events[0].margin, 0);
    assert.ok(
      warnings.some((w) => w.includes("[corner-margin]") && w.includes("abc")),
      "the existing invalid-value warning must still fire"
    );
  } finally {
    console.warn = originalWarn;
    if (previous === undefined) delete process.env.CORNER_MARGIN_PP;
    else process.env.CORNER_MARGIN_PP = previous;
  }
});

test("[T20] with the env unset the event reports the canary as OFF", () => {
  const previous = process.env.CORNER_MARGIN_PP;
  delete process.env.CORNER_MARGIN_PP;
  try {
    const { events, result } = captureEvents(() => buildGlobalSpecialBets(OPTIONS(), [3]));
    assert.equal(events.length, 1);
    assert.equal(events[0].enabled, false);
    assert.equal("cornerMargin" in result, false);
  } finally {
    if (previous !== undefined) process.env.CORNER_MARGIN_PP = previous;
  }
});

test("[T21] the env value drives the reported margin", () => {
  const previous = process.env.CORNER_MARGIN_PP;
  process.env.CORNER_MARGIN_PP = "0.15";
  try {
    const { events } = captureEvents(() => buildGlobalSpecialBets(OPTIONS(), [3]));
    assert.equal(events[0].enabled, true);
    assert.equal(events[0].margin, 0.15);
  } finally {
    if (previous === undefined) delete process.env.CORNER_MARGIN_PP;
    else process.env.CORNER_MARGIN_PP = previous;
  }
});

// ── event shape ────────────────────────────────────────────────────────────

test("[T22] the event carries the standard envelope and exactly the intended fields", () => {
  const { events } = captureEvents(() => buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]));
  const e = events[0];
  assert.equal(e.level, "info");
  assert.equal(e.service, "footy-predictor");
  assert.equal(e.event, EVENT);
  assert.ok(typeof e.ts === "string" && e.ts.endsWith("Z"));
  assert.deepEqual(Object.keys(e).sort(), [
    "candidates",
    "cornersConsidered",
    "cornersYielded",
    "enabled",
    "event",
    "fixturesAffected",
    "level",
    "margin",
    "poolFamilyMix",
    "poolSize",
    "service",
    "ts"
  ]);
});

test("[T23] an empty pool still emits one well-formed event", () => {
  const { events } = captureEvents(() =>
    buildGlobalSpecialBets({ rows: [], leagueIds: [39], now: NOW, cornerMarginPp: 0.15 }, [3])
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].candidates, 0);
  assert.equal(events[0].poolSize, 0);
  assert.deepEqual(events[0].poolFamilyMix, {});
  assert.equal(events[0].cornersConsidered, 0);
});
