/**
 * Module 7 — Weather.
 * Rain / wind / temperature / pitch. Adverse conditions reduce pace.
 * When no weather block is present → neutral.
 * Reads engineCtx.weather { tempC, windKmh, precipMm, condition }.
 */
import { contextResult, neutralResult, clamp, isNum } from "../ContextTypes.js";

export const id = "weather";
export const name = "Weather";

export function calculate(ctx) {
  const w = ctx?.weather;
  if (!w || typeof w !== "object") return neutralResult(id, name, "no_weather_data");

  const temp = Number(w.tempC);
  const wind = Number(w.windKmh);
  const precip = Number(w.precipMm);
  if (![temp, wind, precip].some(isNum)) {
    return neutralResult(id, name, "empty_weather_block");
  }

  let paceDrop = 0;
  const notes = [];
  if (isNum(precip) && precip > 2) {
    paceDrop += clamp((precip - 2) / 10, 0, 0.5);
    notes.push("rain");
  }
  if (isNum(wind) && wind > 25) {
    paceDrop += clamp((wind - 25) / 40, 0, 0.4);
    notes.push("wind");
  }
  if (isNum(temp) && (temp <= 2 || temp >= 32)) {
    paceDrop += 0.15;
    notes.push(temp <= 2 ? "cold" : "heat");
  }

  const pace = -clamp(paceDrop, 0, 1) * 0.8;
  const confidence = clamp(0.3 + (notes.length ? 0.2 : 0), 0, 0.6);
  const reason = notes.length ? `Adverse weather (${notes.join(", ")})` : "Weather benign";

  return {
    ...contextResult(id, name, {
      tilt: 0,
      pace,
      confidence,
      reason,
      details: {
        tempC: isNum(temp) ? temp : null,
        windKmh: isNum(wind) ? wind : null,
        precipMm: isNum(precip) ? precip : null,
        condition: w.condition || null,
        factors: notes
      }
    })
  };
}

export const WeatherContext = { id, name, calculate };
export default WeatherContext;
