/**
 * An in-memory stand-in for the @vercel/kv verbs the live capture layer uses.
 *
 * It RECORDS every command, because the claims under test are about commands: a
 * writer whose fake silently lacks a verb would pass while never writing. Assertions
 * are made on `commands`, never on the absence of an error.
 *
 * Values are kept as objects, the way @upstash/redis hands them back with automatic
 * deserialisation on.
 */
export function createFakeKv({ execError = null, execNeverResolves = false } = {}) {
  const hashes = new Map();
  const sets = new Map();
  const ttl = new Map();
  const commands = [];
  const state = { pipelines: 0, execError, execNeverResolves };

  function apply([op, key, a, b]) {
    if (op === "hsetnx") {
      const hash = hashes.get(key) || new Map();
      hashes.set(key, hash);
      if (hash.has(a)) return 0;
      hash.set(a, b);
      return 1;
    }
    if (op === "hincrby") {
      const hash = hashes.get(key) || new Map();
      hashes.set(key, hash);
      const next = Number(hash.get(a) || 0) + Number(b);
      hash.set(a, next);
      return next;
    }
    if (op === "sadd") {
      const set = sets.get(key) || new Set();
      sets.set(key, set);
      const had = set.has(a);
      set.add(a);
      return had ? 0 : 1;
    }
    if (op === "expire") {
      ttl.set(key, a);
      return 1;
    }
    throw new Error(`fakeKv: unsupported command ${op}`);
  }

  return {
    hashes,
    sets,
    ttl,
    commands,
    state,
    pipeline() {
      state.pipelines += 1;
      const queue = [];
      const p = {
        hsetnx(key, field, value) {
          queue.push(["hsetnx", key, field, value]);
          return p;
        },
        hincrby(key, field, by) {
          queue.push(["hincrby", key, field, by]);
          return p;
        },
        sadd(key, member) {
          queue.push(["sadd", key, member]);
          return p;
        },
        expire(key, seconds) {
          queue.push(["expire", key, seconds]);
          return p;
        },
        async exec() {
          if (state.execNeverResolves) return new Promise(() => {});
          if (state.execError) throw state.execError;
          return queue.map((cmd) => {
            commands.push(cmd);
            return apply(cmd);
          });
        }
      };
      return p;
    },
    async smembers(key) {
      commands.push(["smembers", key]);
      return [...(sets.get(key) || [])];
    },
    async hgetall(key) {
      commands.push(["hgetall", key]);
      const hash = hashes.get(key);
      return hash ? Object.fromEntries(hash) : null;
    },
    fieldsOf(key) {
      return [...(hashes.get(key)?.keys() || [])];
    }
  };
}

const STAT_TYPES = {
  possession: "Ball Possession",
  shotsTotal: "Total Shots",
  shotsOnTarget: "Shots on Goal",
  corners: "Corner Kicks",
  yellowCards: "Yellow Cards",
  redCards: "Red Cards",
  shotsInsideBox: "Shots insidebox",
  shotsOutsideBox: "Shots outsidebox",
  expectedGoals: "expected_goals"
};

/** A provider `/fixtures/statistics` team block. A key set to `undefined` omits the row entirely. */
export function statsBlock(teamId, values = {}) {
  const statistics = [];
  for (const [name, type] of Object.entries(STAT_TYPES)) {
    if (!(name in values) || values[name] === undefined) continue;
    statistics.push({ type, value: values[name] });
  }
  return { team: { id: teamId }, statistics };
}

export const HOME = 501;
export const AWAY = 502;

/** One row exactly as handleLive hands it to captureLivePoll. */
export function liveRow(over = {}) {
  return {
    fixtureId: 9001,
    kickoffAt: "2026-09-21T16:00:00+00:00",
    leagueId: 39,
    season: 2026,
    periodFirstStart: 1790006400,
    periodSecondStart: null,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    status: "1H",
    elapsed: 16,
    extra: null,
    score: { home: 0, away: 0 },
    statsResult: {
      ok: true,
      fromCache: false,
      reason: null,
      response: [
        statsBlock(HOME, {
          possession: "55%",
          shotsTotal: 4,
          shotsOnTarget: 2,
          corners: 1,
          yellowCards: 0,
          redCards: null,
          shotsInsideBox: 3,
          shotsOutsideBox: 1,
          expectedGoals: "0.41"
        }),
        statsBlock(AWAY, {
          possession: "45%",
          shotsTotal: 2,
          shotsOnTarget: 0,
          corners: 0,
          yellowCards: 1,
          redCards: null,
          shotsInsideBox: 1,
          shotsOutsideBox: 1,
          expectedGoals: "0.12"
        })
      ]
    },
    eventsResult: {
      ok: true,
      fromCache: false,
      reason: null,
      response: [
        {
          time: { elapsed: 12, extra: null },
          team: { id: AWAY },
          player: { id: 77, name: "A. Player" },
          assist: { id: null, name: null },
          type: "Card",
          detail: "Yellow Card",
          comments: "Foul"
        }
      ]
    },
    ...over
  };
}
