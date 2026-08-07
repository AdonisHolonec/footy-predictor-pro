/**
 * Market-family resolution for the meta-learning layer.
 *
 * The server-authoritative family travels on `raw_payload.recommended.family`
 * (selectRecommendation.js sets it explicitly and documents that it must NOT be
 * re-derived from the pick string). We prefer it, and only fall back to the lossy
 * `tipMarketFamily()` derivation for legacy rows that predate it.
 *
 * NOTE ON DUPLICATION: BenchmarkConsensus.js holds an equivalent *private*
 * resolveOurFamily()/DECLARED_FAMILY_ALIASES pair. It is intentionally not imported here
 * because it is not exported and the existing benchmark is frozen for this phase. When
 * the benchmark is next touched, export that resolver and delete this module rather than
 * letting the two drift. tests/metaLearning/marketFamily.test.js pins the shared cases so
 * a drift shows up as a test failure.
 */

import { tipMarketFamily } from "../backtest/TipEvent.js";

/** Goals totals live on these lines; any other O/U line is a corners/shots/cards total.
 * Mirrors GOALS_LINES in src/utils/formatRecommendation.ts and BenchmarkConsensus.js. */
const GOALS_LINES = new Set([1.5, 2.5, 3.5]);

/** valueMarkets.js#classifyMarketFamily output -> the family keys this layer uses. */
const DECLARED_FAMILY_ALIASES = {
  "1x2": "1x2",
  "double chance": "dc",
  dc: "dc",
  btts: "btts",
  "over/under": "ou",
  "over under": "ou",
  goals: "ou",
  corners: "corners",
  corner: "corners",
  cards: "cards",
  card: "cards",
  shots: "shots",
  "shots on target": "shots",
  "correct score": "correct_score"
};

/** Parses "Over 2.5" / "Peste 2.5" / "Under 3.5" / "Sub 3.5" into a side + line. */
export function parseOverUnder(pick) {
  const p = String(pick || "").trim().toLowerCase();
  if (!p) return null;
  const over = p.match(/^(?:peste|over)\s*(\d+(?:[.,]\d+)?)/);
  if (over) return { side: "over", line: Number(over[1].replace(",", ".")) };
  const under = p.match(/^(?:sub|under)\s*(\d+(?:[.,]\d+)?)/);
  if (under) return { side: "under", line: Number(under[1].replace(",", ".")) };
  return null;
}

/**
 * @param {string|null|undefined} pick
 * @param {string|null|undefined} declaredFamily  raw_payload.recommended.family
 * @returns {string} one of MARKET_FAMILIES, or 'other'
 */
export function resolveMarketFamily(pick, declaredFamily) {
  const declared = DECLARED_FAMILY_ALIASES[String(declaredFamily || "").trim().toLowerCase()];
  if (declared) {
    // A declared "goals" family on a non-goals line is a totals market on another
    // statistic; keep them apart so a corners pick is never compared against a goals
    // prediction.
    if (declared === "ou") {
      const parsed = parseOverUnder(pick);
      if (parsed && parsed.line != null && !GOALS_LINES.has(parsed.line)) return "ou_other";
    }
    return declared;
  }

  const base = tipMarketFamily(pick);
  if (base !== "ou") return base || "other";
  const parsed = parseOverUnder(pick);
  return parsed?.line != null && GOALS_LINES.has(parsed.line) ? "ou" : "ou_other";
}

/** The O/U line carried by a pick, or null for unlined markets. */
export function resolveLine(pick) {
  const parsed = parseOverUnder(pick);
  return parsed?.line ?? null;
}

export default { resolveMarketFamily, resolveLine, parseOverUnder };
