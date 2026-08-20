import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKFILL_SELECT,
  planRowUpdate,
  runBackfill
} from "../server-utils/backfill/historyListColumns.js";
import { IMMUTABLE_COLUMNS, MUTABLE_COLUMNS } from "../server-utils/historyListColumns.js";

/**
 * The promoted-column backfill (055 + 056).
 *
 * `raw_payload` stays authoritative; these columns are a cache. What must not
 * regress is the write direction: an immutable column may never be replaced
 * once populated, a mutable one may be refreshed from a non-null payload but
 * never nulled, a bad value is reported instead of coerced, and the keyset walk
 * must terminate.
 *
 * The supabase client is injected, so everything runs against fakes — no
 * Postgres, no network — the same shape supportApi.js uses.
 */

/** A row as PostgREST returns it for BACKFILL_SELECT. */
function row(fixtureId, overrides = {}) {
  return {
    fixture_id: fixtureId,
    recommended_odd: null,
    recommended_family: null,
    recommended_period: null,
    recommended_scope: null,
    recommended_book_line: null,
    logo_home: null,
    logo_away: null,
    card_market_validations: null,
    card_markets: null,
    corners_total: null,
    shots_on_target_total: null,
    src_recommended: { pick: "Peste 2.5", odd: 1.85 },
    src_logos: { home: "h.png", away: "a.png" },
    src_card_market_validations: { corners: "win" },
    src_card_markets: { corners: "Peste 8.5" },
    src_market_results: { cornersTotal: 9, shotsOnTargetTotal: 8 },
    ...overrides
  };
}

/**
 * Records every query and update. Pages are served by fixture_id > cursor so the
 * keyset walk is exercised for real rather than simulated.
 */
function fakeSupabase(rows, { failOn = null } = {}) {
  const calls = { selects: [], updates: [], mutations: [] };
  const client = {
    from(table) {
      const state = { table, cursor: null, limit: null, ordered: null, eq: null };
      const builder = {
        select(cols) {
          calls.selects.push(cols);
          return builder;
        },
        gt(col, value) {
          state.cursor = { col, value };
          return builder;
        },
        order(col, opts) {
          state.ordered = { col, ...opts };
          return builder;
        },
        limit(n) {
          state.limit = n;
          const after = Number(state.cursor?.value ?? 0);
          const page = rows
            .filter((r) => Number(r.fixture_id) > after)
            .sort((a, b) => a.fixture_id - b.fixture_id)
            .slice(0, n);
          return Promise.resolve({ data: page, error: null });
        },
        update(patch) {
          state.patch = patch;
          return builder;
        },
        eq(col, value) {
          state.eq = { col, value };
          calls.updates.push({ fixture_id: value, patch: state.patch });
          if (failOn === value) return Promise.resolve({ error: { message: "write failed" } });
          // Apply to the in-memory row so a second pass sees the new state.
          const target = rows.find((r) => Number(r.fixture_id) === Number(value));
          if (target) Object.assign(target, state.patch);
          return Promise.resolve({ error: null });
        },
        upsert(...a) {
          calls.mutations.push(["upsert", a]);
          return builder;
        },
        insert(...a) {
          calls.mutations.push(["insert", a]);
          return builder;
        },
        delete(...a) {
          calls.mutations.push(["delete", a]);
          return builder;
        }
      };
      return builder;
    }
  };
  return { client, calls };
}

test("a valid numeric recommended odd is populated", () => {
  const { update } = planRowUpdate(row(1));
  assert.equal(update.recommended_odd, 1.85);
});

test("an invalid recommended odd is reported, not coerced, and does not throw", () => {
  for (const bad of ["n/a", "1,85", "abc", "-2.0", {}, "1e3"]) {
    const { update, diagnostics } = planRowUpdate(row(1, { src_recommended: { odd: bad } }));
    assert.equal(diagnostics.numericRejected, 1, `"${JSON.stringify(bad)}" was not reported`);
    assert.equal(update?.recommended_odd, undefined, `"${JSON.stringify(bad)}" was coerced`);
  }
});

test("valid integer market totals are populated", () => {
  const { update } = planRowUpdate(row(1));
  assert.equal(update.corners_total, 9);
  assert.equal(update.shots_on_target_total, 8);
});

test("a fractional market total is reported and left NULL", () => {
  // parseNumericStat can produce a non-integer; a blind ::integer cast would
  // have thrown, and silently rounding would invent a result.
  const { update, diagnostics } = planRowUpdate(
    row(1, { src_market_results: { cornersTotal: 9.5, shotsOnTargetTotal: "eight" } })
  );
  assert.equal(diagnostics.integerRejected, 2);
  assert.equal(update?.corners_total, undefined);
  assert.equal(update?.shots_on_target_total, undefined);
  // The rest of the row still backfills — one bad value does not poison it.
  assert.equal(update.recommended_odd, 1.85);
});

test("a missing source leaves the target NULL and is counted", () => {
  const bare = row(1, {
    src_recommended: null,
    src_logos: null,
    src_card_market_validations: null,
    src_card_markets: null,
    src_market_results: null
  });
  const { update, diagnostics } = planRowUpdate(bare);
  assert.equal(update, null, "a row with no source values produced a write");
  // One per promoted column, derived rather than hard-coded: adding a column
  // without teaching the backfill about it should fail here, not silently pass.
  assert.equal(diagnostics.missingSource, IMMUTABLE_COLUMNS.length + MUTABLE_COLUMNS.length);
});

test("JSON null is treated as absence, not as a value", () => {
  const { update } = planRowUpdate(
    row(1, { src_card_markets: null, src_card_market_validations: null })
  );
  assert.equal(update.card_markets, undefined);
  assert.equal(update.card_market_validations, undefined);
});

test("an empty-string logo is absence, not a value", () => {
  const { update } = planRowUpdate(row(1, { src_logos: { home: "   ", away: "a.png" } }));
  assert.equal(update.logo_home, undefined);
  assert.equal(update.logo_away, "a.png");
});

test("an immutable populated target is never overwritten", () => {
  // recommended_odd cannot change after creation; if the column and the payload
  // disagree, the column wins and the payload is ignored.
  const { update } = planRowUpdate(
    row(1, { recommended_odd: 2.5, logo_home: "existing.png", src_recommended: { odd: 1.85 } })
  );
  assert.equal(update?.recommended_odd, undefined, "an immutable column was replaced");
  assert.equal(update?.logo_home, undefined, "an immutable column was replaced");
});

test("a mutable populated target IS refreshed from a non-null source", () => {
  // Settlement rewrites these; the cache must follow the authoritative payload.
  const { update } = planRowUpdate(
    row(1, {
      card_market_validations: { corners: "pending" },
      corners_total: 4,
      src_card_market_validations: { corners: "win" },
      src_market_results: { cornersTotal: 9, shotsOnTargetTotal: 8 }
    })
  );
  assert.deepEqual(update.card_market_validations, { corners: "win" });
  assert.equal(update.corners_total, 9);
});

test("a mutable populated target is never replaced by NULL", () => {
  const { update } = planRowUpdate(
    row(1, {
      card_market_validations: { corners: "win" },
      card_markets: { corners: "Peste 8.5" },
      corners_total: 9,
      shots_on_target_total: 8,
      src_card_market_validations: null,
      src_card_markets: null,
      src_market_results: null
    })
  );
  // The immutable columns still backfill here; what matters is that NONE of the
  // mutable ones appear, i.e. a missing source never nulls a populated value.
  for (const key of ["card_market_validations", "card_markets", "corners_total", "shots_on_target_total"]) {
    assert.equal(update?.[key], undefined, `a missing source nulled populated ${key}`);
  }
});

test("running the same batch twice changes nothing the second time", async () => {
  const rows = [row(1), row(2), row(3)];
  const sb = fakeSupabase(rows);

  const first = await runBackfill({ supabase: sb.client, batchSize: 200, apply: true });
  assert.equal(first.changed, 3);
  assert.equal(first.scanned, 3);

  const second = await runBackfill({ supabase: sb.client, batchSize: 200, apply: true });
  assert.equal(second.scanned, 3);
  assert.equal(second.changed, 0, "a re-run rewrote rows that had not moved");
  assert.equal(second.skipped, 3);
});

test("a dry run writes nothing but still reports the plan", async () => {
  const rows = [row(1), row(2)];
  const sb = fakeSupabase(rows);
  const stats = await runBackfill({ supabase: sb.client, batchSize: 200, apply: false });

  assert.equal(stats.changed, 2);
  assert.deepEqual(sb.calls.updates, [], "a dry run issued writes");
  assert.equal(rows[0].recommended_odd, null, "a dry run mutated a row");
});

test("pagination advances by fixture_id and terminates", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(i + 1));
  const sb = fakeSupabase(rows);
  const stats = await runBackfill({ supabase: sb.client, batchSize: 10, apply: true });

  assert.equal(stats.scanned, 25, "the walk did not cover every row");
  assert.equal(stats.batches, 3, "expected ceil(25/10) batches");
  assert.equal(stats.lastFixtureId, 25);
  // Every page must be requested strictly past the previous one — an equal or
  // lower cursor is what turns a keyset walk into an infinite loop.
  assert.equal(sb.calls.updates.length, 25);
});

test("the walk cannot loop when a page repeats its last id", async () => {
  // A pathological source that always returns the same row: the cursor is still
  // strictly greater afterwards, so the next page is empty and the loop ends.
  let served = 0;
  const client = {
    from() {
      const b = {
        select: () => b,
        gt: (_c, value) => {
          b._after = Number(value);
          return b;
        },
        order: () => b,
        limit: () => {
          served += 1;
          return Promise.resolve({ data: b._after < 5 ? [row(5)] : [], error: null });
        }
      };
      return b;
    }
  };
  const stats = await runBackfill({ supabase: client, batchSize: 10, apply: false, maxBatches: 50 });
  assert.equal(stats.batches, 1);
  assert.equal(stats.lastFixtureId, 5);
  assert.ok(served <= 3, `expected the walk to stop quickly, made ${served} requests`);
});

test("a write failure is counted and does not abort the run", async () => {
  const rows = [row(1), row(2), row(3)];
  const sb = fakeSupabase(rows, { failOn: 2 });
  const stats = await runBackfill({ supabase: sb.client, batchSize: 200, apply: true });

  assert.equal(stats.scanned, 3);
  assert.equal(stats.failed, 1);
  assert.equal(stats.changed, 2, "a single failed write stopped the rest");
});

test("the backfill never issues an insert, upsert or delete", async () => {
  const rows = [row(1), row(2)];
  const sb = fakeSupabase(rows);
  await runBackfill({ supabase: sb.client, batchSize: 200, apply: true });
  // An upsert whose conflict target missed would invent a fixture row.
  assert.deepEqual(sb.calls.mutations, []);
});

test("the projection reads only the payload keys it needs, never the document", () => {
  assert.ok(!BACKFILL_SELECT.split(",").map((c) => c.trim()).includes("raw_payload"));
  for (const key of ["recommended", "logos", "cardMarketValidations", "cardMarkets", "marketResults"]) {
    assert.ok(BACKFILL_SELECT.includes(`raw_payload->${key}`), `missing source path for ${key}`);
  }
});

test("per-column counts reflect what was actually written", async () => {
  const rows = [
    row(1),
    row(2, { src_logos: null, src_market_results: null }),
    row(3, { src_recommended: { odd: "bad" } })
  ];
  const sb = fakeSupabase(rows);
  const stats = await runBackfill({ supabase: sb.client, batchSize: 200, apply: true });

  assert.equal(stats.populated.recommended_odd, 2, "the rejected odd was counted as populated");
  assert.equal(stats.populated.logo_home, 2);
  assert.equal(stats.populated.corners_total, 2);
  assert.equal(stats.numericRejected, 1);
});

/* ---------------------------------------------------------------------------
 * 056 — recommendation metadata.
 *
 * These four are IMMUTABLE, so the reconciliation that matters is `target ??
 * source`: a populated column survives a re-run even if the payload disagrees.
 * ------------------------------------------------------------------------- */

test("056: the four recommendation scalars are populated from raw_payload", () => {
  const { update } = planRowUpdate(
    row(1, {
      src_recommended: {
        pick: "Over 9.5",
        odd: 1.85,
        family: "Shots on Target",
        period: "full_match",
        scope: "match",
        bookLine: 9.5
      }
    })
  );
  assert.equal(update.recommended_family, "Shots on Target");
  assert.equal(update.recommended_period, "full_match");
  assert.equal(update.recommended_scope, "match");
  assert.equal(update.recommended_book_line, 9.5);
});

test("056: a quarter book line survives the backfill unrounded", () => {
  // 6.75 and 8.25 are live production values. An integer column, or an integer
  // guard, would name a line the bookmaker never offered.
  for (const line of [6.75, 8.25, 7, 10.5]) {
    const { update } = planRowUpdate(row(1, { src_recommended: { pick: "Over", bookLine: line } }));
    assert.equal(update.recommended_book_line, line, `bookLine ${line} was not preserved`);
  }
});

test("056: absent metadata stays NULL and is never inferred from the pick", () => {
  // The pick alone would let a reader guess Corners from the 9.5 line. Guessing
  // here would make a legacy row indistinguishable from a classified one.
  const { update } = planRowUpdate(row(1, { src_recommended: { pick: "Over 9.5", odd: 1.85 } }));
  assert.equal(update.recommended_family, undefined);
  assert.equal(update.recommended_period, undefined);
  assert.equal(update.recommended_scope, undefined);
  assert.equal(update.recommended_book_line, undefined);
});

test("056: an unusable book line is reported, not coerced", () => {
  const { update, diagnostics } = planRowUpdate(
    row(1, { src_recommended: { pick: "Over", odd: 1.85, bookLine: "not-a-line" } })
  );
  assert.equal(update?.recommended_book_line, undefined);
  assert.ok(diagnostics.numericRejected >= 1, "a bad book line was not counted");
  assert.ok(diagnostics.rejectedColumns.includes("recommended_book_line"));
  // The rest of the row still backfills.
  assert.equal(update.recommended_odd, 1.85);
});

test("056: an empty-string family is absence, not a value", () => {
  const { update } = planRowUpdate(row(1, { src_recommended: { pick: "Over", family: "   " } }));
  assert.equal(update?.recommended_family, undefined);
});

test("056: a populated metadata target is never replaced by a different source", () => {
  const { update } = planRowUpdate(
    row(1, {
      recommended_family: "Corners",
      recommended_book_line: 8.5,
      src_recommended: { pick: "Over", family: "Shots", bookLine: 9.5 }
    })
  );
  assert.equal(update?.recommended_family, undefined, "an immutable family was overwritten");
  assert.equal(update?.recommended_book_line, undefined, "an immutable book line was overwritten");
});

test("056: the projection selects the new columns and still never the document", () => {
  for (const column of ["recommended_family", "recommended_period", "recommended_scope", "recommended_book_line"]) {
    assert.ok(BACKFILL_SELECT.includes(column), `${column} is missing from the projection`);
  }
  // No new payload path is needed - src_recommended already carries all four.
  assert.ok(!/(^|[\s,])raw_payload([\s,]|$)/.test(BACKFILL_SELECT), "the projection selects the whole document");
});
