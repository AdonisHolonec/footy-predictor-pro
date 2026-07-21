/**
 * Ultra daily match quota: unique fixture ids only (re-runs are free).
 */

/**
 * @param {object} opts
 * @param {Array<string|number>} [opts.leagueIds]
 * @param {Array<object>} [opts.allFixtures]
 * @param {Set<string>|Iterable<string>} [opts.knownIds]
 * @param {number} [opts.dailyLimit]
 * @param {number} [opts.requestLimit]
 */
export function pickUltraUniqueAllowedFixtures({
  leagueIds = [],
  allFixtures = [],
  knownIds = new Set(),
  dailyLimit = 50,
  requestLimit = 15
} = {}) {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
  let remainingNew = Math.max(0, Math.floor(Number(dailyLimit) || 0) - known.size);
  const reqCap = Math.max(0, Math.floor(Number(requestLimit) || 0));
  const allowed = new Set();
  let selected = 0;

  for (const lId of leagueIds) {
    if (selected >= reqCap) break;
    const leagueFixtures = allFixtures.filter((f) => String(f?.league?.id) === String(lId));
    for (const fx of leagueFixtures) {
      if (selected >= reqCap) break;
      const rawId = fx?.fixture?.id;
      if (rawId == null || rawId === "") continue;
      const sid = String(rawId);
      if (known.has(sid) || allowed.has(sid)) {
        allowed.add(sid);
        selected += 1;
        continue;
      }
      if (remainingNew > 0) {
        allowed.add(sid);
        remainingNew -= 1;
        selected += 1;
      }
    }
  }

  return { allowed, remainingNew, knownCount: known.size };
}
