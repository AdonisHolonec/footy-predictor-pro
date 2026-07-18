/**
 * Apply auto-calibration relative deltas onto manual weights.
 * Locked keys keep the manual value exactly.
 */

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

export function applyWeightDeltas(baseWeights, deltas, lockedKeys = []) {
  const locked = new Set(lockedKeys);
  const out = {};
  for (const [k, v] of Object.entries(baseWeights || {})) {
    const base = Number(v) || 0;
    if (locked.has(k)) {
      out[k] = base;
      continue;
    }
    const d = Number(deltas?.[k]) || 0;
    out[k] = round4(Math.max(0, base * (1 + d)));
  }
  return out;
}

export function mergeWithAutoOverlay(manualWeights, overlay, lockedKeys = []) {
  if (!overlay?.deltas || typeof overlay.deltas !== "object") return { ...manualWeights };
  const locks = lockedKeys.length ? lockedKeys : overlay.lockedKeys || [];
  return applyWeightDeltas(manualWeights, overlay.deltas, locks);
}
