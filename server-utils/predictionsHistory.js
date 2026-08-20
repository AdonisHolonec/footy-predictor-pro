import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { MODEL_VERSION } from "./modelConstants.js";
import {
  aggregateCardMarketStats,
  attachCardMarketsToPayload,
  resolveCardMarketValidations,
  resolveRecommendedValidation
} from "./cardMarketSettlement.js";
import { filterByMinDisplayOdds } from "./predictionDisplayGate.js";
import { deriveHistoryListColumns } from "./historyListColumns.js";

const FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);
const HISTORY_TABLE = "predictions_history";
const SNAPSHOTS_TABLE = "prediction_snapshots";

function asNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function normalizePick(pick) { return String(pick || "").trim().toLowerCase(); }
export function isFinalStatus(status) { return FINAL_STATUSES.has(String(status || "").toUpperCase()); }

export function evaluateTopPick(pick, score) {
  if (!pick || !score) return null;
  if (score.home === null || score.away === null) return null;
  const home = Number(score.home); const away = Number(score.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const total = home + away; const normalized = normalizePick(pick);
  if (normalized === "1") return home > away;
  if (normalized === "2") return away > home;
  if (normalized === "x") return home === away;
  // Double Chance
  if (normalized === "1x") return home >= away;
  if (normalized === "12") return home !== away;
  if (normalized === "x2") return away >= home;
  if (normalized === "gg") return home > 0 && away > 0;
  if (normalized === "ngg") return home === 0 || away === 0;
  const overMatch = normalized.match(/^(?:peste|over)\s*(\d+(?:[.,]\d+)?)/);
  if (overMatch) return total > Number(overMatch[1].replace(",", "."));
  const underMatch = normalized.match(/^(?:sub|under)\s*(\d+(?:[.,]\d+)?)/);
  if (underMatch) return total < Number(underMatch[1].replace(",", "."));
  return null;
}

/** True when evaluateTopPick can grade this market label (1X2, DC, BTTS, O/U). */
export function isGradeablePick(pick) {
  const normalized = normalizePick(pick);
  if (!normalized) return false;
  if (["1", "2", "x", "1x", "12", "x2", "gg", "ngg"].includes(normalized)) return true;
  return /^(?:peste|over|sub|under)\s*\d/.test(normalized);
}

/** Canonical value-bet pick string for settlement (preserves O/U wording). */
export function resolveValueBetPick(type) {
  const raw = String(type || "").trim();
  if (!raw || !isGradeablePick(raw)) return null;
  const upper = raw.toUpperCase();
  if (["1", "X", "2", "1X", "12", "X2", "GG", "NGG"].includes(upper)) return upper;
  return raw;
}

export function validationFromMatch(status, pick, score) {
  if (!isFinalStatus(status)) return "pending";
  const result = evaluateTopPick(pick, score);
  if (result === null) return "pending";
  return result ? "win" : "loss";
}

/** Exported so the dual-write contract can be tested on the exact row INSERT/UPSERT receive. */
export function mapPredictionToDbRow(prediction) {
  const kickoffAt = prediction.kickoff || null;
  const status = prediction.status || null;
  const scoreHome = asNum(prediction.score?.home);
  const scoreAway = asNum(prediction.score?.away);
  const score = { home: scoreHome, away: scoreAway };
  const recommendedPick = prediction.recommended?.pick || null;
  const recommendedConfidence = asNum(prediction.recommended?.confidence);
  const generatedAt = new Date().toISOString();
  const modelVer = prediction.modelVersion || MODEL_VERSION;
  const valueBetPick = resolveValueBetPick(prediction.valueBet?.type);
  const valueBetValidation = valueBetPick
    ? isFinalStatus(status)
      ? validationFromMatch(status, valueBetPick, score)
      : "pending"
    : null;

  const payloadWithMeta = attachCardMarketsToPayload(
    {
      ...prediction,
      historyMeta: { generatedAt, source: "api/predict", schemaVersion: 2 },
      modelVersion: modelVer,
      value_bet_validation: valueBetValidation,
      evaluation: prediction.evaluation || null
    },
    { status, score }
  );

  return {
    fixture_id: prediction.id,
    league_id: asNum(prediction.leagueId),
    league_name: prediction.league || null,
    home_team: prediction.teams?.home || null,
    away_team: prediction.teams?.away || null,
    kickoff_at: kickoffAt,
    recommended_pick: recommendedPick,
    recommended_confidence: recommendedConfidence,
    odds_home: asNum(prediction.odds?.home),
    odds_draw: asNum(prediction.odds?.draw),
    odds_away: asNum(prediction.odds?.away),
    bookmaker: prediction.odds?.bookmaker || null,
    referee_name: prediction.referee || null,
    luck_hg: asNum(prediction.luckStats?.hG),
    luck_hxg: asNum(prediction.luckStats?.hXG),
    luck_ag: asNum(prediction.luckStats?.aG),
    luck_axg: asNum(prediction.luckStats?.aXG),
    match_status: status,
    score_home: scoreHome,
    score_away: scoreAway,
    validation: resolveRecommendedValidation({
      pick: recommendedPick,
      family: prediction.recommended?.family || null,
      status,
      score,
      // All tracked totals, not just corners: a Shots / Shots-on-Target Recommended grades
      // against its own market's total and would otherwise stay pending forever.
      marketTotals: {
        cornersTotal: prediction.marketResults?.cornersTotal ?? null,
        shotsOnTargetTotal: prediction.marketResults?.shotsOnTargetTotal ?? null,
        shotsTotal: prediction.marketResults?.shotsTotal ?? null
      }
    }),
    value_bet_validation: valueBetValidation,
    model_version: modelVer,
    reason_codes: Array.isArray(prediction?.auditLog?.reasonCodes) ? prediction.auditLog.reasonCodes : null,
    top_features: Array.isArray(prediction?.featureImportance?.topFeatures)
      ? prediction.featureImportance.topFeatures
      : Array.isArray(prediction?.auditLog?.topFeatures)
        ? prediction.auditLog.topFeatures
        : null,
    saved_at: generatedAt,
    updated_at: generatedAt,
    raw_payload: payloadWithMeta,
    // Derived from the SAME object persisted above, so the columns can never
    // describe a payload that was not written.
    ...deriveHistoryListColumns(payloadWithMeta)
  };
}

export async function insertPredictionSnapshots(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) return { count: 0 };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { count: 0 };
  const now = new Date().toISOString();
  const rows = predictions.map((p) => ({
    fixture_id: Number(p.id),
    model_version: p.modelVersion || MODEL_VERSION,
    generated_at: now,
    league_id: asNum(p.leagueId),
    kickoff_at: p.kickoff || null,
    raw_payload: {
      ...p,
      snapshotAt: now
    }
  }));
  const { error } = await supabase.from(SNAPSHOTS_TABLE).insert(rows);
  if (error) {
    console.error("[prediction_snapshots]", error.message);
  }
  return { count: rows.length };
}

/**
 * Integritate predicţii: ignorăm fixture-urile al căror kickoff a trecut deja sau sunt
 * în statut live/final. Asta protejează `predictions_history.raw_payload` de a fi rescris
 * cu features post-hoc (ar introduce time-leakage în backtest).
 */
function isPreKickoff(prediction) {
  const status = String(prediction?.status || "").toUpperCase();
  if (status && !["NS", "TBD", "PST", "CANC", "SUSP", "AWD"].includes(status)) return false;
  const ko = prediction?.kickoff ? new Date(prediction.kickoff).getTime() : NaN;
  if (!Number.isFinite(ko)) return true; // fără kickoff cunoscut, permitem salvarea
  return ko > Date.now();
}

/**
 * Fields that describe how the match ACTUALLY went. Everything else in a
 * prediction was decided before kickoff and must not move afterwards.
 */
const LIVE_RESULT_FIELDS = [
  "status",
  "score",
  "marketResults",
  "cardMarketValidations",
  "momentum",
  "evaluation",
  "elapsed"
];

/**
 * Canonical prediction + live result.
 *
 * `isPreKickoff` already freezes the stored row at kickoff, so the persisted
 * payload IS the prediction of record. What it cannot carry is the result,
 * which only exists later — so the frozen prediction is the base and the live
 * row contributes the handful of fields that describe the outcome.
 *
 * Without this, a fixture that has already started is re-predicted on every
 * request and never written back, so each surface renders whichever run it
 * happened to hold: odds move, lines snap differently, and the same fixture
 * produces two different Special Bets (Admin "Under 10.5" vs Mobile "Over 6.5",
 * 2026-08-09).
 */
export function mergeCanonicalPrediction(fresh, canonical) {
  if (!canonical || typeof canonical !== "object") return fresh;
  if (!fresh || typeof fresh !== "object") return canonical;

  const merged = { ...canonical };
  for (const field of LIVE_RESULT_FIELDS) {
    if (fresh[field] !== undefined) merged[field] = fresh[field];
  }

  // The live nudge is a display-layer derivation of the CURRENT match state, so
  // it belongs to the live row even though the engine around it is frozen.
  if (canonical.confidenceEngine || fresh.confidenceEngine) {
    merged.confidenceEngine = {
      ...(canonical.confidenceEngine || {}),
      liveAdjustment: fresh.confidenceEngine?.liveAdjustment ?? null
    };
  }

  return merged;
}

/**
 * Replace already-started fixtures with the prediction of record, so every
 * surface renders the same one. Pre-kickoff rows are untouched: they are still
 * being written, so the fresh computation IS canonical.
 *
 * Read-only against Supabase; never writes, and returns the input unchanged if
 * the lookup fails — a fresh-but-consistent render beats a failed request.
 */
export async function applyCanonicalPayloads(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) return predictions;

  const started = predictions.filter((p) => !isPreKickoff(p));
  if (started.length === 0) return predictions;

  const supabase = getSupabaseAdmin();
  if (!supabase) return predictions;

  const fixtureIds = started.map((p) => Number(p?.id)).filter((id) => Number.isFinite(id));
  if (fixtureIds.length === 0) return predictions;

  let canonicalById = new Map();
  try {
    const { data, error } = await supabase
      .from(HISTORY_TABLE)
      .select("fixture_id, raw_payload")
      .in("fixture_id", fixtureIds);
    if (error) throw error;
    canonicalById = new Map(
      (data || [])
        .filter((row) => row?.raw_payload && typeof row.raw_payload === "object")
        .map((row) => [Number(row.fixture_id), row.raw_payload])
    );
  } catch (err) {
    console.warn("applyCanonicalPayloads: lookup failed, serving fresh rows", err?.message || err);
    return predictions;
  }

  if (canonicalById.size === 0) return predictions;

  return predictions.map((p) => {
    const canonical = canonicalById.get(Number(p?.id));
    if (!canonical || isPreKickoff(p)) return p;
    return mergeCanonicalPrediction(p, canonical);
  });
}

export async function upsertPredictionsHistory(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) return { count: 0, skipped: 0 };
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");

  const eligible = predictions.filter(isPreKickoff);
  const skipped = predictions.length - eligible.length;
  if (eligible.length === 0) return { count: 0, skipped };

  const rows = eligible.map(mapPredictionToDbRow);
  const fixtureIds = rows
    .map((row) => Number(row.fixture_id))
    .filter((id) => Number.isFinite(id));

  const { data: existingRows, error: existingErr } = await supabase
    .from(HISTORY_TABLE)
    .select("fixture_id, match_status, updated_at")
    .in("fixture_id", fixtureIds);
  if (existingErr) throw existingErr;

  const existingById = new Map((existingRows || []).map((row) => [Number(row.fixture_id), row]));
  const toInsert = [];
  const toUpsert = [];
  let skippedFinal = 0;
  let skippedStale = 0;

  for (const row of rows) {
    const existing = existingById.get(Number(row.fixture_id));
    if (!existing) {
      toInsert.push(row);
      continue;
    }
    // Guard: never let predict reruns overwrite settled/final rows.
    if (isFinalStatus(existing.match_status)) {
      skippedFinal += 1;
      continue;
    }

    // Guard: ignore stale updates when DB row is already newer.
    const incomingTs = new Date(row.updated_at || 0).getTime();
    const existingTs = new Date(existing.updated_at || 0).getTime();
    if (Number.isFinite(existingTs) && Number.isFinite(incomingTs) && existingTs > incomingTs) {
      skippedStale += 1;
      continue;
    }

    toUpsert.push(row);
  }

  if (toInsert.length > 0) {
    const { error: insertErr } = await supabase.from(HISTORY_TABLE).insert(toInsert);
    if (insertErr) throw insertErr;
  }

  if (toUpsert.length > 0) {
    const { error: upsertErr } = await supabase.from(HISTORY_TABLE).upsert(toUpsert, { onConflict: "fixture_id" });
    if (upsertErr) throw upsertErr;
  }

  const inserted = toInsert.length;
  const updated = toUpsert.length;
  console.info(
    JSON.stringify({
      historyPersist: true,
      attempted: rows.length,
      inserted,
      updated,
      skippedFinal,
      skippedStale,
      skippedPreKickoff: skipped
    })
  );

  await insertPredictionSnapshots(eligible);
  return {
    count: rows.length,
    skipped,
    inserted,
    updated,
    skippedFinal,
    skippedStale
  };
}

export function mapDbRowToHistoryEntry(row) {
  const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const cardMarketValidations = resolveCardMarketValidations(row);
  return {
    ...payload,
    id: row.fixture_id,
    leagueId: row.league_id ?? payload.leagueId,
    league: row.league_name ?? payload.league ?? "Necunoscut",
    teams: payload.teams || { home: row.home_team || "Gazde", away: row.away_team || "Oaspeți" },
    kickoff: payload.kickoff || row.kickoff_at,
    status: row.match_status || payload.status || "",
    score: { home: row.score_home, away: row.score_away },
    recommended: payload.recommended || { pick: row.recommended_pick || "", confidence: row.recommended_confidence || 0 },
    savedAt: row.saved_at,
    validation: row.validation,
    cardMarkets: payload.cardMarkets || null,
    cardMarketValidations,
    modelVersion: row.model_version ?? payload.modelVersion
  };
}

export async function readPredictionsHistory(days = 30, limit = 500) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 120));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from(HISTORY_TABLE).select("*").gte("kickoff_at", cutoff).order("kickoff_at", { ascending: false }).limit(safeLimit);
  if (error) throw error;
  const rows = data || [];
  const items = filterByMinDisplayOdds(rows.map(mapDbRowToHistoryEntry));
  return { items, stats: aggregateCardMarketStats(rows) };
}

/**
 * The ONLY raw_payload keys the win/loss aggregate reads, traced through
 * aggregateCardMarketStats -> resolveCardMarketValidations -> deriveCardMarketPicks:
 *
 *   status, score, validation, cardMarkets, cardMarketValidations,
 *   marketResults                  - read by resolveCardMarketValidations
 *   recommended, probs, marketOdds - read by deriveCardMarketPicks(payload)
 *
 * Selecting the raw_payload COLUMN instead pulled the whole document, and those
 * rows are ~134KB at the median (see the upsert-chunking note above). At the
 * public default (days=30, limit=500) that is tens of MB serialized by PostgREST
 * to produce a ~130 byte response - enough to cross Postgres' statement_timeout,
 * which is why GET /api/history?days=30 failed intermittently in production.
 */
export const AGGREGATE_PAYLOAD_KEYS = Object.freeze([
  "cardMarketValidations",
  "cardMarkets",
  "marketOdds",
  "marketResults",
  "probs",
  "recommended",
  "score",
  "status",
  "validation"
]);

const AGGREGATE_PAYLOAD_PREFIX = "pl_";

/** Scalar columns the aggregate reads straight off the row. */
const AGGREGATE_ROW_COLUMNS = Object.freeze([
  "validation",
  "match_status",
  "score_home",
  "score_away",
  "recommended_pick"
]);

/** `pl_status:raw_payload->status, ...` - PostgREST projects the keys, not the blob. */
export const AGGREGATE_STATS_SELECT = [
  ...AGGREGATE_ROW_COLUMNS,
  ...AGGREGATE_PAYLOAD_KEYS.map((key) => `${AGGREGATE_PAYLOAD_PREFIX}${key}:raw_payload->${key}`)
].join(", ");

/**
 * Rebuild the row shape the settlement helpers expect. They take a DB row and
 * reach into `row.raw_payload`, so the projected keys are folded back into
 * exactly that shape - the helpers are untouched and cannot tell the difference.
 */
export function rehydrateAggregateRow(row) {
  const source = row && typeof row === "object" ? row : {};
  const rawPayload = {};
  for (const key of AGGREGATE_PAYLOAD_KEYS) {
    const value = source[`${AGGREGATE_PAYLOAD_PREFIX}${key}`];
    if (value !== undefined && value !== null) rawPayload[key] = value;
  }
  return {
    validation: source.validation ?? null,
    match_status: source.match_status ?? null,
    score_home: source.score_home ?? null,
    score_away: source.score_away ?? null,
    recommended_pick: source.recommended_pick ?? null,
    raw_payload: rawPayload
  };
}

/**
 * Win/loss aggregates for marketing / login stats.
 * Uses raw_payload card markets when present so goals/corners/shots count too.
 */
export async function readPredictionsHistoryAggregateStats(days = 30, limit = 500) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 120));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select(AGGREGATE_STATS_SELECT)
    .gte("kickoff_at", cutoff)
    .order("kickoff_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  const rows = (data || []).map(rehydrateAggregateRow);
  return { stats: aggregateCardMarketStats(rows) };
}

/**
 * The light History LIST projection — opt-in via `?view=list`.
 *
 * The dashboard asks for days=30&limit=2000&mine=1 and the rows are ~261KB each
 * at the median, so PostgREST serializes hundreds of megabytes to render a list
 * that shows a scoreline and a badge. That is what crosses statement_timeout.
 *
 * This is NOT a global slimming. `/api/history` is also a prediction source:
 * usePredictionsCache.rehydratePredictionsFromHistory() feeds its response
 * straight into `setPreds`, which drives the prediction cards and
 * hasLegacyPredictionShape(). A light row there would degrade those cards and
 * — because a light row still looks "legacy" — could re-trigger the rehydrate
 * that fetched it. So lightness is opt-in per caller and the default is
 * untouched.
 *
 * The key set is the UNION of two contracts, not just what the list renders:
 *   - what aggregateCardMarketStats() reads (AGGREGATE_PAYLOAD_KEYS), because
 *     the list response still carries `stats`
 *   - what the list itself needs: teams/kickoff/logos/league/leagueId, plus
 *     `recommended` for filterByMinDisplayOdds, which gates on recommended.odd
 *
 * Everything genuinely large stays behind `?fixtureId=N`: monteCarlo,
 * featureImportance, predictionContributions, explanation, evaluation,
 * leagueProfile, teamContext, modelMeta, valueEngine, momentum.
 */
export const HISTORY_LIST_PAYLOAD_KEYS = Object.freeze([]);

/**
 * Everything the list reads. All real columns — no JSON extraction.
 *
 * Seven arrived with migration 055, four more with 056, and Phase 4H
 * materialised card_markets / card_market_validations on the 324 rows that
 * predated creation-time attachment, so `card_markets IS NULL` is now 0 across
 * all 810 rows. That is what makes this projection possible.
 */
const HISTORY_LIST_ROW_COLUMNS = Object.freeze([
  "fixture_id",
  "league_id",
  "league_name",
  "kickoff_at",
  "home_team",
  "away_team",
  "score_home",
  "score_away",
  "validation",
  "match_status",
  "recommended_pick",
  "recommended_confidence",
  "saved_at",
  "model_version",
  // 055
  "recommended_odd",
  "logo_home",
  "logo_away",
  "card_markets",
  "card_market_validations",
  "corners_total",
  "shots_on_target_total",
  // 056
  "recommended_family",
  "recommended_period",
  "recommended_scope",
  "recommended_book_line"
]);

/**
 * THE READ CUTOVER.
 *
 * This projection no longer contains a single `raw_payload->key`. Measured on
 * the production RPC for a 308-row user, same rows, same predicate:
 *
 *   15 payload keys   1,755,036 bytes   1585-1830 ms
 *    0 payload keys     317,456 bytes    125-220 ms
 *
 * `raw_payload->key` narrows what crosses the wire, not what Postgres has to
 * read: the ~261 KB document still comes out of TOAST and is decompressed to
 * produce a scoreline and a badge. Only removing the document from the
 * projection removes that cost, which is why 055/056 and the Phase 4H
 * materialisation had to land first.
 *
 * The DEFAULT list is deliberately untouched. /api/history is also a prediction
 * source — usePredictionsCache.rehydratePredictionsFromHistory() pipes the
 * response straight into setPreds — so only `?view=list` opts in.
 */
export const HISTORY_LIST_SELECT = HISTORY_LIST_ROW_COLUMNS.join(", ");

/**
 * Adapt a column row into the shape the settlement helpers read.
 *
 * NOT a payload rehydration: nothing here comes out of the document. But
 * resolveCardMarketValidations and aggregateCardMarketStats look for
 * `row.raw_payload.cardMarkets` / `.cardMarketValidations` / `.marketResults`,
 * and those helpers are settlement code that this phase must not touch. So the
 * three column values are presented under the key path they already expect.
 *
 * marketResults is synthesised ONLY from the two promoted totals, and stays
 * absent when both are NULL — an absent total must never read as a real zero.
 */
export function rehydrateListRow(row) {
  const source = row && typeof row === "object" ? row : {};
  const out = {};
  for (const column of HISTORY_LIST_ROW_COLUMNS) out[column] = source[column] ?? null;

  const marketResults =
    out.corners_total === null && out.shots_on_target_total === null
      ? null
      : { cornersTotal: out.corners_total, shotsOnTargetTotal: out.shots_on_target_total };

  out.raw_payload = {
    cardMarkets: out.card_markets,
    cardMarketValidations: out.card_market_validations,
    ...(marketResults ? { marketResults } : {})
  };
  return out;
}

/**
 * Light counterpart to mapDbRowToHistoryEntry — now entirely column-based.
 *
 * There is no `...payload` spread, no `raw_payload` read and no fallback to the
 * document. Every field below comes from a real column, so a future key added
 * to raw_payload cannot silently re-widen this contract.
 *
 * Two departures from the old shape, both deliberate:
 *
 *  - `logos` carries home/away only. The document also held `logos.league`, and
 *    055 did not promote it, but no History consumer reads it — HistorySection
 *    renders home and away; MatchCard/PredictionFocusCard do read it and are
 *    fed `preds`, not history rows.
 *
 *  - `probs` is gone, replaced by two named booleans. The old row shipped the
 *    whole probs object so useDashboardHistory could ask "does this fixture
 *    have a corners/shots market at all". Shipping a large analytical object to
 *    answer a yes/no is what this phase exists to stop, and a field named
 *    `probs` holding anything other than probabilities would be a lie in the
 *    type. card_markets answers the same question exactly: measured across all
 *    810 production rows, `probs.corners` present == `cardMarkets.corners`
 *    present on 748/748, and `probs.shotsOnTarget` == `cardMarkets.shots` on
 *    748/748, with zero rows differing.
 */
export function mapDbRowToHistoryListEntry(row) {
  const source = row && typeof row === "object" ? row : {};
  const cardMarkets = source.card_markets ?? null;
  const logoHome = source.logo_home ?? null;
  const logoAway = source.logo_away ?? null;

  /*
    `recommended` is assembled from its own columns rather than a stored object.
    Each optional key is omitted when NULL instead of being set to null, so
    formatRecommendedPick sees exactly what it saw when the value came out of
    the document: absent, not "present and empty". That distinction is what
    keeps a legacy row without a period from rendering an invented suffix.
  */
  const recommended = {
    pick: source.recommended_pick || "",
    confidence: source.recommended_confidence || 0
  };
  if (source.recommended_odd !== null && source.recommended_odd !== undefined) {
    recommended.odd = source.recommended_odd;
  }
  if (source.recommended_family !== null && source.recommended_family !== undefined) {
    recommended.family = source.recommended_family;
  }
  if (source.recommended_period !== null && source.recommended_period !== undefined) {
    recommended.period = source.recommended_period;
  }
  if (source.recommended_scope !== null && source.recommended_scope !== undefined) {
    recommended.scope = source.recommended_scope;
  }
  if (source.recommended_book_line !== null && source.recommended_book_line !== undefined) {
    recommended.bookLine = source.recommended_book_line;
  }

  return {
    id: source.fixture_id,
    leagueId: source.league_id,
    league: source.league_name || "Necunoscut",
    teams: { home: source.home_team || "Gazde", away: source.away_team || "Oaspeți" },
    kickoff: source.kickoff_at,
    status: source.match_status || "",
    score: { home: source.score_home, away: source.score_away },
    recommended,
    savedAt: source.saved_at,
    validation: source.validation,
    cardMarkets,
    // Still resolved rather than read straight from the column: a market that
    // was pending when it was written settles once the match is final, and
    // resolveCardMarketValidations is what applies that. It now reads the
    // adapted column row, not the document.
    cardMarketValidations: resolveCardMarketValidations(source),
    modelVersion: source.model_version,
    logos: logoHome || logoAway ? { home: logoHome, away: logoAway } : null,
    // Replaces the `probs` object. Read by useDashboardHistory's pending count.
    hasCornersMarket: Boolean(cardMarkets && cardMarkets.corners),
    hasShotsMarket: Boolean(cardMarkets && cardMarkets.shots)
  };
}

/** Global history, light projection. Same rows, same order, same stats. */
export async function readPredictionsHistoryList(days = 30, limit = 500) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 120));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select(HISTORY_LIST_SELECT)
    .gte("kickoff_at", cutoff)
    .order("kickoff_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  const rows = (data || []).map(rehydrateListRow);
  const items = filterByMinDisplayOdds(rows.map(mapDbRowToHistoryListEntry));
  return { items, stats: aggregateCardMarketStats(rows) };
}

/**
 * User-scoped history, light projection.
 *
 * The RPC is `returns setof predictions_history` and is left exactly as it is —
 * narrowing it would be a schema migration. PostgREST applies `?select=` to a
 * set-returning function just as it does to a table, so the projection happens
 * without touching the function.
 */
export async function readPredictionsHistoryListForUser(userId, days = 30, limit = 500) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 120));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const { data, error } = await supabase
    .rpc("predictions_history_for_user", { p_user_id: userId, p_days: safeDays, p_limit: safeLimit })
    .select(HISTORY_LIST_SELECT);
  if (error) throw error;
  const rows = (data || []).map(rehydrateListRow);
  const items = filterByMinDisplayOdds(rows.map(mapDbRowToHistoryListEntry));
  return { items, stats: aggregateCardMarketStats(rows) };
}

/** Rows from predictions_history joined via user_prediction_fixtures (service role RPC). */
export async function readPredictionsHistoryForUser(userId, days = 30, limit = 500) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 120));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const { data, error } = await supabase.rpc("predictions_history_for_user", {
    p_user_id: userId,
    p_days: safeDays,
    p_limit: safeLimit
  });
  if (error) throw error;
  const rows = data || [];
  const items = filterByMinDisplayOdds(rows.map(mapDbRowToHistoryEntry));
  return { items, stats: aggregateCardMarketStats(rows) };
}
