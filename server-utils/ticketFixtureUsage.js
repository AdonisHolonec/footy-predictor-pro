const BETS_TABLE = "special_bets";
const SELECTIONS_TABLE = "special_bet_selections";

/**
 * Which fixtures the tickets already built in this scope have used.
 *
 * ── WHY THIS READS THE DATABASE ──────────────────────────────────────────────
 * The obvious design is an in-memory set carried through one generation call,
 * and it cannot work here. A 3, a 5 and an 8 are THREE SEPARATE HTTP REQUESTS —
 * both callers pass a single-element `variants` array, and an admin or a user
 * presses Generate once per variant, possibly days apart. Inside any one call
 * there is no previous variant to remember, so an operation-scoped set would be
 * empty every time and the rule would never fire.
 *
 * The exclusion therefore has to come from what was actually persisted. That is
 * a READ, not new state: no column, no table, no flag, no migration. The set is
 * derived from the selections the tickets already carry, so it cannot drift from
 * them and there is nothing to keep in step.
 *
 * ── SCOPE IS IDENTITY, NOT A FILTER ──────────────────────────────────────────
 * A GLOBAL ticket belongs to the product and a USER ticket to one person, so
 * "already used" means different things and the two must never see each other:
 *
 *   GLOBAL   bet_type = 'GLOBAL' and bet_date = D
 *   USER     user_id  = U        and bet_type = 'USER' and bet_date = D
 *
 * One user's fixtures can never exclude another's, and the product's ticket can
 * never be narrowed by anybody's personal one. That isolation is why the scope
 * is a required argument rather than something inferred from ambient state.
 *
 * `bet_date` bounds it to the day being generated — the same day the uniqueness
 * key covers, so yesterday's tickets do not constrain today's.
 *
 * ── TWO QUERIES, NEVER N+1 ───────────────────────────────────────────────────
 * One read for the day's ticket ids, one for every selection of those ids
 * through a single `.in()`. Not one query per ticket. Both project a single
 * column, so the wire cost is a list of integers.
 */

/**
 * @param {object} supabase a service-role client
 * @param {{ betDate: string, userId?: string|null }} scope
 *        `userId` omitted or null means the GLOBAL scope; a string means that
 *        one user's own tickets.
 * @returns {Promise<Set<number>>} fixture ids already used in the scope
 */
export async function loadUsedFixtureIds(supabase, { betDate, userId = null } = {}) {
  if (!supabase || !betDate) return new Set();

  let betsQuery = supabase.from(BETS_TABLE).select("id").eq("bet_date", betDate);
  betsQuery = userId
    ? betsQuery.eq("user_id", userId).eq("bet_type", "USER")
    : betsQuery.eq("bet_type", "GLOBAL");

  const { data: bets, error } = await betsQuery;
  if (error) throw error;
  if (!bets?.length) return new Set();

  const { data: selections, error: selectionError } = await supabase
    .from(SELECTIONS_TABLE)
    .select("fixture_id")
    .in(
      "special_bet_id",
      bets.map((bet) => bet.id)
    );
  if (selectionError) throw selectionError;

  const used = new Set();
  for (const selection of selections || []) {
    /*
      CANONICAL FIXTURE IDENTITY. One fixture is one match, whatever market was
      taken on it: three markets on fixture 123 consume one slot, not three.
      Never a team name, never a display label, never a kickoff string — those
      are presentation values and two of them can collide.
    */
    const fixtureId = Number(selection?.fixture_id);
    if (Number.isFinite(fixtureId)) used.add(fixtureId);
  }
  return used;
}

export default { loadUsedFixtureIds };
