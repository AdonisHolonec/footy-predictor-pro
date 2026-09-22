/**
 * Live Predictor Lab — Phase 1: the snapshot itself.
 *
 * PURE. No KV, no network, no clock: everything here takes plain data and returns
 * plain data, so the rules that decide what a snapshot IS and which slot it lands in
 * can be tested without faking anything.
 *
 * CAPTURE ONLY. Nothing in this module computes a probability, a recommendation, a
 * confidence or any other model output. It normalises what the provider already
 * sent on the existing live poll and nothing else.
 *
 * TWO CLOCKS, KEPT APART.
 *   capturedAt / capturedAtMs   when OUR system recorded the observation
 *   elapsedMinute / extraMinute, event minutes, providerPeriod*Start
 *                               what the PROVIDER says about the match clock
 * Capture time is never inferred from kickoff, an event minute or a cron slot.
 *
 * NULL STAYS NULL. A statistic the provider did not send is `null`, never 0. This
 * codebase has already paid for that mistake (readStat in teamMarketRolling.js once
 * turned a missing total into a real zero and poisoned the rolling lambdas), and a
 * live model trained on "0 shots" that really meant "unknown" would learn the wrong
 * thing.
 *
 * That is why this module reads the RAW provider payloads rather than the values the
 * live widget already normalised: parseMomentumStatValue in api/fixtures.js turns ""
 * into 0 and extractLiveEvents turns `time.extra: null` into 0 — harmless for a
 * widget, corrosive for a dataset that must later tell 45' from 45+0'.
 *
 * DELIBERATELY NOT IMPORTED: extractFixtureMarketStats (teamMarketRolling.js) has the
 * same null semantics, but it lives on the Predictor V3 path (predictHelpers imports
 * it, and it imports math.js → PredictionEngine). The capture layer must not depend
 * on that module, nor it on us, so the reader is restated here and
 * tests/liveCaptureSnapshot.test.js pins the two to identical results on one payload.
 */

export const LIVE_CAPTURE_SCHEMA_VERSION = 1;

/** In play with the match clock running — these earn a time slot. */
export const CLOCK_RUNNING_STATUSES = Object.freeze(["1H", "2H", "ET", "LIVE", "VAR", "1ST", "2ND"]);
/** In play with the clock frozen or meaningless — one marker each, never one per poll. */
export const IN_PLAY_MARKER_STATUSES = Object.freeze(["HT", "BT", "P", "INT", "SUSP"]);
/** The match is over and has a result. `T:<status>` is the FT observation. */
export const FINAL_STATUSES = Object.freeze(["FT", "AET", "PEN"]);
/** The match ended without being played out. Kept: it explains why a trajectory stops. */
export const TERMINAL_NON_FINAL_STATUSES = Object.freeze(["CANC", "PST", "ABD", "AWD", "WO"]);

const CLOCK_RUNNING = new Set(CLOCK_RUNNING_STATUSES);
const IN_PLAY_MARKERS = new Set(IN_PLAY_MARKER_STATUSES);
const FINAL = new Set(FINAL_STATUSES);
const TERMINAL_NON_FINAL = new Set(TERMINAL_NON_FINAL_STATUSES);

/**
 * The match-minute range each period can occupy in the slot table. Minutes outside
 * a range collapse into its last slot, so the table has a FIXED size whatever the
 * provider sends: 60 + 60 + 40 minutes. That fixed size is what makes the per-fixture
 * storage cap structural rather than something a counter has to enforce.
 */
export const PERIOD_MINUTE_RANGE = Object.freeze({
  1: Object.freeze({ from: 0, to: 59 }),
  2: Object.freeze({ from: 45, to: 104 }),
  3: Object.freeze({ from: 90, to: 129 })
});

/** Goals + red cards, the rare state changes worth capturing the moment they are seen. */
export const MAX_CHANGE_LEVEL = 30;
/**
 * An events state is keyed by its length, so this also bounds the number of event
 * fields — and, because every `E:n` field holds the whole list as it stood, the bytes
 * a fixture can accumulate grow with the SQUARE of this number. 40 covers a real match
 * (goals + cards + substitutions + VAR rarely pass 30); the cap was 80 before the
 * review measured 636 KB of cumulative event states for one pathological fixture.
 */
export const MAX_EVENTS = 40;

export const DEFAULT_MINUTE_STEP = 3;
export const MIN_MINUTE_STEP = 1;
export const MAX_MINUTE_STEP = 5;

/** The research windows. FT is not a minute — it is the terminal marker. */
export const COVERAGE_WINDOWS = Object.freeze([15, 30, 45, 60, 75]);
/**
 * A fresh provider read happens at most once per 75 s cache window, and a poll can
 * land just after one — so two consecutive fresh observations are up to ~2.5 match
 * minutes apart under continuous viewing. ±2 (a 5-minute span) is the narrowest
 * tolerance that continuous viewing is guaranteed to hit.
 */
export const WINDOW_TOLERANCE_MINUTES = 2;

/**
 * Snapshot field → provider statistic type. The first six are the Phase 1 brief; the
 * last three are already relied on elsewhere in this codebase (the rolling xG model),
 * which is the evidence that the provider really sends them.
 */
export const CAPTURED_STATS = Object.freeze([
  ["possession", "Ball Possession"],
  ["shotsTotal", "Total Shots"],
  ["shotsOnTarget", "Shots on Goal"],
  ["corners", "Corner Kicks"],
  ["yellowCards", "Yellow Cards"],
  ["redCards", "Red Cards"],
  ["shotsInsideBox", "Shots insidebox"],
  ["shotsOutsideBox", "Shots outsidebox"],
  ["expectedGoals", "expected_goals"]
]);

export function clampMinuteStep(raw) {
  const n = Math.round(Number(raw));
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n)) return DEFAULT_MINUTE_STEP;
  return Math.max(MIN_MINUTE_STEP, Math.min(n, MAX_MINUTE_STEP));
}

/**
 * The most fields one fixture hash can ever hold, by construction: every time slot,
 * every change level, every marker and every events state — there is no fifth kind.
 */
export function maxFieldsPerFixture(minuteStep = DEFAULT_MINUTE_STEP) {
  const step = clampMinuteStep(minuteStep);
  const timeSlots = Object.values(PERIOD_MINUTE_RANGE).reduce(
    (sum, range) => sum + Math.ceil((range.to - range.from + 1) / step),
    0
  );
  const changeSlots = MAX_CHANGE_LEVEL; // C:1 … C:30 (level 0 is just the first time slot)
  const markers = IN_PLAY_MARKER_STATUSES.length + FINAL_STATUSES.length + TERMINAL_NON_FINAL_STATUSES.length;
  const eventStates = MAX_EVENTS; // E:1 … E:80 (an empty list is not a state worth a field)
  return timeSlots + changeSlots + markers + eventStates;
}

/**
 * The null-first guard. `Number(null)`, `Number("")`, `Number(" ")` and
 * `Number(false)` are all a finite 0, so "is it finite?" alone can never be the test.
 */
function isAbsent(value) {
  return value === null || value === undefined || typeof value === "boolean" ||
    (typeof value === "string" && value.replace(/%/g, "").trim() === "");
}

/** A finite number ≥ 0, or null. A real 0 (number or "0") is a real zero and is kept. */
function nullableNumber(value) {
  if (isAbsent(value)) return null;
  const n = Number(typeof value === "string" ? value.replace(/%/g, "").trim() : value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function nullableCount(value) {
  const n = nullableNumber(value);
  return n === null ? null : Math.round(n);
}

function nullableId(value) {
  if (isAbsent(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nullableText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoOrNull(value) {
  if (isAbsent(value)) return null;
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The provider sends period starts as epoch SECONDS. */
function isoFromEpochSeconds(value) {
  const n = nullableNumber(value);
  return n === null || n === 0 ? null : new Date(n * 1000).toISOString();
}

/** One statistic out of one team's `statistics` array — missing row and missing value are both null. */
function readProviderStat(statistics, type) {
  if (!Array.isArray(statistics)) return null;
  const wanted = type.toLowerCase();
  const row = statistics.find((s) => String(s?.type ?? "").toLowerCase() === wanted);
  return row ? nullableNumber(row.value) : null;
}

function readTeamBlock(block) {
  const out = {};
  for (const [name, type] of CAPTURED_STATS) out[name] = readProviderStat(block?.statistics, type);
  return out;
}

const hasAnyValue = (stats) => Boolean(stats) && Object.values(stats).some((v) => v !== null);

/**
 * Per-side statistics from a raw /fixtures/statistics `response`.
 *
 * `status` says what the payload really was, because the live widget collapses every
 * one of these into a bare `null`:
 *   ok        at least one side carries at least one real value
 *   all_null  structurally complete blocks whose values are all null (uncovered leagues)
 *   one_sided fewer than two team blocks
 *   empty     no blocks at all
 *
 * Sides are resolved by team id. The provider normally returns [home, away], and the
 * live widget falls back to that order — so does this, but it SAYS so, because a
 * silent positional swap mid-match would read as a momentum reversal.
 */
export function extractCaptureStats(response, homeTeamId, awayTeamId) {
  const blocks = Array.isArray(response) ? response : [];
  if (blocks.length === 0) return { status: "empty", sideResolution: null, home: null, away: null };

  const homeId = nullableId(homeTeamId);
  const awayId = nullableId(awayTeamId);
  const byTeamId = new Map();
  for (const block of blocks) {
    const teamId = nullableId(block?.team?.id);
    if (teamId !== null && !byTeamId.has(teamId)) byTeamId.set(teamId, block);
  }

  let sideResolution = "teamId";
  let homeBlock = homeId !== null ? byTeamId.get(homeId) : undefined;
  let awayBlock = awayId !== null ? byTeamId.get(awayId) : undefined;
  if (!homeBlock || !awayBlock) {
    if (blocks.length < 2) {
      const only = homeBlock || awayBlock || null;
      return {
        status: "one_sided",
        sideResolution: only ? "teamId" : null,
        home: homeBlock ? readTeamBlock(homeBlock) : null,
        away: awayBlock ? readTeamBlock(awayBlock) : null
      };
    }
    sideResolution = "positional";
    homeBlock = homeBlock || blocks[0];
    awayBlock = awayBlock || blocks[1];
  }

  const home = readTeamBlock(homeBlock);
  const away = readTeamBlock(awayBlock);
  return { status: hasAnyValue(home) || hasAnyValue(away) ? "ok" : "all_null", sideResolution, home, away };
}

/**
 * A compact, lossless-enough event list from a raw /fixtures/events `response`.
 *
 * Provider minute and extra are kept exactly as sent (`extra: null` stays null). The
 * raw `type` and `detail` are kept too, so a second-yellow dismissal is never at the
 * mercy of how a widget chose to classify it. An event whose team matches neither
 * side keeps `side: null` and its raw teamId — never guessed, never dropped.
 *
 * IDS, NOT NAMES. Player and assist are kept as ids only; the display names and the
 * free-text `comments` are dropped. They are the bulk of an event's bytes, they are
 * reproducible from the ids, and nothing a live model needs (goals, cards, subs, VAR
 * verdicts, the match-state transitions) lives anywhere but in `type` + `detail`.
 */
export function extractCaptureEvents(response, homeTeamId, awayTeamId) {
  if (!Array.isArray(response)) return [];
  const homeId = nullableId(homeTeamId);
  const awayId = nullableId(awayTeamId);
  const out = [];
  for (const ev of response) {
    const type = nullableText(ev?.type);
    const minute = nullableCount(ev?.time?.elapsed);
    if (!type || minute === null) continue;
    const teamId = nullableId(ev?.team?.id);
    const side = teamId !== null && teamId === homeId ? "home" : teamId !== null && teamId === awayId ? "away" : null;
    out.push({
      minute,
      extra: nullableCount(ev?.time?.extra),
      side,
      teamId,
      type,
      detail: nullableText(ev?.detail),
      playerId: nullableId(ev?.player?.id),
      assistId: nullableId(ev?.assist?.id)
    });
    if (out.length >= MAX_EVENTS) break;
  }
  return out;
}

/** What a getWithCache result says about a component, without its payload. */
function describeSource(result) {
  if (!result || typeof result !== "object") return { source: "not_fetched", reason: null };
  if (result.ok !== true) return { source: "unavailable", reason: nullableText(result.reason) || "request_failed" };
  return { source: result.fromCache === true ? "cache" : "fresh", reason: null };
}

/**
 * Which period a clock-running status belongs to. LIVE and VAR do not say, so the
 * provider minute decides — the same boundaries the periods themselves use.
 */
function resolvePeriod(status, elapsed) {
  if (status === "1H" || status === "1ST") return 1;
  if (status === "2H" || status === "2ND") return 2;
  if (status === "ET") return 3;
  if (elapsed <= 45) return 1;
  if (elapsed <= 90) return 2;
  return 3;
}

/**
 * Goals plus red cards. Unknown red cards count as 0 HERE ONLY — this is a slot
 * name, not data: the snapshot stored under it keeps its nulls.
 */
function changeLevel(snapshot) {
  if (snapshot?.homeScore === null || snapshot?.homeScore === undefined) return null;
  if (snapshot?.awayScore === null || snapshot?.awayScore === undefined) return null;
  return snapshot.homeScore + snapshot.awayScore + (snapshot.redCardsHome ?? 0) + (snapshot.redCardsAway ?? 0);
}

/**
 * The deterministic capture rule. One observation maps to AT MOST these fields:
 *
 *   time    `M:<period>:<bucketStartMinute>`  elapsed-time progression — one per
 *                                             `minuteStep` match minutes, so a poll
 *                                             that fires twice in one bucket is a
 *                                             duplicate, and HT never repeats
 *   change  `C:<goals+reds>`                  a meaningful state change, captured the
 *                                             first time that level is seen even if
 *                                             its time bucket is already taken
 *   marker  `S:<status>` / `T:<status>`       frozen-clock and terminal states, once
 *
 * A score that did not change never suppresses anything: the time slot still fires,
 * and shots / corners / cards that moved are carried by it. The first observation of
 * a fixture is simply whichever of these lands first.
 *
 * Statelessness is the point. Nothing has to be read to decide whether a snapshot is
 * new — the field name decides, and the store writes it with "only if absent".
 */
export function resolveSnapshotSlots(snapshot, minuteStep = DEFAULT_MINUTE_STEP) {
  const status = String(snapshot?.status || "").toUpperCase();
  if (FINAL.has(status) || TERMINAL_NON_FINAL.has(status)) {
    return { ok: true, kind: "terminal", slots: [`T:${status}`], matchMinute: null, period: null };
  }
  if (IN_PLAY_MARKERS.has(status)) {
    return { ok: true, kind: "marker", slots: [`S:${status}`], matchMinute: null, period: null };
  }
  if (!CLOCK_RUNNING.has(status)) return { ok: false, reason: "not_live" };

  const elapsed = snapshot?.elapsedMinute;
  if (elapsed === null || elapsed === undefined) return { ok: false, reason: "no_elapsed" };

  const step = clampMinuteStep(minuteStep);
  const period = resolvePeriod(status, elapsed);
  const range = PERIOD_MINUTE_RANGE[period];
  const matchMinute = elapsed + (snapshot?.extraMinute ?? 0);
  const clamped = Math.max(range.from, Math.min(matchMinute, range.to));
  const bucketStart = range.from + Math.floor((clamped - range.from) / step) * step;
  const slots = [`M:${period}:${bucketStart}`];

  const level = changeLevel(snapshot);
  if (level !== null && level >= 1) slots.push(`C:${Math.min(level, MAX_CHANGE_LEVEL)}`);

  return { ok: true, kind: "time", slots, matchMinute, period };
}

/** The research window a match minute falls in, or null. Never manufactures a hit. */
export function coverageWindowForMinute(matchMinute) {
  if (matchMinute === null || matchMinute === undefined || !Number.isFinite(Number(matchMinute))) return null;
  const minute = Number(matchMinute);
  for (const window of COVERAGE_WINDOWS) {
    if (Math.abs(minute - window) <= WINDOW_TOLERANCE_MINUTES) return window;
  }
  return null;
}

/**
 * Build one snapshot from one fixture of the existing live poll.
 *
 * @param {object} row  identity + provider clock + score, plus the RAW getWithCache
 *   results handleLive already holds: `statsResult`, `eventsResult` ({ ok, fromCache,
 *   reason, response }) — undefined when the component was never fetched (NS / FT rows)
 * @param {number} capturedAtMs  OUR clock at the moment of recording
 * @returns {{ ok: true, snapshot: object, events: object[] } | { ok: false, reason: string }}
 */
export function buildLiveCaptureSnapshot(row, capturedAtMs) {
  const fixtureId = nullableId(row?.fixtureId);
  if (fixtureId === null) return { ok: false, reason: "malformed_fixture_id" };
  if (!Number.isFinite(Number(capturedAtMs)) || Number(capturedAtMs) <= 0) {
    return { ok: false, reason: "malformed_captured_at" };
  }
  const status = nullableText(row?.status)?.toUpperCase() || null;
  if (!status) return { ok: false, reason: "malformed_status" };

  const homeTeamId = nullableId(row?.homeTeamId);
  const awayTeamId = nullableId(row?.awayTeamId);

  const statsSource = describeSource(row?.statsResult);
  const stats =
    statsSource.source === "fresh" || statsSource.source === "cache"
      ? extractCaptureStats(row.statsResult.response, homeTeamId, awayTeamId)
      : { status: statsSource.source === "unavailable" ? "request_failed" : "not_fetched", sideResolution: null, home: null, away: null };

  const eventsSource = describeSource(row?.eventsResult);
  const eventsKnown = eventsSource.source === "fresh" || eventsSource.source === "cache";
  const events = eventsKnown ? extractCaptureEvents(row.eventsResult.response, homeTeamId, awayTeamId) : [];

  const snapshot = {
    v: LIVE_CAPTURE_SCHEMA_VERSION,
    fixtureId,
    capturedAt: new Date(Number(capturedAtMs)).toISOString(),
    capturedAtMs: Number(capturedAtMs),

    // Pre-match join references. fixtureId is the predictions_history key and the only
    // true join key; the rest lets an offline job check it joined the right match (and
    // reach team_market_rolling) without a DB read on the capture path. No lambda, no
    // model_version, no pre-match payload is copied here — those belong to the baseline.
    kickoffAt: isoOrNull(row?.kickoffAt),
    leagueId: nullableId(row?.leagueId),
    season: nullableId(row?.season),
    homeTeamId,
    awayTeamId,

    // Provider match clock — separate from capturedAt on purpose.
    status,
    elapsedMinute: nullableCount(row?.elapsed),
    extraMinute: nullableCount(row?.extra),
    providerPeriodFirstStart: isoFromEpochSeconds(row?.periodFirstStart),
    providerPeriodSecondStart: isoFromEpochSeconds(row?.periodSecondStart),

    homeScore: nullableCount(row?.score?.home),
    awayScore: nullableCount(row?.score?.away)
  };

  for (const [name] of CAPTURED_STATS) {
    snapshot[`${name}Home`] = stats.home ? stats.home[name] : null;
    snapshot[`${name}Away`] = stats.away ? stats.away[name] : null;
  }

  // Provenance, per component. A cache hit replays a payload of unknown age, so it is
  // never allowed to pass as a fresh observation.
  snapshot.scoreSource = row?.scoreSource === "fresh" ? "fresh" : "cache";
  snapshot.statsSource = statsSource.source;
  snapshot.statsStatus = stats.status;
  snapshot.statsReason = statsSource.reason;
  snapshot.sideResolution = stats.sideResolution;
  snapshot.eventsSource = eventsSource.source;
  snapshot.eventsReason = eventsSource.reason;
  snapshot.eventCount = eventsKnown ? events.length : null;
  snapshot.eventsRef = eventsKnown && events.length > 0 ? `E:${events.length}` : null;

  return { ok: true, snapshot, events };
}

/** True when at least one live statistic is actually known — what "usable" means in the ledger. */
export function snapshotHasStats(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  return CAPTURED_STATS.some(([name]) => {
    const homeValue = snapshot[`${name}Home`];
    const awayValue = snapshot[`${name}Away`];
    return (homeValue !== null && homeValue !== undefined) || (awayValue !== null && awayValue !== undefined);
  });
}
