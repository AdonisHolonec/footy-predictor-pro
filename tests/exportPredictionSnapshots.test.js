/**
 * prediction_snapshots export tool.
 *
 * The archive is the only thing standing between ~278 MB of irreplaceable
 * market-movement history and a TRUNCATE, so the tests that matter are the ones
 * that would catch a SILENTLY WRONG archive: a hash that cannot match what
 * Postgres computes, a page boundary that drops or repeats a row, a timestamp
 * that loses microseconds, a verifier that passes on a corrupt file.
 *
 * The jsonb key-order fixtures below are REAL — read out of production with
 * jsonb_object_keys() for snapshot 00b86206-bb72-4339-bcab-46c2603fa689. They
 * are here because the ordering rule (length first, THEN bytewise) is not
 * guessable, and a hand-invented fixture would have hidden the exact mistake
 * the rule exists to prevent. Key NAMES only — no production values.
 *
 * Nothing here touches the network. The fake client serves rows from an array
 * under the same keyset contract PostgREST has.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync, existsSync, rmSync, mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  pgKeyCompare,
  pgJsonbText,
  pgTimestampMicros,
  isoMicrosZ,
  rowHash,
  aggregateChecksums,
  nextChunkSize,
  assertOutsideRepo,
  defaultOutDir,
  fetchPage,
  exportAll,
  verifyArchive,
  UUID_ZERO,
  KEY_ORDER,
  TARGET_BYTES,
  MIN_CHUNK,
  MAX_CHUNK
} from "../scripts/export-prediction-snapshots.mjs";

// ---------------------------------------------------------------- fixtures

/** Real key order of a production raw_payload, exactly as jsonb returns it. */
const REAL_TOPLEVEL = ["id","odds","logos","probs","score","teams","league","status","kickoff","lambdas","auditLog","leagueId","valueBet","luckStats","modelMeta","evaluation","marketOdds","snapshotAt","predictions","recommended","teamContext","modelVersion","fixtureTeamIds","leagueStandings"];
const REAL_PROBS = ["p1","p2","pX","pGG","pNGG","pO05","pO15","pO25","pU15","pU25","pU35","pDC12","pDC1X","pDCX2","corners","firstHalf","shotsTotal","shotsOnTarget"];
const REAL_ODDS = ["away","draw","home","shinZ","bookmaker","marginMethod","bookmakersUsed"];

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const makeRow = (n, over = {}) => ({
  id: uuid(n),
  fixture_id: 1000 + (n % 3),
  model_version: "v3-test",
  generated_at: `2026-0${(n % 2) + 4}-15T10:00:0${n % 10}.123456+00:00`,
  league_id: 39,
  kickoff_at: "2026-04-16T18:00:00+00:00",
  raw_payload: { id: 1000 + n, odds: { home: 2.45, away: 2.69 }, note: "synthetic" },
  ...over
});

/** Minimal stand-in for supabase-js with the same keyset contract. */
function fakeClient(rows, { failOnPageIndex = -1 } = {}) {
  let pages = 0;
  const calls = [];
  return {
    calls,
    from() {
      const q = { _gt: null, _limit: null, _order: null, _eq: undefined };
      const api = {
        select() { return api; },
        gt(_col, v) { q._gt = v; return api; },
        eq(_col, v) { q._eq = v; return api; },
        order(col, o) { q._order = { col, ...o }; return api; },
        limit(n) { q._limit = n; return api; },
        maybeSingle() {
          return Promise.resolve({ data: rows.find((r) => r.id === q._eq) ?? null, error: null });
        },
        then(resolve) {
          calls.push({ gt: q._gt, limit: q._limit, order: q._order });
          if (pages === failOnPageIndex) {
            pages += 1;
            return resolve({ data: null, error: { message: "simulated transport failure" } });
          }
          pages += 1;
          const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
          return resolve({ data: sorted.filter((r) => r.id > q._gt).slice(0, q._limit), error: null });
        }
      };
      return api;
    }
  };
}

const withTmp = async (fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), "snap-export-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------- pg rendering

test("1. key order matches real jsonb output — length first, then bytewise", () => {
  for (const real of [REAL_TOPLEVEL, REAL_PROBS, REAL_ODDS]) {
    assert.deepEqual([...real].reverse().sort(pgKeyCompare), real);
  }
  // The cases a lexicographic sort gets wrong.
  assert.deepEqual(["logos", "id", "odds"].sort(pgKeyCompare), ["id", "odds", "logos"]);
  assert.deepEqual(["pDCX2", "pDC12", "pDC1X"].sort(pgKeyCompare), ["pDC12", "pDC1X", "pDCX2"]);
  assert.deepEqual(["pX", "p1", "p2"].sort(pgKeyCompare), ["p1", "p2", "pX"]);
});

test("2. rendering matches jsonb::text — sorted keys, ', ' and ': ' separators", () => {
  assert.equal(pgJsonbText({ odds: 1, id: 2 }), '{"id": 2, "odds": 1}');
  assert.equal(pgJsonbText([1, 2, 3]), "[1, 2, 3]");
  assert.equal(pgJsonbText({ a: [{ b: 1 }] }), '{"a": [{"b": 1}]}');
  assert.equal(pgJsonbText({}), "{}");
  assert.equal(pgJsonbText([]), "[]");
  assert.equal(pgJsonbText(null), "null");
  assert.equal(pgJsonbText({ x: null }), '{"x": null}');
  // The exact head of the real production row, byte for byte.
  assert.equal(
    pgJsonbText({ odds: { away: 2.69, draw: 3.3, home: 2.45, shinZ: 0.0415, bookmaker: "median(13)", marginMethod: "shin", bookmakersUsed: 13 }, id: 1531636 }),
    '{"id": 1531636, "odds": {"away": 2.69, "draw": 3.3, "home": 2.45, "shinZ": 0.0415, "bookmaker": "median(13)", "marginMethod": "shin", "bookmakersUsed": 13}}'
  );
  // Floats that exist in production and must survive verbatim.
  assert.equal(pgJsonbText({ w: 0.6000000000000001 }), '{"w": 0.6000000000000001}');
  assert.equal(pgJsonbText({ o: 1.3650000000000002 }), '{"o": 1.3650000000000002}');
  assert.equal(pgJsonbText({ a: 1.4843478260869565 }), '{"a": 1.4843478260869565}');
  // JSON.stringify is NOT equivalent — this is the whole reason the helper exists.
  assert.notEqual(pgJsonbText({ odds: 1, id: 2 }), JSON.stringify({ odds: 1, id: 2 }));
});

test("3. timestamps keep microseconds and refuse a non-UTC offset", () => {
  assert.equal(pgTimestampMicros("2026-09-19T15:20:25.053+00:00"), "2026-09-19T15:20:25.053000");
  assert.equal(pgTimestampMicros("2026-09-19T15:20:25.053456+00:00"), "2026-09-19T15:20:25.053456");
  assert.equal(pgTimestampMicros("2026-09-19T15:20:25+00:00"), "2026-09-19T15:20:25.000000");
  assert.equal(pgTimestampMicros("2026-09-19T15:20:25.053Z"), "2026-09-19T15:20:25.053000");
  assert.equal(pgTimestampMicros(null), "");
  assert.equal(isoMicrosZ("2026-09-19T15:20:25.053+00:00"), "2026-09-19T15:20:25.053000Z");
  // A Date round-trip truncates .000001 to .000 — parsing is textual for exactly
  // this reason, so prove the microseconds survive.
  assert.equal(pgTimestampMicros("2026-09-19T15:20:25.000001+00:00"), "2026-09-19T15:20:25.000001");
  assert.throws(() => pgTimestampMicros("2026-09-19T15:20:25.053+02:00"), /expected UTC/);
  assert.throws(() => pgTimestampMicros("not-a-timestamp"), /unparseable/);
});

// ---------------------------------------------------------------- row hash

test("4. row hash is deterministic, key-order independent and value sensitive", () => {
  const a = makeRow(1);
  const b = { ...a, raw_payload: { note: "synthetic", odds: { away: 2.69, home: 2.45 }, id: 1001 } };
  assert.equal(rowHash(a), rowHash(a), "stable across calls");
  assert.equal(rowHash(a), rowHash(b), "payload key order must not change the hash");
  assert.notEqual(rowHash(a), rowHash({ ...a, fixture_id: 9999 }));
  assert.notEqual(rowHash(a), rowHash({ ...a, model_version: "v2" }));
  assert.notEqual(rowHash(a), rowHash({ ...a, league_id: 40 }));
  assert.notEqual(rowHash(a), rowHash({ ...a, raw_payload: { ...a.raw_payload, note: "x" } }));
  // A null league_id is the empty string in the recipe, never the text "null",
  // and never conflated with a real 0.
  const nullLeague = rowHash({ ...a, league_id: null });
  assert.notEqual(nullLeague, rowHash({ ...a, league_id: 0 }));
  assert.equal(nullLeague, rowHash({ ...a, league_id: undefined }));
  assert.match(rowHash(a), /^[0-9a-f]{64}$/);
});

test("5. the aggregate checksum is independent of fetch order", () => {
  const rows = [3, 1, 2].map((n) => ({ id: uuid(n), generated_at: "2026-04-15T10:00:00.000000Z", hash: `h${n}` }));
  assert.equal(aggregateChecksums(rows).checksum_all_md5, aggregateChecksums([...rows].reverse()).checksum_all_md5);
  const mixed = aggregateChecksums([
    { id: uuid(1), generated_at: "2026-04-15T10:00:00.000000Z", hash: "a" },
    { id: uuid(2), generated_at: "2026-05-15T10:00:00.000000Z", hash: "b" }
  ]);
  assert.deepEqual(Object.keys(mixed.checksums_by_month), ["2026-04", "2026-05"], "bucketed by generated_at");
});

// ---------------------------------------------------------------- paging

test("6. keyset paging walks every row exactly once and never uses OFFSET", async () => {
  const rows = Array.from({ length: 23 }, (_, i) => makeRow(i + 1));
  const sb = fakeClient(rows);
  const seen = [];
  let last = UUID_ZERO;
  for (;;) {
    const page = await fetchPage(sb, last, 5);
    if (!page.length) break;
    seen.push(...page.map((r) => r.id));
    last = page[page.length - 1].id;
  }
  assert.equal(seen.length, 23, "every row once");
  assert.equal(new Set(seen).size, 23, "no duplicates");
  assert.deepEqual(seen, [...seen].sort(), "ascending id order");
  for (const c of sb.calls) {
    assert.ok(c.gt !== null && c.gt !== undefined, "every page is bounded by id >");
    assert.equal(c.order.col, "id");
    assert.equal(c.order.ascending, true);
    assert.ok(!("offset" in c), "OFFSET must never appear");
  }
});

test("7. chunk sizing converges on the byte target and stays inside its bounds", () => {
  assert.equal(nextChunkSize(TARGET_BYTES, 25, 25), 25, "already on target -> unchanged");
  assert.ok(nextChunkSize(TARGET_BYTES * 4, 25, 25) < 25, "oversized page shrinks");
  assert.ok(nextChunkSize(TARGET_BYTES / 4, 25, 25) > 25, "undersized page grows");
  assert.equal(nextChunkSize(1, 1, 25), MAX_CHUNK, "tiny rows clamp at MAX_CHUNK");
  assert.equal(nextChunkSize(TARGET_BYTES * 1000, 1, 25), MIN_CHUNK, "huge rows clamp at MIN_CHUNK");
  assert.equal(nextChunkSize(0, 0, 40), 40, "an empty page leaves the size alone");
});

// ---------------------------------------------------------------- export + verify

test("8. export writes a verifiable archive and a manifest that matches it", async () => {
  await withTmp(async (dir) => {
    const rows = Array.from({ length: 17 }, (_, i) => makeRow(i + 1));
    const { archive, manifestPath, manifest } = await exportAll(fakeClient(rows), {
      out: dir, repoRoot: path.join(dir, "__no_repo__"), quiet: true, now: "2026-09-20T09:00:00.000Z", sha: "c30c0d78deadbeef"
    });

    assert.ok(existsSync(archive) && existsSync(manifestPath));
    assert.match(path.basename(archive), /^prediction_snapshots_export_\d{8}T\d{4}Z_17rows_c30c0d78\.jsonl\.gz$/);

    assert.equal(manifest.row_count, 17);
    assert.equal(manifest.distinct_fixtures, 3);
    assert.ok(manifest.hash_recipe.startsWith("sha256("));
    assert.deepEqual(manifest.key_order, KEY_ORDER);
    assert.match(manifest.gzip_sha256, /^[0-9a-f]{64}$/);
    assert.ok(manifest.gzip_bytes > 0 && manifest.uncompressed_bytes > manifest.gzip_bytes);
    assert.match(manifest.ddl, /CREATE TABLE public\.prediction_snapshots/);

    // JSONL round-trip: one line per row, fixed key order, payload intact.
    const lines = gunzipSync(readFileSync(archive)).toString("utf8").trim().split("\n");
    assert.equal(lines.length, 17);
    const first = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(first), KEY_ORDER, "fixed key order on the wire");
    assert.match(first.generated_at, /\.\d{6}Z$/, "microsecond precision preserved");
    const source = rows.find((r) => r.id === first.id);
    assert.deepEqual(first.raw_payload, source.raw_payload, "payload survives the round trip");
    assert.equal(rowHash(first), rowHash(source), "archived row hashes to the same value as the source");

    assert.deepEqual(await verifyArchive(archive, { expect: manifest, quiet: true }), [], "verifies clean");
  });
});

test("9. verification FAILS on drift or a corrupt container", async () => {
  await withTmp(async (dir) => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(i + 1));
    const { archive, manifest } = await exportAll(fakeClient(rows), {
      out: dir, repoRoot: path.join(dir, "__no_repo__"), quiet: true, now: "2026-09-20T09:00:00.000Z"
    });

    const wrong = await verifyArchive(archive, { expect: { ...manifest, row_count: 11 }, quiet: true });
    assert.ok(wrong.some((f) => f.includes("row_count")), "row-count drift is caught");

    const badSum = await verifyArchive(archive, { expect: { ...manifest, checksum_all_md5: "0".repeat(32) }, quiet: true });
    assert.ok(badSum.some((f) => f.includes("checksum_all_md5")), "checksum drift is caught");

    const badMonth = await verifyArchive(archive, {
      expect: { ...manifest, checksums_by_month: { ...manifest.checksums_by_month, "2026-04": "f".repeat(32) } }, quiet: true
    });
    assert.ok(badMonth.some((f) => f.includes("2026-04")), "per-month drift is caught");

    const badTs = await verifyArchive(archive, { expect: { ...manifest, max_generated_at: "2030-01-01T00:00:00.000000Z" }, quiet: true });
    assert.ok(badTs.some((f) => f.includes("max_generated_at")), "timestamp drift is caught");

    // Corrupt the gzip container itself.
    const bytes = readFileSync(archive);
    writeFileSync(archive, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const truncated = await verifyArchive(archive, { expect: manifest, quiet: true });
    assert.ok(truncated.length > 0, "a truncated archive never verifies");
    assert.ok(truncated.some((f) => /gzip/i.test(f)), "the gzip check is what catches it");
  });
});

test("10. resume continues from the last written id, without gaps or repeats", async () => {
  await withTmp(async (dir) => {
    const rows = Array.from({ length: 20 }, (_, i) => makeRow(i + 1));
    const repoRoot = path.join(dir, "__no_repo__");
    const first = await exportAll(fakeClient(rows), { out: dir, repoRoot, quiet: true, limit: 8, now: "2026-09-20T09:00:00.000Z" });
    assert.equal(first.manifest.row_count, 8);

    const firstIds = gunzipSync(readFileSync(first.archive)).toString("utf8").trim().split("\n").map((l) => JSON.parse(l).id);
    const lastWritten = firstIds[firstIds.length - 1];

    const second = await exportAll(fakeClient(rows), {
      out: dir, repoRoot, quiet: true, resumeAfter: lastWritten, now: "2026-09-20T09:30:00.000Z"
    });
    const secondIds = gunzipSync(readFileSync(second.archive)).toString("utf8").trim().split("\n").map((l) => JSON.parse(l).id);

    assert.equal(firstIds.length + secondIds.length, 20, "the two halves are the whole table");
    assert.equal(new Set([...firstIds, ...secondIds]).size, 20, "no row exported twice");
    assert.ok(secondIds.every((id) => id > lastWritten), "the resume boundary is exclusive");
  });
});

test("11. a failed chunk aborts the export — a gap is never skipped over", async () => {
  await withTmp(async (dir) => {
    const rows = Array.from({ length: 30 }, (_, i) => makeRow(i + 1));
    await assert.rejects(
      () => exportAll(fakeClient(rows, { failOnPageIndex: 1 }), {
        out: dir, repoRoot: path.join(dir, "__no_repo__"), quiet: true, now: "2026-09-20T09:00:00.000Z"
      }),
      /simulated transport failure/
    );
    const finished = readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz") && !f.includes(".partial."));
    assert.deepEqual(finished, [], "an aborted run publishes no archive");
  });
});

// ---------------------------------------------------------------- repo safety

test("12. an export refuses to write anywhere inside the repository", async () => {
  const repo = process.cwd();
  assert.throws(() => assertOutsideRepo(repo, repo), /refusing to write inside the repository/);
  assert.throws(() => assertOutsideRepo(path.join(repo, "scripts"), repo), /refusing to write inside the repository/);
  assert.throws(() => assertOutsideRepo(path.join(repo, "data", "x"), repo), /refusing to write inside the repository/);
  // The default destination is the OS temp area, never the worktree.
  const dflt = defaultOutDir(null);
  assert.doesNotThrow(() => assertOutsideRepo(dflt, repo));
  assert.ok(!path.resolve(dflt).startsWith(path.resolve(repo) + path.sep));

  await withTmp(async (dir) => {
    await assert.rejects(
      () => exportAll(fakeClient([makeRow(1)]), { out: path.join(repo, "tmp-should-not-exist"), repoRoot: repo, quiet: true }),
      /refusing to write inside the repository/
    );
    assert.equal(existsSync(path.join(repo, "tmp-should-not-exist")), false, "nothing was created in the repo");
    await exportAll(fakeClient([makeRow(1)]), { out: dir, repoRoot: repo, quiet: true, now: "2026-09-20T09:00:00.000Z" });
    assert.equal(readdirSync(dir).length, 2, "exactly the archive and its manifest");
  });
});
