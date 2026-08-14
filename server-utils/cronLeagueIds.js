import { TOP_LEAGUE_IDS } from "./modelConstants.js";

/**
 * Which competitions a cron run processes, and IN WHICH ORDER.
 *
 * This is a PROCESSING ORDER, not a definition of what the product supports. The canonical
 * list lives in leagueProfiles.config.json and reaches code as TOP_LEAGUE_IDS; nothing here
 * adds to it, removes from it, or second-guesses it. An operator reorders the refresh via
 * CRON_WARM_PREDICT_LEAGUE_IDS when the calendar makes one competition more urgent than
 * another — in August the domestic leagues are mid-transition and need rolling rows, while
 * the European draws are still qualifiers.
 *
 * Order matters because the refresh budget is spent league by league in list order and can
 * run out before the tail is reached. A league that never gets processed keeps whatever
 * rolling rows it already had — so list order decides where a limited budget lands.
 *
 * WHY THIS EXISTS AS ITS OWN FUNCTION. The inline version it replaces silently produced a
 * league id of 0 from an empty string, because `Number("") === 0` and 0 is finite. An unset
 * variable therefore parsed to `[0]` — a one-element list, so `src.length` was truthy and
 * the fallback to TOP_LEAGUE_IDS never fired. The cron then iterated a single competition
 * that does not exist, fetched nothing, and reported success. The same hole swallowed a
 * trailing comma and any empty slot between two commas. Both are ordinary things to type
 * into an environment variable.
 *
 * So empty segments are dropped BEFORE any numeric coercion, and only positive integers
 * survive: a league id is a positive integer, and `-5`, `0` and `39.7` are typos, not
 * competitions. When nothing valid remains — unset, blank, or entirely malformed — the
 * canonical list is returned in full. Narrowing the cron is something an operator does on
 * purpose by naming leagues, never something a typo does by accident.
 *
 * Ids that are well-formed but unknown to the config pass through unchanged, exactly as
 * before. Validating them here would be a second opinion about which competitions exist,
 * and there is only one source of truth for that.
 *
 * @param {string|null|undefined} raw comma-separated league ids, e.g. "39,140,135"
 * @returns {number[]} ordered, de-duplicated league ids; TOP_LEAGUE_IDS when none are valid
 */
export function parseCronLeagueIds(raw) {
  const parsed = String(raw ?? "")
    .split(",")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0)
    .map(Number)
    .filter((v) => Number.isInteger(v) && v > 0);
  // A Set preserves insertion order, so the operator's order survives de-duplication.
  return parsed.length ? Array.from(new Set(parsed)) : TOP_LEAGUE_IDS.slice();
}

export default { parseCronLeagueIds };
