import { clamp, result, neutral } from "./helpers.js";

/**
 * Weather impact on total goals (symmetric sides).
 * Neutral until PredictionContext.weather is populated.
 */
export function calculate(ctx) {
  const w = ctx.weather;
  if (!w || (w.tempC == null && w.windKmh == null && w.precipMm == null)) {
    return neutral({ reason: "weather_not_provided", extensionPoint: true });
  }

  let boost = 1;
  const temp = Number(w.tempC);
  const wind = Number(w.windKmh);
  const precip = Number(w.precipMm);

  if (Number.isFinite(temp) && (temp < 2 || temp > 32)) boost *= 0.97;
  if (Number.isFinite(wind) && wind > 40) boost *= 0.96;
  if (Number.isFinite(precip) && precip > 5) boost *= 0.95;

  boost = clamp(boost, 0.92, 1.05);
  return result(boost, 0.35, {
    home: boost,
    away: boost,
    tempC: Number.isFinite(temp) ? temp : null,
    windKmh: Number.isFinite(wind) ? wind : null,
    precipMm: Number.isFinite(precip) ? precip : null,
    condition: w.condition || null,
    available: true
  });
}

export const WeatherEngine = { calculate, name: "weather" };
