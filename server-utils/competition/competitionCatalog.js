/**
 * Competition classifier — the ONLY place Predictor V3 knows what a national-team
 * competition is.
 *
 * Why this exists. The 2026-09-22 national-team compatibility audit found that V3 has
 * no entity concept at all: a UEFA Nations League fixture is processed like a club
 * fixture, its "team statistics" are silently sourced from the World Cup / Euro via the
 * domestic-league fallback, and every league-scoped asset (profile, rolling, Elo,
 * calibration, stacker) resolves to a default or a pooled club value. Until a
 * national-team adapter exists, such fixtures must not be predicted or persisted.
 *
 * Classification is by STABLE PROVIDER LEAGUE ID against an explicit catalog. It is
 * deliberately NOT inferred from `league.type === "Cup"` or `country === "World"`:
 * the Champions League (id 2), Europa League (3) and Conference League (848) carry the
 * same two markers and are club competitions the product supports. Provider hints are
 * carried on the result for observability only and never decide anything.
 *
 * Every catalog id below was observed in a live provider response during the audit
 * (`/leagues?id=5`, `/leagues?team=5|774|1113`), so none is a guess. Add an entry only
 * with the same kind of evidence. `supported` is per entry so a future adapter can
 * flip one competition at a time without touching the gate.
 *
 * Env:
 *   PREDICT_NATIONAL_COMPETITION_GATE              master switch (default "1")
 *   PREDICT_NATIONAL_COMPETITION_EXTRA_LEAGUE_IDS  comma-separated provider ids to gate
 *                                                  without a deploy (each is treated as
 *                                                  an unsupported national competition)
 */

export const COMPETITION_ENTITY = Object.freeze({
  NATIONAL_TEAM: "NATIONAL_TEAM",
  CLUB: "CLUB"
});

export const UNSUPPORTED_NATIONAL_COMPETITION = "UNSUPPORTED_NATIONAL_COMPETITION";

/** Method string the gate stamps on the insufficient row (mirrors the existing snake_case codes). */
export const NATIONAL_GATE_METHOD = "unsupported_national_competition";

export const NATIONAL_COMPETITION_CATALOG = Object.freeze({
  "5": Object.freeze({
    name: "UEFA Nations League",
    competitionType: "NATIONS_LEAGUE",
    supported: false,
    evidence:
      "provider /leagues?id=5 (2026-09-22): type Cup, country World; season 2026 coverage has no fixture statistics, injuries or players"
  }),
  "1": Object.freeze({
    name: "World Cup",
    competitionType: "WORLD_CUP",
    supported: false,
    evidence: "provider /leagues?team=5&season=2026 (2026-09-22)"
  }),
  "4": Object.freeze({
    name: "Euro Championship",
    competitionType: "EURO_CHAMPIONSHIP",
    supported: false,
    evidence: "provider /leagues?team=774&season=2024 (2026-09-22)"
  }),
  "10": Object.freeze({
    name: "Friendlies",
    competitionType: "INTERNATIONAL_FRIENDLIES",
    supported: false,
    evidence: "provider /leagues?team=774&season=2026 (2026-09-22): senior national-team friendlies"
  }),
  "32": Object.freeze({
    name: "World Cup - Qualification Europe",
    competitionType: "WORLD_CUP_QUALIFICATION",
    supported: false,
    evidence: "provider /leagues?team=774&season=2024 (2026-09-22)"
  })
});

function envRaw(name) {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

export function isNationalCompetitionGateEnabled() {
  const raw = envRaw("PREDICT_NATIONAL_COMPETITION_GATE");
  if (raw === undefined || raw === "") return true;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * Extra ids gated at runtime. Empty segments and anything that is not a positive
 * integer are dropped, for the reason parseCronLeagueIds documents: `Number("")` is 0,
 * which would otherwise gate a league that does not exist.
 */
export function parseExtraGatedLeagueIds(raw = envRaw("PREDICT_NATIONAL_COMPETITION_EXTRA_LEAGUE_IDS")) {
  return String(raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map(Number)
    .filter((v) => Number.isInteger(v) && v > 0);
}

function catalogEntry(leagueId) {
  const fromCatalog = NATIONAL_COMPETITION_CATALOG[String(leagueId)];
  if (fromCatalog) return { ...fromCatalog, source: "catalog" };
  if (parseExtraGatedLeagueIds().includes(leagueId)) {
    return {
      name: null,
      competitionType: "NATIONAL_COMPETITION",
      supported: false,
      evidence: "PREDICT_NATIONAL_COMPETITION_EXTRA_LEAGUE_IDS",
      source: "env"
    };
  }
  return null;
}

/**
 * @typedef {object} CompetitionClassification
 * @property {number|null} leagueId
 * @property {"NATIONAL_TEAM"|"CLUB"} entityType
 * @property {string} competitionType
 * @property {boolean} supported
 * @property {string|null} reason   UNSUPPORTED_NATIONAL_COMPETITION when supported is false
 * @property {"catalog"|"env"|"default"} source
 * @property {{ type: string|null, country: string|null, name: string|null }} provider  hints only
 */

/**
 * Classify the competition of a fixture from its stable provider league id.
 * Unknown ids are CLUB and supported: the gate must never widen beyond the catalog.
 *
 * @param {{ leagueId?: number|string|null, leagueName?: string|null, leagueType?: string|null, country?: string|null }} p
 * @returns {CompetitionClassification}
 */
export function classifyCompetition({ leagueId, leagueName = null, leagueType = null, country = null } = {}) {
  const id = Number(leagueId);
  const validId = Number.isInteger(id) && id > 0 ? id : null;
  const provider = {
    type: leagueType != null ? String(leagueType) : null,
    country: country != null ? String(country) : null,
    name: leagueName != null ? String(leagueName) : null
  };
  const entry = validId != null ? catalogEntry(validId) : null;
  if (entry) {
    const supported = entry.supported === true;
    return {
      leagueId: validId,
      entityType: COMPETITION_ENTITY.NATIONAL_TEAM,
      competitionType: entry.competitionType,
      supported,
      reason: supported ? null : UNSUPPORTED_NATIONAL_COMPETITION,
      source: entry.source,
      provider
    };
  }
  return {
    leagueId: validId,
    entityType: COMPETITION_ENTITY.CLUB,
    competitionType: "CLUB_COMPETITION",
    supported: true,
    reason: null,
    source: "default",
    provider
  };
}

/** Classification from a raw API-Football fixture; `fallbackLeagueId` covers a fixture without a league block. */
export function classifyFixtureCompetition(fx, fallbackLeagueId = null) {
  const league = fx?.league || {};
  return classifyCompetition({
    leagueId: league.id ?? fallbackLeagueId,
    leagueName: league.name ?? null,
    leagueType: league.type ?? null,
    country: league.country ?? null
  });
}

/**
 * The gate decision: unsupported national competition AND the gate is switched on.
 * A disabled gate still classifies, so observability keeps working while the gate is off.
 */
export function isGatedCompetition(classification) {
  return isNationalCompetitionGateEnabled() && classification?.supported === false;
}

export default {
  COMPETITION_ENTITY,
  UNSUPPORTED_NATIONAL_COMPETITION,
  NATIONAL_GATE_METHOD,
  NATIONAL_COMPETITION_CATALOG,
  classifyCompetition,
  classifyFixtureCompetition,
  isGatedCompetition,
  isNationalCompetitionGateEnabled,
  parseExtraGatedLeagueIds
};
