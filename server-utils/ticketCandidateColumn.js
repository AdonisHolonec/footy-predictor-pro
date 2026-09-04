/**
 * `predictions_history.ticket_candidates` — the ticket-generation projection.
 *
 * WHY THIS EXISTS. collectGlobalCandidates() reads `valueEngine.markets`,
 * `modelMeta.dataQuality`, `insufficientData`, `recommended.confidence` and
 * `teams`. Only two of those survive `hydration_payload`: it keeps ONE market
 * (its narrowing rule is "19 scalar fields plus the FIRST entry of `markets`
 * that looks like a cards market") and carries no `modelMeta` at all — so a
 * candidate query fed from it would see one cards market per fixture and then
 * reject every one, because a null dataQuality sends each market to
 * `rejected.missingData`. Measured on 150 production fixtures: 188 markets per
 * fixture, of which hydration keeps 1.
 *
 * Reading `raw_payload` instead is what this column exists to avoid. At ~303 KB
 * a row, an unscoped 500-row candidate query is ~151 MB in one statement — the
 * shape that produced the 57014 statement timeouts.
 *
 * ── THE ONE RULE THAT MOVES TO WRITE TIME ────────────────────────────────────
 * `recommendable === true`, and nothing else. That gate removes 92.7% of markets
 * (23,025 of 24,833 measured) and it is a flag the model already computed — not
 * a comparison against a tunable constant.
 *
 * Every other gate stays at READ time, evaluated by the existing engine over the
 * complete market objects stored here: odds floor, probability floor, model
 * edge, settleable families, quarter lines, tradable, identity, kickoff,
 * insufficientData, dataQuality, ranking, diversification, variants.
 *
 * That distinction is the whole design. A projection storing the winning
 * candidate instead would be 301 B rather than ~10 KB — but raising
 * MIN_SELECTION_ODD to 1.60 made 103 of 115 stored winners wrong, and 2.00 made
 * all 115 wrong, because probability-first ranking systematically picks the
 * shortest-priced leg. Storing BEFORE the tunable gates is what makes a
 * threshold change a config edit rather than a backfill.
 *
 * Verified against the raw path on 150 production fixtures: 665/665 identical
 * candidates, deep-equal tickets, identical pools under six simulated rule
 * changes.
 *
 * IMMUTABLE PRE-KICKOFF, like hydration_payload: derived from the same canonical
 * object in the same statement, and never mentioned by the settlement writers'
 * partial updates, so `INSERT ... ON CONFLICT DO UPDATE` leaves it untouched.
 *
 * Pure: no database, no clock, no I/O.
 */

/** A finite number, or null. Never undefined — this value is persisted. */
function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `{home, away}` when at least one is a usable string, else null. */
function teamsOrNull(teams) {
  if (!teams || typeof teams !== "object" || Array.isArray(teams)) return null;
  const home = typeof teams.home === "string" ? teams.home : null;
  const away = typeof teams.away === "string" ? teams.away : null;
  return home || away ? { home, away } : null;
}

/**
 * The column value for one prediction document.
 *
 * `markets` are copied WHOLE. Narrowing a retained market would move a second
 * decision to write time, which is exactly what this column refuses to do: the
 * read-time gates read `odds`, `probability`, `valueScore`, `line`, `type`,
 * `family`, `settleable` and `tradable`, and a future gate may read a field
 * nothing reads today.
 *
 * @param {object} payload the prediction document about to be persisted
 * @returns {object|null} the column value, or null when there is nothing to store
 */
export function buildTicketCandidates(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const markets = Array.isArray(payload?.valueEngine?.markets) ? payload.valueEngine.markets : [];

  // A document with no markets cannot contribute a candidate under any future
  // rule, so it stores nothing rather than an empty shell. Production has such
  // rows: the oldest fixtures predate valueEngine.markets entirely.
  if (markets.length === 0) return null;

  const retained = markets.filter((m) => m?.recommendable === true);

  return {
    dataQuality: finiteOrNull(payload?.modelMeta?.dataQuality),
    insufficientData: payload?.insufficientData === true,
    confidence: finiteOrNull(payload?.recommended?.confidence),
    teams: teamsOrNull(payload?.teams),
    markets: retained,
    /*
      The pre-projection population, kept because it cannot be recovered later.
      `examined` and `notRecommendable` describe the markets this column
      deliberately discarded, so "645 of 24,833 below the probability floor"
      stays answerable after the gate moved to write time.

      They describe the DISCARDED POPULATION ONLY. They cannot attribute a
      reason to any individual discarded market, and nothing should claim they
      can. Every other rejection counter is still computed at read time from the
      retained markets.
    */
    examined: markets.length,
    notRecommendable: markets.length - retained.length
  };
}

/**
 * The spreadable column patch, shaped like deriveHydrationPayloadColumn so the
 * two sit side by side at the single creation site.
 *
 * @param {object} payload
 * @returns {{ ticket_candidates: object|null }}
 */
export function deriveTicketCandidatesColumn(payload) {
  return { ticket_candidates: buildTicketCandidates(payload) };
}

/**
 * The columns a candidate query needs. Identity is NOT duplicated into the
 * jsonb — fixture_id, league_id, kickoff_at, league_name and model_version are
 * already columns, and storing them twice would create two things to keep in
 * step for no gain.
 */
export const TICKET_CANDIDATE_COLUMNS = Object.freeze([
  "fixture_id",
  "league_id",
  "kickoff_at",
  "league_name",
  "model_version",
  "ticket_candidates"
]);

export const TICKET_CANDIDATE_SELECT = TICKET_CANDIDATE_COLUMNS.join(", ");

/**
 * A projected row -> the shape collectGlobalCandidates() already expects.
 *
 * The engine is not told which source it is reading; it cannot be, or the two
 * paths would be free to diverge. Identity comes from the columns because they
 * are what the query matched on.
 *
 * @param {object} row a row selected with TICKET_CANDIDATE_SELECT
 * @returns {object|null} null when the row has no projection yet (pre-backfill)
 */
export function rehydrateTicketCandidateRow(row) {
  const tc = row?.ticket_candidates;
  if (!tc || typeof tc !== "object" || Array.isArray(tc)) return null;

  return {
    id: row.fixture_id,
    leagueId: row.league_id,
    kickoff: row.kickoff_at,
    league: row.league_name ?? null,
    modelVersion: row.model_version ?? null,
    teams: tc.teams ?? null,
    insufficientData: tc.insufficientData === true,
    recommended: { confidence: tc.confidence ?? null },
    modelMeta: { dataQuality: tc.dataQuality ?? null },
    valueEngine: { markets: Array.isArray(tc.markets) ? tc.markets : [] }
  };
}

export default {
  buildTicketCandidates,
  deriveTicketCandidatesColumn,
  rehydrateTicketCandidateRow,
  TICKET_CANDIDATE_COLUMNS,
  TICKET_CANDIDATE_SELECT
};
