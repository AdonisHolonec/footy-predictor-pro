/**
 * Match Detail is composed in layers (UX-C). Each sub-panel component renders a
 * set of blocks, and each block is tagged with the part it belongs to; the
 * composer passes a gate that shows exactly the parts a layer owns.
 *
 *   live        → win-probability strip, Momentum timeline, momentum notice
 *   explanation / keyFactors / whyPrediction / confidence → "Why this pick" tier 3
 *   odds / marketPicks / derived → Markets
 *   specialBet  → the per-match ticket builder
 *   standings   → Context
 *   lab / monteCarlo / xg / signals → Advanced (model internals)
 */
export type DetailPart =
  | "live"
  | "explanation"
  | "keyFactors"
  | "whyPrediction"
  | "confidence"
  | "odds"
  | "marketPicks"
  | "derived"
  | "specialBet"
  | "standings"
  | "lab"
  | "monteCarlo"
  | "xg"
  | "signals";

/** A gate that shows only the listed parts; everything else gets `hidden`. */
export function partsGate(visible: readonly DetailPart[]): (ids: DetailPart[]) => string {
  return (ids) => (ids.some((id) => visible.includes(id)) ? "" : "hidden");
}
