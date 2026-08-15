import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";
import { persistSettledBet, settlePendingGlobalSpecialBets } from "../../server-utils/globalSpecialBets.js";
import { MISSING_STATS_VOID_AFTER_MS } from "../../server-utils/globalSpecialBetSettlement.js";

/**
 * Global Special Bet SETTLEMENT — database integration suite.
 *
 * Exercises the persistence path against real Postgres: that a settled bet is
 * written exactly once, that re-running changes nothing, that snapshot columns
 * never move, and — the reason this suite exists — that an update which touches
 * zero rows is reported as a FAILURE rather than as success.
 *
 * Runs against the same throwaway container as the increment 2.1 suite, with
 * migrations 043 and 044 applied to it.
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BET_DATE = "2026-08-09";
const KICKOFF = "2026-08-09T18:00:00Z";
const KICKOFF_MS = Date.parse(KICKOFF);
const JUST_AFTER = KICKOFF_MS + 60 * 60 * 1000;
const BEFORE_48H = KICKOFF_MS + MISSING_STATS_VOID_AFTER_MS - 1000;
const AT_48H = KICKOFF_MS + MISSING_STATS_VOID_AFTER_MS;

function psql(sqlText, { expectFailure = false } = {}) {
  const res = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"],
    { input: sqlText, encoding: "utf8" }
  );
  if (res.error) {
    throw new Error(
      `Cannot reach the test container "${CONTAINER}". Start it with ` +
        `npm run test:integration:global-special-bets. Underlying error: ${res.error.message}`
    );
  }
  if (!expectFailure && res.status !== 0) {
    throw new Error(`SQL failed:\n${sqlText}\n---\n${(res.stderr || "").trim()}`);
  }
  return { ok: res.status === 0, stdout: (res.stdout || "").trim(), stderr: (res.stderr || "").trim() };
}

const value = (sqlText) => psql(sqlText).stdout;

/**
 * psql interleaves command tags (BEGIN / SET / COMMIT) with results, and
 * `json_agg` wraps across lines — so the payload is everything that is not a
 * tag, rejoined.
 */
function parseJsonPayload(stdout) {
  const TAGS = new Set(["BEGIN", "COMMIT", "SET", "ROLLBACK"]);
  const body = stdout
    .split("\n")
    .filter((line) => !TAGS.has(line.trim()))
    .join("")
    .trim();
  return JSON.parse(body || "[]");
}

function quote(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * A Supabase-shaped client over the container.
 *
 * Only the calls the settlement path makes are implemented, and each one runs
 * real SQL — the point of this suite is that the database, not a stub, decides
 * what happened. Updates use a RETURNING CTE so the row count is the real one:
 * an RLS-filtered UPDATE exits successfully having matched nothing.
 */
function containerClient({ role = null } = {}) {
  const prelude = role ? `set local role ${role}; ` : "";

  return {
    from(table) {
      const filters = [];
      let selected = "*";
      const where = () => (filters.length ? `where ${filters.join(" and ")}` : "");

      const api = {
        select(cols) {
          selected = cols || "*";
          return api;
        },
        eq(col, val) {
          filters.push(`${col} = ${quote(val)}`);
          return api;
        },
        in(col, vals) {
          filters.push(`${col} in (${vals.map(quote).join(",")})`);
          return api;
        },
        order: () => api,
        limit: () => api,
        update(patch) {
          const sets = Object.entries(patch)
            .map(([k, v]) => `${k} = ${quote(v)}`)
            .join(", ");
          const updateApi = {
            eq(col, val) {
              filters.push(`${col} = ${quote(val)}`);
              return updateApi;
            },
            in(col, vals) {
              filters.push(`${col} in (${vals.map(quote).join(",")})`);
              return updateApi;
            },
            select(cols) {
              // The data-modifying CTE has to sit at the top level — Postgres
              // rejects it inside a subselect — and RETURNING is what makes the
              // real row count visible.
              const out = psql(
                `begin; ${prelude}with upd as (` +
                  `update public.${table} set ${sets} ${where()} returning ${cols || "id"}` +
                  `) select coalesce(json_agg(upd), '[]') from upd; commit;`,
                { expectFailure: true }
              );
              if (!out.ok) return Promise.resolve({ data: null, error: { message: out.stderr } });
              return Promise.resolve({ data: parseJsonPayload(out.stdout), error: null });
            }
          };
          return updateApi;
        },
        then(resolve) {
          const out = psql(
            `select coalesce(json_agg(t), '[]') from (select ${selected} from public.${table} ${where()}) t;`
          );
          return resolve({ data: JSON.parse(out.stdout || "[]"), error: null });
        }
      };
      return api;
    }
  };
}

function seedFixture(id, { status = "FT", home = 2, away = 1, marketResults = {} } = {}) {
  const payload = JSON.stringify({ marketResults }).replace(/'/g, "''");
  psql(`insert into public.predictions_history (fixture_id, match_status, score_home, score_away, raw_payload, kickoff_at)
        values (${id}, '${status}', ${home === null ? "null" : home}, ${away === null ? "null" : away},
                '${payload}'::jsonb, '${KICKOFF}')
        on conflict (fixture_id) do update set match_status = excluded.match_status,
          score_home = excluded.score_home, score_away = excluded.score_away,
          raw_payload = excluded.raw_payload;`);
}

function seedBet(selections) {
  const json = JSON.stringify(selections).replace(/'/g, "''");
  const out = psql(`select public.create_global_special_bet(
      '${USER_A}'::uuid, '${BET_DATE}'::date, 3::smallint, '{39}'::int[],
      5.0, 80.00, 'predictor-v3.1-test', '${json}'::jsonb
    );`);
  return JSON.parse(out.stdout).bet.id;
}

const selection = (fixtureId, overrides = {}) => ({
  fixture_id: fixtureId,
  league_id: 39,
  kickoff_at: KICKOFF,
  market: "ou",
  selection: "Over 2.5",
  side: "over",
  line: 2.5,
  odds: 2.0,
  confidence: 80,
  value_score: 60,
  ...overrides
});

const reset = () => psql("truncate table public.special_bets cascade; truncate table public.predictions_history;");

before(() => {
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  // Every migration that touches special_bets, not just the two that created it.
  // The suite had been running against a schema frozen at 044, which only held
  // because no code path selected a column added later; the settlement query now
  // reads bet_kind and system_k, and a stale schema would have hidden that.
  //
  // 049 is deliberately absent: it alters predictions_history, which this suite
  // replaces with the cut-down stand-in created below.
  for (const migration of [
    "043_global_special_bets.sql",
    "044_global_special_bet_settlement.sql",
    "048_special_bet_selection_labels.sql",
    "050_gsb_probability_snapshot.sql",
    "052_gsb_system_tickets.sql"
  ]) {
    psql(fs.readFileSync(`supabase/migrations/${migration}`, "utf8"));
  }
  psql(`insert into auth.users (id, email) values ('${USER_A}', 'a@test.local') on conflict (id) do nothing;`);
  // Minimal stand-in for the table settlement reads fixture state from.
  psql(`create table if not exists public.predictions_history (
          fixture_id bigint primary key,
          match_status text,
          score_home int,
          score_away int,
          kickoff_at timestamptz,
          raw_payload jsonb
        );`);
});

beforeEach(reset);

test("A: 3 of 3 winning settles the bet as won with the product of the odds", async () => {
  [901, 902, 903].forEach((id) => seedFixture(id, { home: 2, away: 1 }));
  seedBet([selection(901), selection(902), selection(903)]);

  const summary = await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: containerClient() });

  assert.deepEqual(summary.failures, []);
  assert.equal(summary.settled, 1);
  assert.equal(value("select status from public.special_bets;"), "won");
  assert.equal(value("select settled_total_odds::text from public.special_bets;"), "8.000");
  assert.equal(value("select count(*) from public.special_bet_selections where status = 'won';"), "3");
});

test("B: one lost leg settles the bet as lost with no settled odds", async () => {
  seedFixture(901, { home: 2, away: 1 });
  seedFixture(902, { home: 2, away: 1 });
  seedFixture(903, { home: 0, away: 0 });
  seedBet([selection(901), selection(902), selection(903)]);

  await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: containerClient() });

  assert.equal(value("select status from public.special_bets;"), "lost");
  assert.equal(value("select coalesce(settled_total_odds::text, 'NULL') from public.special_bets;"), "NULL");
});

test("C/H/I/J: a cancelled fixture voids its leg and the rest still wins", async () => {
  for (const status of ["PST", "CANC", "ABD"]) {
    reset();
    seedFixture(901, { home: 2, away: 1 });
    seedFixture(902, { home: 2, away: 1 });
    seedFixture(903, { status, home: null, away: null });
    seedBet([selection(901), selection(902), selection(903)]);

    await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: containerClient() });

    assert.equal(value("select status from public.special_bets;"), "won", `${status} must void, not lose`);
    assert.equal(value("select settled_total_odds::text from public.special_bets;"), "4.000");
    assert.equal(value("select count(*) from public.special_bet_selections where status = 'void';"), "1");
  }
});

test("D: every leg void settles the bet as void at odds 1.000", async () => {
  [901, 902, 903].forEach((id) => seedFixture(id, { status: "PST", home: null, away: null }));
  seedBet([selection(901), selection(902), selection(903)]);

  await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: containerClient() });

  assert.equal(value("select status from public.special_bets;"), "void");
  assert.equal(value("select settled_total_odds::text from public.special_bets;"), "1.000");
});

test("E: an undecided leg holds the whole bet pending", async () => {
  seedFixture(901, { home: 2, away: 1 });
  seedFixture(902, { home: 2, away: 1 });
  seedFixture(903, { status: "1H", home: 0, away: 0 });
  seedBet([selection(901), selection(902), selection(903)]);

  await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: containerClient() });

  assert.equal(value("select status from public.special_bets;"), "pending");
  assert.equal(value("select coalesce(settled_at::text, 'NULL') from public.special_bets;"), "NULL");
});

test("F: a lost leg beats a pending one", async () => {
  seedFixture(901, { home: 0, away: 0 });
  seedFixture(902, { status: "1H", home: 0, away: 0 });
  seedFixture(903, { home: 2, away: 1 });
  seedBet([selection(901), selection(902), selection(903)]);

  await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: containerClient() });

  assert.equal(value("select status from public.special_bets;"), "lost");
});

test("K/L: a missing official statistic holds, then voids at 48 hours", async () => {
  [901, 902, 903].forEach((id) => seedFixture(id, { home: 2, away: 1 }));
  const corners = (id) => selection(id, { market: "corners", side: "over", line: 7.5 });
  seedBet([corners(901), corners(902), corners(903)]);

  await settlePendingGlobalSpecialBets({ now: BEFORE_48H, supabase: containerClient() });
  assert.equal(value("select status from public.special_bets;"), "pending", "no corners total yet");

  await settlePendingGlobalSpecialBets({ now: AT_48H, supabase: containerClient() });
  assert.equal(value("select status from public.special_bets;"), "void", "the statistic is never coming");
});

test("G: an update that touches no rows is a FAILURE, not a success", async () => {
  seedFixture(901, { home: 2, away: 1 });
  seedFixture(902, { home: 2, away: 1 });
  seedFixture(903, { home: 2, away: 1 });
  const betId = seedBet([selection(901), selection(902), selection(903)]);

  // `authenticated` has no UPDATE policy, so the statement succeeds having
  // matched nothing — the exact trap the 2.1 suite uncovered.
  const settlement = {
    selectionChanges: [{ id: value("select id from public.special_bet_selections limit 1;"), status: "won" }],
    betStatus: "won",
    settledTotalOdds: 8,
    isTerminal: true
  };

  const result = await persistSettledBet(
    containerClient({ role: "authenticated" }),
    { id: betId },
    settlement,
    JUST_AFTER
  );

  assert.equal(result.ok, false, "a zero-row update must never be reported as success");
  assert.match(result.error, /touched 0 of 1 rows/);
  assert.equal(value("select status from public.special_bets;"), "pending", "nothing may have changed");
});

test("M/N/O: re-running settlement is idempotent and leaves the snapshot untouched", async () => {
  [901, 902, 903].forEach((id) => seedFixture(id, { home: 2, away: 1 }));
  seedBet([selection(901), selection(902), selection(903)]);

  const stateSql =
    "select status || '|' || settled_total_odds::text || '|' || settled_at::text from public.special_bets;";

  await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: containerClient() });
  const first = value(stateSql);

  const second = await settlePendingGlobalSpecialBets({ now: JUST_AFTER + 999999, supabase: containerClient() });

  assert.equal(second.scanned, 0, "a settled bet is no longer pending, so it is not rescanned");
  assert.equal(value(stateSql), first, "status, settled odds and settled_at must not move on a rerun");

  // Snapshot columns are exactly what was written at generation.
  assert.equal(value("select total_odds::text from public.special_bets;"), "5.000");
  assert.equal(value("select distinct odds::text from public.special_bet_selections;"), "2.000");
  assert.equal(value("select distinct confidence::text from public.special_bet_selections;"), "80.00");
  assert.equal(value("select distinct value_score::text from public.special_bet_selections;"), "60.00");
  assert.equal(value("select distinct selection from public.special_bet_selections;"), "Over 2.5");
});
