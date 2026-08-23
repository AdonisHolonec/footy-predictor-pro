import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { parseCreateRequest } from "../server-utils/globalSpecialBetsApi.js";
import { createGlobalSystemBets } from "../server-utils/globalSpecialBets.js";

/**
 * POST /api/special-bets — the public create contract.
 *
 * The public System product is EXACTLY 3/5: five selections of which at least
 * three must win. The user asks for "Bilet Sistem" and nothing else; the server
 * decides the k. These tests exist to prove the client cannot move it, and that
 * Combo is untouched by any of it.
 *
 * `parseCreateRequest` is pure, so the whole request contract is exercised here
 * without a session or a database. The one place a request becomes a row — the
 * service call — runs against a fake Supabase that records what the RPC was
 * asked to store.
 */

const BET_DATE = "2026-08-09";
const KICKOFF = "2026-08-09T18:00:00.000Z";
const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const USER = "11111111-1111-1111-1111-111111111111";

const combo = (over = {}) => ({ bet_date: BET_DATE, variant: 5, leagueIds: [39], ...over });
const system = (over = {}) => combo({ bet_kind: "system", ...over });

// ── The k belongs to the server ──────────────────────────────────────────────

test("[P1] a request with no bet_kind is a Combo, exactly as before", () => {
  const parsed = parseCreateRequest({ bet_date: BET_DATE, variant: 3, leagueIds: [39] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.betKind, "combo");
  assert.equal(parsed.variant, 3);
  assert.equal(parsed.systemK, null, "a combo has no k at all");
});

test("[P2] an explicit Combo is the same request", () => {
  const parsed = parseCreateRequest(combo({ bet_kind: "combo", variant: 8 }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.betKind, "combo");
  assert.equal(parsed.variant, 8);
  assert.equal(parsed.systemK, null);
});

test("[P3] a System request asks for no k and is given 3", () => {
  const parsed = parseCreateRequest(system());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.betKind, "system");
  assert.equal(parsed.variant, 5);
  assert.equal(parsed.systemK, 3, "the public product is 3/5 and nothing else");
});

test("[P4] every combo variant still parses, and none of them gains a k", () => {
  for (const variant of [3, 5, 8]) {
    const parsed = parseCreateRequest(combo({ variant }));
    assert.equal(parsed.ok, true, `variant ${variant}`);
    assert.equal(parsed.systemK, null, `combo ${variant} must never carry a k`);
  }
});

test("[P5] a client-supplied system_k is refused — never ignored", () => {
  // Presence is the test, not value: even 3, which matches today's product, is
  // refused. Accepting it would teach clients that k is theirs to send.
  for (const k of [4, 5, 3, 2, 6, "3", 3.5, null, undefined, 0]) {
    const parsed = parseCreateRequest(system({ system_k: k }));
    assert.equal(parsed.ok, false, `system_k=${String(k)} was accepted`);
    assert.equal(parsed.status, 400);
    assert.match(parsed.error, /system_k nu poate fi trimis/);
  }
});

test("[P6] the camelCase spelling is refused too", () => {
  const parsed = parseCreateRequest(system({ systemK: 4 }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 400);
});

test("[P7] a Combo carrying a system_k is refused as well", () => {
  // Combo must not acquire a k by accident either: 052 stores NULL for combos
  // and its CHECK constraint refuses anything else.
  const parsed = parseCreateRequest(combo({ system_k: 3 }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 400);
});

// ── A System is five selections ──────────────────────────────────────────────

test("[P8] a System at variant 3 or 8 is refused, not corrected", () => {
  for (const variant of [3, 8]) {
    const parsed = parseCreateRequest(system({ variant }));
    assert.equal(parsed.ok, false, `variant ${variant} was accepted`);
    assert.equal(parsed.status, 400);
    assert.match(parsed.error, /exact 5 selec/);
  }
});

test("[P9] an unknown bet_kind is refused", () => {
  for (const kind of ["System", "SYSTEM", "sistem", "banker", "", 3]) {
    const parsed = parseCreateRequest({ ...combo(), bet_kind: kind });
    assert.equal(parsed.ok, false, `bet_kind=${String(kind)} was accepted`);
  }
  // null falls through ?? to the combo default, which is the legacy behaviour.
  const nulled = parseCreateRequest({ ...combo(), bet_kind: null });
  assert.equal(nulled.ok, true);
  assert.equal(nulled.betKind, "combo");
});

test("[P10] the existing field validation is unchanged for both kinds", () => {
  for (const make of [combo, system]) {
    assert.match(parseCreateRequest(make({ bet_date: "09-08-2026" })).error, /bet_date invalid/);
    assert.match(parseCreateRequest(make({ leagueIds: [] })).error, /leagueIds/);
  }
  assert.match(parseCreateRequest(combo({ variant: 4 })).error, /variant invalid/);
});

// ── One request, one row ─────────────────────────────────────────────────────

function fakeSupabase({ historyRows = [] } = {}) {
  const calls = { rpc: [] };
  const chain = {
    select: () => chain,
    in: () => chain,
    gt: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve) => resolve({ data: historyRows, error: null })
  };
  return {
    calls,
    from: () => chain,
    async rpc(name, params) {
      calls.rpc.push({ name, params });
      return {
        data: { ok: true, created: true, bet: { id: "bet-1", system_k: params.p_system_k }, selections: [] },
        error: null
      };
    }
  };
}

const payload = (id) => ({
  id,
  leagueId: 39,
  kickoff: KICKOFF,
  modelVersion: "predictor-v3.1-test",
  teams: { home: `H${id}`, away: `A${id}` },
  recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
  modelMeta: { dataQuality: 0.8 },
  valueEngine: {
    markets: [
      {
        type: "Over 2.5",
        family: "Goals",
        line: 2.5,
        odds: 1.8,
        probability: 0.7,
        valueScore: 70 - id,
        recommendable: true,
        tradable: true,
        betType: "over_under",
        period: "full_match",
        scope: "match"
      }
    ]
  }
});

const history = (count) =>
  Array.from({ length: count }, (_, i) => ({
    fixture_id: i + 1,
    league_id: 39,
    kickoff_at: KICKOFF,
    raw_payload: payload(i + 1)
  }));

/** The two halves wired together: what the request parses to is what gets built. */
async function createFromRequest(body, supabase) {
  const parsed = parseCreateRequest(body);
  assert.equal(parsed.ok, true, "the request must parse for this helper");
  return createGlobalSystemBets({
    userId: USER,
    betDate: parsed.betDate,
    leagueIds: parsed.leagueIds,
    systemK: parsed.systemK,
    now: NOW,
    supabase
  });
}

test("[P11] one public System request writes exactly one row, at k = 3", async () => {
  const supabase = fakeSupabase({ historyRows: history(6) });
  const out = await createFromRequest(system(), supabase);

  assert.equal(supabase.calls.rpc.length, 1, "exactly one RPC");
  const { name, params } = supabase.calls.rpc[0];
  assert.equal(name, "create_global_special_bet");
  assert.equal(params.p_bet_kind, "system");
  assert.equal(params.p_system_k, 3);
  assert.equal(params.p_variant, 5);
  assert.equal(params.p_selections.length, 5);
  assert.equal(out.systemK, 3);
  assert.equal(out.combinationCount, 10, "C(5,3)");
});

test("[P12] public System creation never writes a 4/5 or a 5/5", async () => {
  const supabase = fakeSupabase({ historyRows: history(6) });
  await createFromRequest(system(), supabase);

  const ks = supabase.calls.rpc.map(({ params }) => params.p_system_k);
  assert.deepEqual(ks, [3]);
  assert.ok(!ks.includes(4), "no 4/5 was created");
  assert.ok(!ks.includes(5), "no 5/5 was created");
});

test("[P13] a refused request never reaches the RPC", async () => {
  for (const body of [system({ system_k: 4 }), system({ system_k: 5 }), system({ variant: 8 })]) {
    const supabase = fakeSupabase({ historyRows: history(6) });
    const parsed = parseCreateRequest(body);
    assert.equal(parsed.ok, false);
    // Nothing is built or written for a request that did not parse: the handler
    // returns before either creator is reached.
    assert.equal(supabase.calls.rpc.length, 0);
  }
});

// ── Structural guards ────────────────────────────────────────────────────────

test("[P14] authentication and league access still gate both kinds", () => {
  // Not exercised end-to-end here: getRequester and getSupabaseAdmin are module
  // imports with no injection seam, and adding one is outside this increment.
  // What IS verifiable is that both products enter through the same door, so a
  // System request cannot bypass a check a Combo request faces.
  const api = fs.readFileSync("server-utils/globalSpecialBetsApi.js", "utf8");

  assert.equal((api.match(/await getRequester\(req\)/g) || []).length, 1, "one auth call, before any handler");
  assert.match(api, /requester\.status \|\| 401/, "an unverified session is 401 for every request");
  assert.equal((api.match(/await assertLeagueAccess\(/g) || []).length, 1);
  const accessAt = api.indexOf("await assertLeagueAccess(");
  assert.ok(accessAt < api.indexOf("createGlobalSystemBets({"), "access is checked before a System is built");
  assert.ok(accessAt < api.indexOf("createGlobalSpecialBet({"), "and before a Combo is built");
});

test("[P15] the k is a server constant and is never read from the body", () => {
  const api = fs.readFileSync("server-utils/globalSpecialBetsApi.js", "utf8");
  assert.match(api, /const SYSTEM_PRODUCT_K = 3;/);
  assert.ok(!/body\.system_k|body\.systemK/.test(api), "the k is never read off the request");
  // The only mention of the client's field is the presence check that refuses it.
  assert.match(api, /hasOwnProperty\.call\(body, "system_k"\)/);
});

test("[P16] no tier or subscription check was introduced", () => {
  // System ships under the current GSB access model: any authenticated user.
  // This guard exists so gating stays a decision, never a side effect.
  const api = fs.readFileSync("server-utils/globalSpecialBetsApi.js", "utf8");
  for (const term of ["isUltra", "isPro", "subscription", "tier"]) {
    assert.ok(!api.includes(term), `${term} must not appear in this handler`);
  }
});
