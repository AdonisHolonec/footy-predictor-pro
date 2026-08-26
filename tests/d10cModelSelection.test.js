import test, { mock } from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_SELECTION_COLUMNS,
  MODEL_SELECTION_PAYLOAD_BLOCKS,
  modelSelectionSelect,
  rehydrateModelSelectionRows
} from "../server-utils/modelLab/modelSelectionRows.js";
import { reconstructSources, evaluateModel, MODEL_REGISTRY } from "../server-utils/modelLab/ModelLab.js";
import { runAutoSelection } from "../server-utils/modelLab/BlendRecipeSelection.js";
import {
  CALIBRATION_PAYLOAD_BLOCKS,
  STACKER_PAYLOAD_BLOCKS,
  LEAGUE_PROFILE_PAYLOAD_BLOCKS
} from "../api/cron/daily-ml.js";

/**
 * D10c — the ModelLab / model-selection path stops selecting the whole `raw_payload`.
 *
 * THREE handlers issued the identical full-document query and fed it to the same
 * consumer (`reconstructSources`): the 03:35 cron, and the two /api/backtest views.
 * Replayed verbatim against production on 2026-08-26 the cron read returned
 * `57014 canceling statement due to statement timeout` at 19.85 s — 840 rows at
 * ~309 KB/row, ~254 MB implied. The projected select returns the same 840 rows in
 * ~2.1-3.9 s and 6.23 MB.
 *
 * The fix moves the QUERY, never the consumer: `ModelLab.js`,
 * `BlendRecipeSelection.js` and `reconstructSources` are untouched. So the tests
 * split in two:
 *
 *   - query shape: each handler asks for exactly its blocks and no more, captured
 *     from the REAL handler call through a Supabase stub rather than asserted
 *     against a hand-written copy of the string.
 *   - equivalence: a rehydrated projection drives `reconstructSources`,
 *     `evaluateModel` and `runAutoSelection` to the SAME answers as the full
 *     document. Every "full" fixture below carries `valueEngine` and other unread
 *     blocks that the projection drops, so each assertion is a real comparison and
 *     not a tautology.
 *
 * Production parity for this change: 840 rows x 8 source keys = 6,720 comparisons,
 * plus 15 evaluateModel comparisons, plus selection and promotion payloads —
 * 6,737 total, 0 divergences, selected model B identical either way.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const RAW = { p1: 41.28, pX: 27.13, p2: 31.59 };
const MODEL = { p1: 46.02, pX: 25.44, p2: 28.54 };
const CAL = { p1: 44.71, pX: 26.08, p2: 29.21 };

/** A realistic full document — carries blocks the projection MUST drop. */
function fullDocument(over = {}) {
  return {
    evaluation: {
      rawPoissonProbs1x2Pct: { ...RAW },
      modelProbs1x2Pct: { ...MODEL },
      calibratedProbs1x2Pct: { ...CAL },
      ...(over.evaluation || {})
    },
    modelMeta: {
      elo: { home: 1562.4, away: 1488.9 },
      leagueParams: { homeAdv: 1.07, rho: -0.12 },
      modularScores: { injuries: { detail: { home: 0.96, away: 1.02, available: true } } },
      ...(over.modelMeta || {})
    },
    luckStats: { hXG: 1.61, aXG: 1.12, ...(over.luckStats || {}) },
    // none of the below is read by this path — they must not survive the projection
    valueEngine: { bloat: "x".repeat(4096), nested: { deep: [1, 2, 3] } },
    monteCarlo: { runs: 10000 },
    probs: { p1: 1, pX: 1, p2: 1 },
    featureImportance: { contributions: { a: 1 } },
    recommended: { pick: "1", confidence: 61 }
  };
}

function row(doc, over = {}) {
  return {
    fixture_id: 991001,
    league_id: 39,
    kickoff_at: "2026-05-02T14:00:00.000Z",
    score_home: 2,
    score_away: 1,
    odds_home: 2.05,
    odds_draw: 3.4,
    odds_away: 3.7,
    luck_hxg: 1.61,
    luck_axg: 1.12,
    raw_payload: doc,
    ...over
  };
}

/** The PostgREST wire shape: one aliased column per projected block. */
function projectedRow(r, blocks = MODEL_SELECTION_PAYLOAD_BLOCKS) {
  const { raw_payload: doc, ...scalars } = r;
  const out = { ...scalars };
  for (const b of blocks) if (doc && doc[b] !== undefined) out[b] = doc[b];
  return out;
}

/** Full row -> projected wire -> rehydrated row, i.e. exactly what production does. */
function throughProjection(r) {
  return rehydrateModelSelectionRows([projectedRow(r)])[0];
}

/* ------------------------------------------------------------------ */
/* Query-shape capture from the REAL handlers                          */
/* ------------------------------------------------------------------ */

const EXPECTED_SELECT =
  "fixture_id, league_id, kickoff_at, score_home, score_away, odds_home, odds_draw, odds_away, luck_hxg, luck_axg, " +
  "evaluation:raw_payload->evaluation, modelMeta:raw_payload->modelMeta, luckStats:raw_payload->luckStats";

function supabaseStub(selects) {
  return {
    namedExports: {
      assertSupabaseConfigured: () => ({ ok: true }),
      getSupabaseAdmin: () => ({
        from: () => {
          const chain = {
            select: (p) => {
              selects.push(p);
              return chain;
            },
            gte: () => chain,
            in: () => chain,
            eq: () => chain,
            is: () => chain,
            order: () => chain,
            update: () => chain,
            limit: () => Promise.resolve({ data: [], error: null })
          };
          return chain;
        }
      })
    }
  };
}

/** Neutralise KV so no promotion is ever persisted from a test run. */
function kvStub() {
  return {
    namedExports: {
      createClient: () => ({ get: async () => null, set: async () => "OK" })
    }
  };
}

function res() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    }
  };
}

async function captureDailyMl(tag) {
  const selects = [];
  mock.reset();
  mock.module("../server-utils/supabaseAdmin.js", supabaseStub(selects));
  mock.module("@vercel/kv", kvStub());
  const mod = await import(`../api/cron/daily-ml.js?d10c=${tag}`);
  const r = res();
  await mod.default({ method: "GET", query: { mode: "model-selection" }, headers: {} }, r);
  return { selects, r };
}

async function captureBacktest(view, tag, extraQuery = {}) {
  const selects = [];
  mock.reset();
  mock.module("../server-utils/supabaseAdmin.js", supabaseStub(selects));
  mock.module("@vercel/kv", kvStub());
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "d10c-test-secret";
  try {
    const mod = await import(`../api/backtest.js?d10c=${tag}`);
    const r = res();
    await mod.default(
      { method: "GET", query: { view, ...extraQuery }, headers: { "x-cron-secret": "d10c-test-secret" } },
      r
    );
    return { selects, r };
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
}

test("[A][G] daily-ml model-selection issues ONE query with the projected select", async () => {
  const { selects, r } = await captureDailyMl("dm");
  assert.equal(r.statusCode, 200, `handler failed: ${JSON.stringify(r.body).slice(0, 300)}`);
  assert.equal(selects.length, 1, `expected exactly 1 select, saw ${selects.length}`);
  assert.equal(selects[0], EXPECTED_SELECT);
});

test("[B][G] backtest view=model-select issues ONE query with the projected select", async () => {
  const { selects, r } = await captureBacktest("model-select", "ms");
  assert.equal(r.statusCode, 200, `handler failed: ${JSON.stringify(r.body).slice(0, 300)}`);
  assert.equal(selects.length, 1, `expected exactly 1 select, saw ${selects.length}`);
  assert.equal(selects[0], EXPECTED_SELECT);
});

test("[C][G] backtest view=model-lab issues ONE query with the projected select", async () => {
  const { selects, r } = await captureBacktest("model-lab", "ml", { days: "90" });
  assert.equal(r.statusCode, 200, `handler failed: ${JSON.stringify(r.body).slice(0, 300)}`);
  assert.equal(selects.length, 1, `expected exactly 1 select, saw ${selects.length}`);
  assert.equal(selects[0], EXPECTED_SELECT);
});

test("[D][E] no ModelLab consumer selects the bare document or a wildcard", async () => {
  const runs = [
    await captureDailyMl("g1"),
    await captureBacktest("model-select", "g2"),
    await captureBacktest("model-lab", "g3")
  ];
  for (const { selects } of runs) {
    for (const s of selects) {
      assert.ok(!/(^|,\s*)raw_payload(\s*,|$)/.test(s), `still selects the whole document: ${s}`);
      assert.ok(!s.includes("*"), `uses a wildcard: ${s}`);
      for (const m of s.match(/raw_payload[^,]*/g) || []) {
        assert.ok(m.startsWith("raw_payload->"), `unscoped document read: ${m}`);
      }
    }
  }
});

test("[F] the shared select carries every scalar column and exactly three blocks", () => {
  assert.deepEqual([...MODEL_SELECTION_PAYLOAD_BLOCKS], ["evaluation", "modelMeta", "luckStats"]);
  for (const col of [
    "fixture_id",
    "league_id",
    "kickoff_at",
    "score_home",
    "score_away",
    "odds_home",
    "odds_draw",
    "odds_away",
    "luck_hxg",
    "luck_axg"
  ]) {
    assert.ok(MODEL_SELECTION_COLUMNS.includes(col), `missing scalar column ${col}`);
  }
  assert.equal(modelSelectionSelect(), EXPECTED_SELECT);
  // exactly three block projections, each scoped
  assert.equal((modelSelectionSelect().match(/raw_payload->/g) || []).length, 3);
});

/* ------------------------------------------------------------------ */
/* [N] shape preservation                                              */
/* ------------------------------------------------------------------ */

test("[N] rehydration rebuilds the nested modelMeta shape byte-for-byte", () => {
  const doc = fullDocument();
  const r = throughProjection(row(doc));
  assert.deepEqual(r.raw_payload.modelMeta, doc.modelMeta);
  assert.deepEqual(r.raw_payload.evaluation, doc.evaluation);
  assert.deepEqual(r.raw_payload.luckStats, doc.luckStats);
  // nested leaves survive at full precision
  assert.equal(r.raw_payload.modelMeta.leagueParams.homeAdv, 1.07);
  assert.equal(r.raw_payload.modelMeta.leagueParams.rho, -0.12);
  assert.equal(r.raw_payload.modelMeta.elo.home, 1562.4);
  // and the unread blocks are genuinely gone
  assert.equal(r.raw_payload.valueEngine, undefined, "fixture must exercise a dropped block");
  assert.equal(r.raw_payload.monteCarlo, undefined);
  assert.equal(r.raw_payload.probs, undefined);
  // scalars are carried through untouched
  assert.equal(r.luck_hxg, 1.61);
  assert.equal(r.odds_draw, 3.4);
  assert.equal(r.fixture_id, 991001);
});

test("[N] absent blocks are omitted, and a row with no document does not crash", () => {
  const bare = { fixture_id: 5, score_home: 1, score_away: 0, kickoff_at: "2026-05-02T14:00:00.000Z" };
  const out = rehydrateModelSelectionRows([bare])[0];
  assert.deepEqual(out.raw_payload, {});
  assert.equal("evaluation" in out.raw_payload, false, "absent block must be omitted, not stored as null");
  assert.doesNotThrow(() => reconstructSources(out));
  assert.deepEqual(rehydrateModelSelectionRows(null), []);
});

/* ------------------------------------------------------------------ */
/* [H] reconstructSources parity                                       */
/* ------------------------------------------------------------------ */

const SRC_KEYS = ["poisson", "everything", "calibrated", "stacker", "elo", "xg", "market"];

function assertSourceParity(full) {
  const a = reconstructSources(full);
  const b = reconstructSources(throughProjection(full));
  for (const k of SRC_KEYS) assert.deepEqual(b.sources[k] ?? null, a.sources[k] ?? null, `source ${k} diverged`);
  assert.deepEqual(b.injuries, a.injuries, "injuries diverged");
  return a;
}

test("[H] every reconstructSources key is identical through the projection", () => {
  const a = assertSourceParity(row(fullDocument()));
  // the fixture genuinely exercises the sources the registry uses
  assert.ok(a.sources.poisson && a.sources.elo && a.sources.xg && a.sources.everything);
  assert.ok(a.injuries, "injuries modifier must be exercised");
});

test("[H] poisson and everything keep their precedence on the projected shape", () => {
  const full = row(fullDocument());
  const proj = throughProjection(full);
  const s = reconstructSources(proj);
  // poisson == rawPoisson, everything == modelProbs (NOT calibrated) — normalised
  const norm = (t) => {
    const sum = t.p1 + t.pX + t.p2;
    return { p1: t.p1 / sum, pX: t.pX / sum, p2: t.p2 / sum };
  };
  const rawN = norm(RAW);
  const modelN = norm(MODEL);
  assert.ok(Math.abs(s.sources.poisson.p1 - rawN.p1) < 1e-9);
  assert.ok(Math.abs(s.sources.everything.p1 - modelN.p1) < 1e-9);
  assert.notDeepEqual(s.sources.poisson, s.sources.everything, "sources must remain distinct");
});

test("[M] the everything -> calibrated fallback still fires on the projected shape", () => {
  const doc = fullDocument();
  delete doc.evaluation.modelProbs1x2Pct;
  const full = row(doc);
  const a = assertSourceParity(full);
  const s = reconstructSources(throughProjection(full));
  assert.deepEqual(s.sources.everything, a.sources.calibrated, "fallback must resolve to the calibrated triple");
});

test("[M] the xG source behaves identically through the projection, quirk included", () => {
  /*
    This pins EXISTING behaviour, quirk included, because the projection must not
    change it.

    `reconstructSources` reads `num(row.luck_hxg) ?? num(payload.luckStats.hXG)`,
    which LOOKS like a payload fallback behind the column. It is not reachable for
    a SQL NULL: `num(v)` is `Number.isFinite(Number(v)) ? Number(v) : null`, and
    `Number(null)` is 0, which IS finite — so a NULL column yields 0, `??` does not
    fall through, and the `xgH > 0` guard then rejects the row. The payload branch
    can only fire when the KEY IS ABSENT from the row object (`Number(undefined)`
    is NaN), which never happens in production because both the old and the new
    select name luck_hxg / luck_axg explicitly.

    Measured on production: 0 of 840 rows resolved xG via luckStats — structural,
    not a data accident. Left exactly as found; changing it would move the xG
    source on real rows and is a semantic change, out of scope for a projection fix.

    `luckStats` is still projected: it is what the code READS, the block is
    0.10 KB/row (0.03%), and dropping it would bet on this quirk never being fixed.
  */
  const nulled = row(fullDocument(), { luck_hxg: null, luck_axg: null });
  const a = assertSourceParity(nulled);
  assert.equal(a.sources.xg, undefined, "NULL column yields 0, not the payload fallback");

  // key absent entirely -> the payload branch DOES fire, and parity still holds
  const bare = row(fullDocument());
  delete bare.luck_hxg;
  delete bare.luck_axg;
  const b = assertSourceParity(bare);
  assert.ok(b.sources.xg, "with the key absent the luckStats fallback is reachable");

  // columns present -> xg comes from the columns, identically either way
  const c = assertSourceParity(row(fullDocument()));
  assert.ok(c.sources.xg);
});

test("[M] the injuries .details fallback and the available===false gate are preserved", () => {
  const viaDetails = row(
    fullDocument({ modelMeta: { modularScores: { injuries: { details: { home: 0.9, away: 1.05 } } } } })
  );
  const a = assertSourceParity(viaDetails);
  assert.deepEqual(a.injuries, { home: 0.9, away: 1.05 });

  const gated = row(
    fullDocument({ modelMeta: { modularScores: { injuries: { detail: { home: 0.9, away: 1.0, available: false } } } } })
  );
  const b = assertSourceParity(gated);
  assert.equal(b.injuries, null, "available:false must still suppress the modifier");
});

test("[H] elo uses leagueParams.homeAdv read off the rehydrated row", () => {
  const base = row(fullDocument());
  const tilted = row(fullDocument({ modelMeta: { leagueParams: { homeAdv: 1.35, rho: -0.12 } } }));
  assertSourceParity(base);
  assertSourceParity(tilted);
  const a = reconstructSources(throughProjection(base)).sources.elo;
  const b = reconstructSources(throughProjection(tilted)).sources.elo;
  assert.notDeepEqual(a, b, "homeAdv must still reach homeAdvElo through the projection");
});

/* ------------------------------------------------------------------ */
/* [I][J][K][L] model / selection / promotion parity                   */
/* ------------------------------------------------------------------ */

function population() {
  const out = [];
  const now = Date.now();
  for (let i = 0; i < 60; i++) {
    const doc = fullDocument({
      evaluation: {
        rawPoissonProbs1x2Pct: { p1: 35 + (i % 11), pX: 28, p2: 37 - (i % 11) },
        modelProbs1x2Pct: { p1: 40 + (i % 7), pX: 26, p2: 34 - (i % 7) },
        calibratedProbs1x2Pct: { ...CAL }
      },
      modelMeta: { elo: { home: 1500 + i * 3, away: 1500 - i * 2 } },
      luckStats: { hXG: 1.2 + (i % 5) * 0.1, aXG: 1.0 + (i % 3) * 0.1 }
    });
    out.push(
      row(doc, {
        fixture_id: 900000 + i,
        // spread across the 30/90/365d windows
        kickoff_at: new Date(now - (i * 6 + 1) * 864e5).toISOString(),
        score_home: i % 3,
        score_away: (i + 1) % 3,
        luck_hxg: 1.2 + (i % 5) * 0.1,
        luck_axg: 1.0 + (i % 3) * 0.1,
        odds_home: 1.9 + (i % 5) * 0.1,
        odds_draw: 3.3,
        odds_away: 3.9 - (i % 4) * 0.1
      })
    );
  }
  return out;
}

test("[I] evaluateModel is identical for all five registry models", () => {
  const full = population();
  const proj = full.map(throughProjection);
  assert.ok(proj.every((r) => r.raw_payload.valueEngine === undefined), "projection must have dropped blocks");
  for (const m of MODEL_REGISTRY) {
    const a = evaluateModel(m, full);
    const b = evaluateModel(m, proj);
    assert.deepEqual(b, a, `model ${m.id} diverged`);
    assert.ok(a.samples > 0, `model ${m.id} must actually score rows`);
  }
});

test("[J][K] runAutoSelection ranking, windows and selected model are identical", () => {
  const full = population();
  const proj = full.map(throughProjection);
  const drop = ["evaluatedAt", "generatedAt"];
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (drop.includes(k) ? undefined : v)));
  const a = strip(runAutoSelection(full));
  const b = strip(runAutoSelection(proj));
  assert.deepEqual(b, a);
  assert.deepEqual(
    b.ranking.map((r) => r.id),
    a.ranking.map((r) => r.id),
    "ranking order must be identical"
  );
  assert.equal(b.selected.id, a.selected.id);
  assert.equal(b.selected.reason, a.selected.reason);
  assert.equal(b.totalSettled, a.totalSettled);
  assert.equal(a.windows.length, 3);
});

test("[L] the promotion payload is identical (promotedAt excluded, never persisted)", () => {
  const full = population();
  const proj = full.map(throughProjection);
  const record = (sel) => ({
    id: sel?.selected?.id || "E",
    name: sel?.selected?.name || "Everything enabled",
    reason: sel?.selected?.reason || "auto",
    compositeScore: sel?.ranking?.[0]?.compositeScore ?? null,
    windowWinners: (sel?.windows || []).map((w) => ({ window: w.key, id: w.winner?.id || null })),
    totalSettled: sel?.totalSettled ?? 0
  });
  assert.deepEqual(record(runAutoSelection(proj)), record(runAutoSelection(full)));
});

/* ------------------------------------------------------------------ */
/* [O][P] outage proxy + D9 / D10b regression                          */
/* ------------------------------------------------------------------ */

test("[O] the projected select names no full document, which is what removed the 57014", () => {
  const s = modelSelectionSelect();
  assert.ok(!/(^|,\s*)raw_payload(\s*,|$)/.test(s));
  // production replay 2026-08-26: full document -> 57014 @ 19.85s; this select -> 200 in ~2.1-3.9s / 6.23 MB
  assert.equal((s.match(/raw_payload->/g) || []).length, MODEL_SELECTION_PAYLOAD_BLOCKS.length);
});

test("[P] D10b block lists are untouched by D10c", () => {
  assert.deepEqual([...CALIBRATION_PAYLOAD_BLOCKS], ["evaluation", "probs"]);
  assert.deepEqual([...STACKER_PAYLOAD_BLOCKS], ["evaluation", "probs", "odds", "modelMeta"]);
  assert.deepEqual([...LEAGUE_PROFILE_PAYLOAD_BLOCKS], []);
  // D10c must not have widened or narrowed the mode=all projections
  assert.notDeepEqual([...MODEL_SELECTION_PAYLOAD_BLOCKS], [...STACKER_PAYLOAD_BLOCKS]);
});
