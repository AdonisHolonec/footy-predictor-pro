/**
 * Resolve first-half goals total for a finished (or HT) fixture.
 * Prefer score.halftime; fall back to /fixtures/events when HT score is missing.
 * Uses short cache TTL so live→FT transitions are not stuck on a 24h empty HT snapshot.
 */

const FIXTURE_HT_TTL_SEC = Math.max(60, Math.min(Number(process.env.FIXTURE_HT_CACHE_TTL_SEC || 180), 900));
const EVENTS_HT_TTL_SEC = Math.max(60, Math.min(Number(process.env.FIXTURE_EVENTS_CACHE_TTL_SEC || 300), 900));

/**
 * @param {object|null|undefined} fx API-Football fixture row (response[0])
 * @returns {number|null}
 */
export function parseHalftimeGoalsFromFixture(fx) {
  const htHomeRaw = fx?.score?.halftime?.home;
  const htAwayRaw = fx?.score?.halftime?.away;
  // Never Number(null) — that is 0 and falsely settles Under lines.
  if (htHomeRaw == null || htAwayRaw == null) return null;
  const htHome = Number(htHomeRaw);
  const htAway = Number(htAwayRaw);
  if (!Number.isFinite(htHome) || !Number.isFinite(htAway)) return null;
  return htHome + htAway;
}

/**
 * Count goals with elapsed in the first half (1–45 + 45+injury).
 * @param {any[]} events
 * @returns {number|null} null when events payload is empty/unusable
 */
export function countFirstHalfGoalsFromEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  let goals = 0;
  for (const ev of events) {
    const type = String(ev?.type || "").toLowerCase();
    if (type !== "goal") continue;
    const detail = String(ev?.detail || "").toLowerCase();
    if (detail.includes("missed")) continue;
    const elapsed = Number(ev?.time?.elapsed);
    if (!Number.isFinite(elapsed)) continue;
    // API-Football: FH goals report elapsed 1..45 (injury as elapsed=45 + extra).
    if (elapsed <= 45) goals += 1;
  }
  return goals;
}

/**
 * @param {number|string} fixtureId
 * @param {(path: string, params: object, ttl: number) => Promise<{ok: boolean, data?: any}>} getWithCache
 * @returns {Promise<{ firstHalfGoals: number|null, source: string|null }>}
 */
export async function resolveFixtureFirstHalfGoals(fixtureId, getWithCache) {
  const id = Number(fixtureId);
  if (!Number.isFinite(id) || id <= 0) {
    return { firstHalfGoals: null, source: null };
  }

  try {
    const fxReq = await getWithCache("/fixtures", { ids: String(id) }, FIXTURE_HT_TTL_SEC);
    if (fxReq.ok) {
      const fromScore = parseHalftimeGoalsFromFixture(fxReq.data?.response?.[0]);
      if (fromScore != null) {
        return { firstHalfGoals: fromScore, source: "score.halftime" };
      }
    }
  } catch {
    // fall through to events
  }

  try {
    const evReq = await getWithCache("/fixtures/events", { fixture: id }, EVENTS_HT_TTL_SEC);
    if (evReq.ok) {
      const fromEvents = countFirstHalfGoalsFromEvents(evReq.data?.response || []);
      if (fromEvents != null) {
        return { firstHalfGoals: fromEvents, source: "events" };
      }
    }
  } catch {
    // ignore
  }

  return { firstHalfGoals: null, source: null };
}
