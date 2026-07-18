/**
 * Single explainable reason derived from real match data.
 * Never invent generic copy — only call createReason when values are finite.
 */

/**
 * @typedef {object} PredictionReason
 * @property {string} code
 * @property {string} label
 * @property {number|null} [value]
 * @property {string|null} [unit]
 * @property {"positive"|"negative"|"neutral"|"support"} [polarity]
 * @property {string} source
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @param {{ code: string, label: string, value?: number|null, unit?: string|null, polarity?: string, source: string, meta?: object }} input
 * @returns {PredictionReason|null}
 */
export function createReason(input) {
  if (!input || !input.code || !input.label || !input.source) return null;
  const label = String(input.label).trim();
  if (!label) return null;
  const value = input.value == null ? null : Number(input.value);
  if (input.value != null && !Number.isFinite(value)) return null;
  return {
    code: String(input.code),
    label,
    value: value == null ? null : value,
    unit: input.unit != null ? String(input.unit) : null,
    polarity: input.polarity || "neutral",
    source: String(input.source),
    meta: input.meta && typeof input.meta === "object" ? input.meta : undefined
  };
}

/** Format signed percent for labels: +21% / -14%. */
export function formatSignedPct(pct, digits = 0) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  const rounded = Number(n.toFixed(digits));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

export function formatFixed(n, digits = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return x.toFixed(digits);
}
