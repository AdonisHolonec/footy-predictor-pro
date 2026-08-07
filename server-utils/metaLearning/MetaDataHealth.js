/**
 * Data Health — the first thing this layer must be able to say, and the panel that
 * decides whether anything else it reports may be believed yet.
 *
 * The binding constraint on the whole Meta Learning layer is statistical power, not
 * architecture:
 *   - API-Football only yields a comparable selection for 1x2 / goals-ou / (weakly)
 *     btts+dc. PredictorV3 also publishes corners / cards / shots / correct_score and
 *     non-goals O/U lines, for which NO external counterpart exists — those families are
 *     permanently unanswerable against this provider and are reported as such, never
 *     counted as misses.
 *   - A head-to-head claim's real sample size is `discordant_n` (only-ours-correct plus
 *     only-theirs-correct). Concordant pairs carry no information about which provider is
 *     better, which is why McNemar tests those two cells only.
 *
 * So this module reports coverage honestly and projects, from the observed accrual rate,
 * how long until each family could even support a verdict. PURE: no I/O, no Supabase.
 */

import { STATS, EXTERNALLY_COMPARABLE_FAMILIES, MARKET_FAMILIES, PROVIDER_KEYS } from "./metaLearningConfig.js";

const SETTLED_RESULTS = new Set(["win", "loss"]);

function pct(numerator, denominator) {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function round(value, digits = 3) {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Pair our selections against the provider's on (fixture, market family).
 * Only rows both sides actually settled can contribute.
 */
function buildPairs(selections, providerKeyById) {
  const byFixtureFamily = new Map();

  for (const row of selections || []) {
    const key = `${row.fixture_id}|${row.market_family}`;
    if (!byFixtureFamily.has(key)) byFixtureFamily.set(key, { ours: null, theirs: null });
    const slot = byFixtureFamily.get(key);
    const providerKey = providerKeyById.get(row.provider_id);
    if (providerKey === PROVIDER_KEYS.predictorV3) slot.ours = row;
    else if (providerKey === PROVIDER_KEYS.apiFootball) slot.theirs = row;
  }

  const pairs = [];
  for (const [key, slot] of byFixtureFamily.entries()) {
    if (!slot.ours || !slot.theirs) continue;
    const [fixtureId, family] = key.split("|");
    pairs.push({
      fixtureId: Number(fixtureId),
      marketFamily: family,
      ours: slot.ours,
      theirs: slot.theirs,
      bothSettled: SETTLED_RESULTS.has(slot.ours.result) && SETTLED_RESULTS.has(slot.theirs.result)
    });
  }
  return pairs;
}

function contingency(pairs) {
  let bothCorrect = 0;
  let bothWrong = 0;
  let onlyOursCorrect = 0;
  let onlyTheirsCorrect = 0;

  for (const p of pairs) {
    if (!p.bothSettled) continue;
    const ours = p.ours.result === "win";
    const theirs = p.theirs.result === "win";
    if (ours && theirs) bothCorrect += 1;
    else if (!ours && !theirs) bothWrong += 1;
    else if (ours) onlyOursCorrect += 1;
    else onlyTheirsCorrect += 1;
  }

  const settledPairs = bothCorrect + bothWrong + onlyOursCorrect + onlyTheirsCorrect;
  return {
    settledPairs,
    bothCorrect,
    bothWrong,
    onlyOursCorrect,
    onlyTheirsCorrect,
    // The only number that matters for statistical power.
    discordantN: onlyOursCorrect + onlyTheirsCorrect
  };
}

/**
 * Readiness ladder. Deliberately blunt: below the leaning floor no p-value is computed
 * at all, so the honest answer is "we do not know yet", not "no edge".
 */
function readiness(discordantN) {
  if (discordantN >= STATS.minDiscordantDominant) return "dominant_possible";
  if (discordantN >= STATS.minDiscordantLeaning) return "leaning_possible";
  return "insufficient_data";
}

function projectDaysToSupport(discordantN, discordantPerDay, target) {
  if (discordantN >= target) return 0;
  if (!discordantPerDay || discordantPerDay <= 0) return null; // unknown, not "soon"
  return Math.ceil((target - discordantN) / discordantPerDay);
}

/**
 * @param {{ selections: object[], contexts: object[], windowDays: number,
 *   providerKeyById: Map<number, string>, projectorDiagnostics?: object,
 *   benchmarkRowCount?: number, agreeNullCount?: number }} input
 */
export function computeDataHealth({
  selections = [],
  contexts = [],
  windowDays = 365,
  providerKeyById = new Map(),
  projectorDiagnostics = {},
  benchmarkRowCount = 0,
  agreeNullCount = 0
}) {
  const ours = selections.filter((r) => providerKeyById.get(r.provider_id) === PROVIDER_KEYS.predictorV3);
  const theirs = selections.filter((r) => providerKeyById.get(r.provider_id) === PROVIDER_KEYS.apiFootball);

  const oursSettled = ours.filter((r) => SETTLED_RESULTS.has(r.result));
  const pairs = buildPairs(selections, providerKeyById);
  const settledPairs = pairs.filter((p) => p.bothSettled);
  const overall = contingency(pairs);

  const days = Math.max(1, Number(windowDays) || 1);
  const pairsPerDay = round(settledPairs.length / days, 4);
  const discordantPerDay = round(overall.discordantN / days, 4);

  // Per-family view. Families with no external counterpart are reported explicitly rather
  // than appearing as zero-hit-rate rows, which would read as "we are terrible at corners"
  // when the truth is "nobody to compare against".
  const familyRows = [];
  for (const family of MARKET_FAMILIES) {
    const oursInFamily = ours.filter((r) => r.market_family === family);
    if (oursInFamily.length === 0) continue;

    const comparable = EXTERNALLY_COMPARABLE_FAMILIES.includes(family);
    const familyPairs = pairs.filter((p) => p.marketFamily === family);
    const table = contingency(familyPairs);
    const familyDiscordantPerDay = round(table.discordantN / days, 4);

    familyRows.push({
      family,
      externallyComparable: comparable,
      ourSelections: oursInFamily.length,
      ourSettled: oursInFamily.filter((r) => SETTLED_RESULTS.has(r.result)).length,
      pairedSettled: table.settledPairs,
      ...table,
      readiness: comparable ? readiness(table.discordantN) : "no_external_counterpart",
      projectedDaysToLeaning: comparable
        ? projectDaysToSupport(table.discordantN, familyDiscordantPerDay, STATS.minDiscordantLeaning)
        : null,
      projectedDaysToDominant: comparable
        ? projectDaysToSupport(table.discordantN, familyDiscordantPerDay, STATS.minDiscordantDominant)
        : null
    });
  }

  const noCounterpartSelections = ours.filter(
    (r) => !EXTERNALLY_COMPARABLE_FAMILIES.includes(r.market_family)
  ).length;

  const pricedProvider = theirs.filter((r) => r.priced_from && r.priced_from !== "unpriced").length;

  return {
    window: { days, contexts: contexts.length },

    coverage: {
      ourSelections: ours.length,
      ourSettled: oursSettled.length,
      providerSelections: theirs.length,
      providerPrimarySelections: theirs.filter((r) => r.is_primary).length,
      providerSecondarySelections: theirs.filter((r) => !r.is_primary).length,
      benchmarkRows: benchmarkRowCount,
      // The headline number: what share of our settled picks can be compared at all.
      comparabilityPct: pct(settledPairs.length, oursSettled.length),
      noExternalCounterpartPct: pct(noCounterpartSelections, ours.length),
      agreeNullPct: pct(agreeNullCount, benchmarkRowCount),
      adviceSourcedPct: pct(
        theirs.filter((r) => r.signal_quality === 3).length,
        theirs.length
      ),
      providerAbstentionPct: pct(projectorDiagnostics.providerAbstentions || 0, benchmarkRowCount),
      providerPricedCoveragePct: pct(pricedProvider, theirs.length),
      settlementDisagreementsDropped: projectorDiagnostics.settlementDisagreementsDropped || 0,
      teamIdsRecovered: projectorDiagnostics.teamIdsRecovered || 0
    },

    // Power, not performance. This block deliberately contains no hit rate: Sprint 1 does
    // not claim who is better, only whether that question is answerable yet.
    power: {
      pairedSettled: settledPairs.length,
      ...overall,
      pairsPerDay,
      discordantPerDay,
      minDiscordantLeaning: STATS.minDiscordantLeaning,
      minDiscordantDominant: STATS.minDiscordantDominant,
      readiness: readiness(overall.discordantN),
      projectedDaysToLeaning: projectDaysToSupport(
        overall.discordantN,
        discordantPerDay,
        STATS.minDiscordantLeaning
      ),
      projectedDaysToDominant: projectDaysToSupport(
        overall.discordantN,
        discordantPerDay,
        STATS.minDiscordantDominant
      )
    },

    byFamily: familyRows.sort((a, b) => b.ourSelections - a.ourSelections),
    projectorDiagnostics
  };
}

export default { computeDataHealth };
