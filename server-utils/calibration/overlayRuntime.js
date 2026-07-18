/**
 * Process-local active overlays for sync weight getters.
 * Populated by predict / cron via refreshAutoCalibrationOverlays().
 */

import { loadActiveOverlays, invalidateAutoCalibrationCache } from "./overlayStore.js";
import { MODEL_VERSION } from "../modelConstants.js";

let runtime = { modelVersion: null, byKind: {}, loadedAt: 0 };

export function getRuntimeOverlay(kind) {
  if (!overlaysEnabled()) return null;
  return runtime.byKind?.[kind] || null;
}

export function getRuntimeOverlays() {
  return runtime.byKind || {};
}

function overlaysEnabled() {
  if (typeof process === "undefined") return true;
  const raw = process.env?.AUTO_CALIB_OVERLAY_ENABLED;
  if (raw === undefined || raw === "") return true;
  return !["0", "false", "off", "no"].includes(String(raw).toLowerCase());
}

export function setRuntimeOverlays(byKind, modelVersion = null) {
  runtime = {
    modelVersion: modelVersion || runtime.modelVersion,
    byKind: byKind || {},
    loadedAt: Date.now()
  };
}

export async function refreshAutoCalibrationOverlays(modelVersion = MODEL_VERSION) {
  if (!overlaysEnabled()) {
    setRuntimeOverlays({}, modelVersion);
    return {};
  }
  const byKind = await loadActiveOverlays(modelVersion);
  setRuntimeOverlays(byKind, modelVersion);
  return byKind;
}

export function clearRuntimeOverlays() {
  invalidateAutoCalibrationCache();
  setRuntimeOverlays({}, null);
}
