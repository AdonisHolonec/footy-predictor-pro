/**
 * READ-ONLY off-instance archive of public.prediction_snapshots.
 *
 * The table stopped being written by PR #265 and is the only point-in-time
 * record of pre-match market movement in the system (1,250 of 1,500 fixtures
 * carry more than one snapshot, 157 rows are the last v2 artifacts). It has to
 * exist somewhere outside Postgres before anyone reclaims its ~278 MB, so this
 * script produces an archive AND the evidence that the archive is complete.
 *
 * IT NEVER WRITES TO THE DATABASE. Only .select() is issued — no upsert, no
 * rpc, no CREATE TABLE AS, no temp table, no VACUUM. Killing it mid-run leaves
 * production untouched; the partial archive is simply discarded.
 *
 *   node scripts/export-prediction-snapshots.mjs --probe          # fidelity check first
 *   node scripts/export-prediction-snapshots.mjs --plan           # counts + sizing only
 *   node scripts/export-prediction-snapshots.mjs                  # the export
 *   node scripts/export-prediction-snapshots.mjs --verify=<file>  # re-read a finished archive
 *   node scripts/export-prediction-snapshots.mjs --verify=<file> --sample=20
 *
 * WHY THE HASH IS NOT JSON.stringify. The reference checksums were computed in
 * Postgres over `raw_payload::text`, and jsonb's renderer does two things
 * JSON.stringify does not: it sorts keys by (length, then bytewise) and puts a
 * space after ':' and ','. On a sampled row that is 924 bytes of separator
 * space in 10,173 bytes of text. A hash built on JSON.stringify could never
 * reproduce the reference, so "checksum mismatch" would carry no information.
 * pgJsonbText() reimplements jsonb's renderer instead.
 *
 * WHAT THAT STILL CANNOT GUARANTEE. supabase-js hands us JSON that has already
 * been through JSON.parse, so any number Postgres holds in a form a JS double
 * cannot round-trip (trailing zeros, >17 significant digits, exponent notation)
 * is lost before this code sees it. These payloads were authored in Node, so
 * their numbers are already JS-canonical and round-trip exactly — but that is
 * an observation, not a proof. `--probe` is the proof: it renders real rows and
 * prints the bytes/sha256 to compare against octet_length(raw_payload::text).
 * RUN IT BEFORE THE EXPORT.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { createGzip, gunzipSync } from "node:zlib";
import { createWriteStream, createReadStream, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const TABLE = "prediction_snapshots";
const COLUMNS = "id,fixture_id,model_version,generated_at,league_id,kickoff_at,raw_payload";

/** JSONL key order. Fixed, so two exports of the same rows are byte-identical. */
const KEY_ORDER = ["id", "fixture_id", "model_version", "generated_at", "league_id", "kickoff_at", "raw_payload"];

/**
 * Chunk sizing.
 *
 * The audit proposed era-aware sizes (500 rows for April, 25 for September).
 * That is unreachable for THIS ordering: the keyset runs over a random uuid
 * primary key, so every page is a random sample of all five eras and the
 * per-page mean is the table mean. A byte-feedback controller is both reachable
 * and deterministic given the data, so a resumed run re-derives the same sizes.
 */
const TARGET_BYTES = 8 * 1024 * 1024;
const MIN_CHUNK = 5;
const MAX_CHUNK = 500;
const START_CHUNK = 25;

/** Production reference, measured 2026-09-20T08:50Z. --verify checks against these. */
const REFERENCE = {
  row_count: 8002,
  distinct_fixtures: 1500,
  min_generated_at: "2026-04-19T07:18:38.388000Z",
  max_generated_at: "2026-09-19T15:20:25.053000Z",
  checksum_all_md5: "ca34c4a4e2071c8ad3c4f257804c58f4",
  checksums_by_month: {
    "2026-04": "d76f2332806650e1f6b2bae006875e14",
    "2026-05": "33113beec9221dda9b48853c793ffa8d",
    "2026-07": "49aa2f6e8beeca7268d0954baea61c02",
    "2026-08": "021fac13fa3e022fabb1c1a7899e3810",
    "2026-09": "f5e9224403af44f157443876dec1e722"
  }
};

const HASH_RECIPE =
  "sha256(id|fixture_id|model_version|generated_at_iso_us|league_id|kickoff_at_iso_us|pg_jsonb_text(raw_payload))";

// ---------------------------------------------------------------- pg-compatible rendering

/**
 * jsonb orders object keys by LENGTH FIRST, then bytewise over the UTF-8 bytes.
 * Not lexicographic — "id" precedes "odds" precedes "logos".
 */
export function pgKeyCompare(a, b) {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return ba.length - bb.length;
  return Buffer.compare(ba, bb);
}

/**
 * Render a value the way jsonb::text does: sorted keys, ", " between entries,
 * ": " after keys. Strings and numbers fall through to JSON.stringify, which
 * matches Postgres for every form a JS double can hold.
 */
export function pgJsonbText(value) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean" || t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(pgJsonbText).join(", ") + "]";
  if (t === "object") {
    const keys = Object.keys(value).sort(pgKeyCompare);
    return "{" + keys.map((k) => JSON.stringify(k) + ": " + pgJsonbText(value[k])).join(", ") + "}";
  }
  throw new Error(`pgJsonbText: unsupported type ${t}`);
}

/**
 * PostgREST returns "2026-09-19T15:20:25.053+00:00"; the hash recipe needs
 * Postgres's to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US') — six fractional
 * digits, no zone suffix.
 *
 * Parsed as TEXT, never through Date: Date truncates to milliseconds while
 * Postgres stores microseconds, so a Date round-trip would silently corrupt any
 * sub-millisecond row. A non-UTC offset throws rather than being converted,
 * because a wrong conversion here is invisible and poisons every hash.
 */
export function pgTimestampMicros(iso) {
  if (iso === null || iso === undefined) return "";
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) throw new Error(`pgTimestampMicros: unparseable timestamp ${JSON.stringify(iso)}`);
  const [, date, time, frac = "", zone] = m;
  if (zone && zone !== "Z" && zone !== "+00:00" && zone !== "+0000") {
    throw new Error(`pgTimestampMicros: expected UTC, got offset ${zone} in ${iso}`);
  }
  return `${date}T${time}.${frac.padEnd(6, "0")}`;
}

/** The archive's timestamp form: the hash form plus an explicit Z. */
export const isoMicrosZ = (iso) => (iso == null ? null : pgTimestampMicros(iso) + "Z");

/** Deterministic per-row hash. Mirrors the SQL digest() exactly. */
export function rowHash(row) {
  const parts = [
    String(row.id),
    String(row.fixture_id),
    String(row.model_version),
    pgTimestampMicros(row.generated_at),
    row.league_id === null || row.league_id === undefined ? "" : String(row.league_id),
    pgTimestampMicros(row.kickoff_at),
    pgJsonbText(row.raw_payload)
  ];
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

/** One JSONL line. Fixed key order; timestamps normalised; payload untouched. */
export function jsonlLine(row) {
  const out = {};
  for (const k of KEY_ORDER) {
    out[k] = k === "generated_at" || k === "kickoff_at" ? isoMicrosZ(row[k]) : row[k];
  }
  return JSON.stringify(out);
}

const monthOf = (isoZ) => String(isoZ).slice(0, 7);

/**
 * Aggregate the per-row hashes the way the SQL did:
 * md5(string_agg(row_hash ORDER BY id)). Sorting by id is what makes the result
 * independent of the order rows were fetched or replayed in.
 */
export function aggregateChecksums(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    const m = monthOf(r.generated_at);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(r);
  }
  const md5Of = (list) => {
    const h = createHash("md5");
    for (const r of [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) h.update(r.hash, "utf8");
    return h.digest("hex");
  };
  const checksums_by_month = {};
  for (const m of [...byMonth.keys()].sort()) checksums_by_month[m] = md5Of(byMonth.get(m));
  return { checksum_all_md5: md5Of(rows), checksums_by_month };
}

// ---------------------------------------------------------------- client / cli

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Supabase nu este configurat (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};
const num = (name, dflt) => {
  const v = flag(name);
  return v === null || v === true ? dflt : Number(v);
};

/** Default output dir is the OS temp area — NEVER the git worktree. */
export function defaultOutDir(explicit) {
  if (explicit && explicit !== true) return String(explicit);
  const tmp = process.env.TEMP || process.env.TMPDIR || "/tmp";
  return path.join(tmp, "prediction-snapshots-export");
}

/** Refuse to write anywhere inside the repository. */
export function assertOutsideRepo(dir, repoRoot = process.cwd()) {
  const repo = path.resolve(repoRoot);
  const target = path.resolve(dir);
  if (target === repo || target.startsWith(repo + path.sep)) {
    throw new Error(
      `refusing to write inside the repository (${target}). Archives live outside the worktree; pass --out=<dir>.`
    );
  }
  return target;
}

// ---------------------------------------------------------------- keyset paging

export const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

/**
 * One keyset page. `WHERE id > last ORDER BY id LIMIT n` — never OFFSET, which
 * re-scans and cannot be resumed. Any error throws: a skipped chunk would be a
 * silently incomplete archive, which is worse than no archive at all.
 */
export async function fetchPage(sb, lastId, limit) {
  const { data, error } = await sb
    .from(TABLE)
    .select(COLUMNS)
    .gt("id", lastId)
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`chunk after id=${lastId} (limit ${limit}) failed: ${error.message}`);
  return data ?? [];
}

export function nextChunkSize(bytes, rows, current) {
  if (!rows) return current;
  const perRow = bytes / rows;
  return Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, Math.max(1, Math.round(TARGET_BYTES / perRow))));
}

// ---------------------------------------------------------------- export

/**
 * Stream every row to gzip, hashing as we go. `lastId` only ever advances to a
 * row that has been written, so --resume-after=<id> restarts from a known-good
 * boundary rather than guessing.
 */
export async function exportAll(sb, opts = {}) {
  const outDir = assertOutsideRepo(defaultOutDir(opts.out), opts.repoRoot);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const limit = opts.limit ?? Infinity;
  let lastId = opts.resumeAfter ?? UUID_ZERO;
  const startedAt = opts.now ?? new Date().toISOString();
  const stamp = startedAt.slice(0, 16).replace(/[-:]/g, "") + "Z";
  const sha = opts.sha ?? process.env.PRODUCTION_SHA ?? "unknown";

  const hashes = [];
  const fixtures = new Set();
  let rowCount = 0;
  let uncompressed = 0;
  let minGen = null;
  let maxGen = null;
  let chunk = START_CHUNK;

  const tmpArchive = path.join(outDir, `prediction_snapshots_export_${stamp}.partial.jsonl.gz`);
  const gzip = createGzip({ level: 9 });
  const done = pipeline(gzip, createWriteStream(tmpArchive));

  try {
    for (;;) {
      if (rowCount >= limit) break;
      const want = Math.min(chunk, limit - rowCount);
      const page = await fetchPage(sb, lastId, want);
      if (!page.length) break;

      let pageBytes = 0;
      for (const row of page) {
        const line = jsonlLine(row) + "\n";
        pageBytes += Buffer.byteLength(line, "utf8");
        if (!gzip.write(line)) await new Promise((r) => gzip.once("drain", r));
        const genZ = isoMicrosZ(row.generated_at);
        hashes.push({ id: row.id, generated_at: genZ, hash: rowHash(row) });
        fixtures.add(row.fixture_id);
        if (minGen === null || genZ < minGen) minGen = genZ;
        if (maxGen === null || genZ > maxGen) maxGen = genZ;
        rowCount += 1;
        lastId = row.id; // resume point = last row actually written
      }
      uncompressed += pageBytes;
      chunk = nextChunkSize(pageBytes, page.length, chunk);
      if (!opts.quiet) {
        process.stdout.write(`\r  ${rowCount} rows, ${(uncompressed / 1048576).toFixed(1)} MB raw, next ${chunk}   `);
      }
    }
  } catch (err) {
    /*
      A failed chunk aborts, and the half-written archive goes with it. Leaving
      the .partial behind invites someone to find a plausible-looking 200 MB
      file and trust it; the stream and its file handle have to be torn down
      too, or the pipeline promise rejects later, unattached, as an
      unhandledRejection. Resume from the last id this run actually WROTE:
          --resume-after=<lastId>
    */
    gzip.destroy();
    await done.catch(() => {});
    try {
      unlinkSync(tmpArchive);
    } catch {
      /* nothing to clean up */
    }
    err.message = `${err.message}${lastId !== UUID_ZERO ? ` (resume with --resume-after=${lastId})` : ""}`;
    throw err;
  }
  gzip.end();
  await done;
  if (!opts.quiet) process.stdout.write("\n");

  const gzBytes = statSync(tmpArchive).size;
  const gzSha = await sha256File(tmpArchive);
  const { checksum_all_md5, checksums_by_month } = aggregateChecksums(hashes);

  const finalArchive = path.join(
    outDir,
    `prediction_snapshots_export_${stamp}_${rowCount}rows_${String(sha).slice(0, 8)}.jsonl.gz`
  );
  const manifestPath = finalArchive.replace(/\.jsonl\.gz$/, ".manifest.json");
  renameSync(tmpArchive, finalArchive);

  const manifest = {
    table: `public.${TABLE}`,
    project_ref: (process.env.SUPABASE_URL || "").split("//")[1]?.split(".")[0] ?? "unknown",
    exported_at_utc: startedAt,
    production_sha: sha,
    writer_removed_by: "PR #265",
    row_count: rowCount,
    distinct_fixtures: fixtures.size,
    min_generated_at: minGen,
    max_generated_at: maxGen,
    archive_file: path.basename(finalArchive),
    gzip_sha256: gzSha,
    gzip_bytes: gzBytes,
    uncompressed_bytes: uncompressed,
    hash_recipe: HASH_RECIPE,
    checksum_all_md5,
    checksums_by_month,
    key_order: KEY_ORDER,
    ddl: [
      `CREATE TABLE public.${TABLE} (`,
      "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
      "  fixture_id bigint NOT NULL,",
      "  model_version text NOT NULL,",
      "  generated_at timestamptz NOT NULL DEFAULT now(),",
      "  league_id integer,",
      "  kickoff_at timestamptz,",
      "  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb",
      ");"
    ].join("\n")
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { archive: finalArchive, manifestPath, manifest };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

// ---------------------------------------------------------------- verification

/**
 * Re-read a finished archive and recompute everything from its CONTENT. The
 * exporter's own tallies are not evidence — this is the check that can fail.
 * Returns a list of failures; empty means verified.
 */
export async function verifyArchive(file, { expect = null, sb = null, sampleN = 0, quiet = false } = {}) {
  const failures = [];
  const manifestPath = file.replace(/\.jsonl\.gz$/, ".manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : null;

  // gzip integrity, equivalent to `gzip -t`: a truncated member throws here.
  const raw = await readFile(file);
  let plain;
  try {
    plain = gunzipSync(raw);
  } catch (e) {
    return [`gzip integrity: ${e.message}`];
  }

  if (manifest) {
    const actualSha = createHash("sha256").update(raw).digest("hex");
    if (manifest.gzip_sha256 && manifest.gzip_sha256 !== actualSha) {
      failures.push(`gzip_sha256: manifest ${manifest.gzip_sha256} vs file ${actualSha}`);
    }
    if (manifest.gzip_bytes && manifest.gzip_bytes !== raw.length) {
      failures.push(`gzip_bytes: manifest ${manifest.gzip_bytes} vs file ${raw.length}`);
    }
  }

  const ids = new Set();
  const fixtures = new Set();
  const hashes = [];
  let lines = 0;
  let minGen = null;
  let maxGen = null;
  let dupes = 0;

  for (const line of plain.toString("utf8").split("\n")) {
    if (!line) continue;
    lines += 1;
    const row = JSON.parse(line);
    if (ids.has(row.id)) dupes += 1;
    ids.add(row.id);
    fixtures.add(row.fixture_id);
    if (minGen === null || row.generated_at < minGen) minGen = row.generated_at;
    if (maxGen === null || row.generated_at > maxGen) maxGen = row.generated_at;
    hashes.push({ id: row.id, generated_at: row.generated_at, hash: rowHash(row) });
  }

  const { checksum_all_md5, checksums_by_month } = aggregateChecksums(hashes);
  if (!quiet) report(lines, fixtures.size, minGen, maxGen, checksum_all_md5, checksums_by_month);

  const want = expect ?? manifest ?? REFERENCE;
  if (lines !== want.row_count) failures.push(`row_count: file ${lines} vs expected ${want.row_count}`);
  if (ids.size !== lines) failures.push(`duplicate ids: ${dupes} repeated, ${ids.size} distinct of ${lines} lines`);
  if (fixtures.size !== want.distinct_fixtures) {
    failures.push(`distinct_fixtures: file ${fixtures.size} vs expected ${want.distinct_fixtures}`);
  }
  if (minGen !== want.min_generated_at) failures.push(`min_generated_at: ${minGen} vs ${want.min_generated_at}`);
  if (maxGen !== want.max_generated_at) failures.push(`max_generated_at: ${maxGen} vs ${want.max_generated_at}`);
  if (checksum_all_md5 !== want.checksum_all_md5) {
    failures.push(`checksum_all_md5: ${checksum_all_md5} vs ${want.checksum_all_md5}`);
  }
  for (const [m, w] of Object.entries(want.checksums_by_month ?? {})) {
    if (checksums_by_month[m] !== w) failures.push(`checksum ${m}: ${checksums_by_month[m]} vs ${w}`);
  }

  if (sampleN > 0) {
    if (!sb) throw new Error("--sample needs database credentials");
    failures.push(...(await sampleAgainstProduction(sb, hashes, sampleN, quiet)));
  }
  return failures;
}

/**
 * Deterministic sample: every Nth row by sorted id, re-read from production and
 * re-hashed. Catches content corruption that cardinality checks cannot.
 */
async function sampleAgainstProduction(sb, hashes, n, quiet) {
  const sorted = [...hashes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const step = Math.max(1, Math.floor(sorted.length / n));
  const picks = [];
  for (let i = 0; i < sorted.length && picks.length < n; i += step) picks.push(sorted[i]);
  const out = [];
  for (const p of picks) {
    const { data, error } = await sb.from(TABLE).select(COLUMNS).eq("id", p.id).maybeSingle();
    if (error) throw new Error(`sample read ${p.id}: ${error.message}`);
    if (!data) {
      out.push(`sample ${p.id}: row missing from production`);
      continue;
    }
    const live = rowHash(data);
    if (live !== p.hash) out.push(`sample ${p.id}: archive ${p.hash} vs production ${live}`);
  }
  if (!quiet) console.log(`sampled ${picks.length} rows against production`);
  return out;
}

function report(rows, fixtures, minGen, maxGen, all, byMonth) {
  console.log(`\n  rows              ${rows}`);
  console.log(`  distinct fixtures ${fixtures}`);
  console.log(`  min generated_at  ${minGen}`);
  console.log(`  max generated_at  ${maxGen}`);
  console.log(`  checksum ALL      ${all}`);
  for (const [m, c] of Object.entries(byMonth)) console.log(`  checksum ${m}   ${c}`);
}

// ---------------------------------------------------------------- modes

async function runPlan(sb) {
  const { count, error } = await sb.from(TABLE).select("id", { count: "exact", head: true });
  if (error) throw new Error(`plan: ${error.message}`);
  console.log(`rows in ${TABLE}: ${count}`);
  console.log(`reference row_count: ${REFERENCE.row_count}${count === REFERENCE.row_count ? " (match)" : " (DRIFT)"}`);
  console.log(`target chunk: ${(TARGET_BYTES / 1048576).toFixed(1)} MB, start ${START_CHUNK} rows`);
  console.log(`output dir: ${defaultOutDir(flag("out"))}`);
}

async function runProbe(sb, n) {
  const { data, error } = await sb.from(TABLE).select(COLUMNS).order("id", { ascending: true }).limit(n);
  if (error) throw new Error(`probe: ${error.message}`);
  console.log(`probing ${data.length} rows\n`);
  for (const row of data.slice(0, Math.min(5, data.length))) {
    const text = pgJsonbText(row.raw_payload);
    console.log(`id=${row.id}`);
    console.log(`  generated_at -> ${pgTimestampMicros(row.generated_at)}`);
    console.log(`  pg_jsonb_text bytes: ${Buffer.byteLength(text, "utf8")}`);
    console.log(`  payload sha256:      ${createHash("sha256").update(text, "utf8").digest("hex")}`);
    console.log(`  row sha256:          ${rowHash(row)}`);
  }
  console.log(
    "\nCompare against, for the same id:\n" +
      "  select octet_length(raw_payload::text), encode(digest(raw_payload::text,'sha256'),'hex')\n" +
      `  from ${TABLE} where id = '<id>';\n` +
      "They must match EXACTLY before running the export."
  );
}

// ---------------------------------------------------------------- entry

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isMain = invoked.endsWith("export-prediction-snapshots.mjs");
if (isMain) {
  const verify = flag("verify");
  const sampleN = num("sample", 0);
  try {
    if (verify && verify !== true) {
      const failures = await verifyArchive(String(verify), { sb: sampleN > 0 ? supabase() : null, sampleN });
      if (failures.length) {
        console.error(`\nVERIFICATION FAILED (${failures.length}):`);
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
      }
      console.log("\nVERIFIED: every cardinality, timestamp and checksum check passed.");
    } else if (flag("plan")) {
      await runPlan(supabase());
    } else if (flag("probe")) {
      await runProbe(supabase(), num("probe-rows", 20));
    } else {
      const limitFlag = num("limit", Infinity);
      const res = await exportAll(supabase(), {
        out: flag("out"),
        limit: limitFlag,
        resumeAfter: flag("resume-after") && flag("resume-after") !== true ? String(flag("resume-after")) : undefined,
        sha: flag("sha") && flag("sha") !== true ? String(flag("sha")) : undefined
      });
      console.log(`\narchive:  ${res.archive}`);
      console.log(`manifest: ${res.manifestPath}`);
      report(
        res.manifest.row_count,
        res.manifest.distinct_fixtures,
        res.manifest.min_generated_at,
        res.manifest.max_generated_at,
        res.manifest.checksum_all_md5,
        res.manifest.checksums_by_month
      );
      console.log(`\nNow verify:\n  node scripts/export-prediction-snapshots.mjs --verify="${res.archive}"`);
    }
  } catch (e) {
    console.error(`\nABORTED: ${e.message}`);
    process.exit(1);
  }
}

export { REFERENCE, HASH_RECIPE, KEY_ORDER, TARGET_BYTES, MIN_CHUNK, MAX_CHUNK, START_CHUNK, TABLE, COLUMNS };
