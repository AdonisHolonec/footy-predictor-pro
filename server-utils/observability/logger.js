/**
 * Structured JSON logging for Vercel / serverless stdout.
 * One line per event — filterable in log drains.
 */

function safeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    if (v instanceof Error) {
      out[k] = { message: v.message, name: v.name };
      continue;
    }
    out[k] = v;
  }
  return out;
}

function emit(level, event, meta = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event: String(event || "log"),
    service: "footy-predictor",
    ...safeMeta(meta)
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
  return line;
}

export function logInfo(event, meta) {
  return emit("info", event, meta);
}

export function logWarn(event, meta) {
  return emit("warn", event, meta);
}

export function logError(event, meta) {
  return emit("error", event, meta);
}

export const structuredLog = { info: logInfo, warn: logWarn, error: logError };
