#!/usr/bin/env node
/**
 * CLI: run Auto Calibration Engine against settled prediction history.
 *
 *   node --env-file=.env.local scripts/fitAutoCalibration.js
 *
 * Never overwrites env-configured manual weights — stores overlays only.
 */

import { runAutoCalibration } from "../server-utils/calibration/AutoCalibrationEngine.js";
import { MODEL_VERSION } from "../server-utils/modelConstants.js";

const modelVersion = process.env.CALIBRATION_MODEL_VERSION || process.env.DAILY_ML_MODEL_VERSION || MODEL_VERSION;

const result = await runAutoCalibration({
  modelVersion,
  mode: "cli",
  persist: true
});

console.log(
  JSON.stringify(
    {
      ok: result.ok,
      skipped: result.skipped || false,
      reason: result.reason || null,
      modelVersion: result.modelVersion,
      summary: result.summary,
      report: {
        nRows: result.report?.nRows,
        hitRate: result.report?.hitRate,
        ece: result.report?.predictedVsActual?.ece,
        brier1x2: result.report?.predictedVsActual?.brier1x2,
        manualLocks: result.report?.manualLocks,
        overlayDeltas: {
          confidence: result.fitted?.confidence?.deltas,
          feature_importance: result.fitted?.feature_importance?.deltas,
          prediction: result.fitted?.prediction?.deltas
        }
      }
    },
    null,
    2
  )
);

process.exit(result.ok || result.skipped ? 0 : 1);
