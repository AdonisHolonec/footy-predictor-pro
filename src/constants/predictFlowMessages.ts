import { translate, readStoredLocale, type Locale } from "../i18n";

export type PredictFlowMessages = {
  warmRateLimit: string;
  predictRateLimit: string;
  warmFailed: (statusCode: number, backend: string) => string;
  predictFailed: (statusCode: number, backend: string) => string;
  warmException: (message: string) => string;
  predictException: (message: string) => string;
};

function msgs(locale: Locale): PredictFlowMessages {
  return {
    warmRateLimit: translate(locale, "flow.warmRateLimit"),
    predictRateLimit: translate(locale, "flow.predictRateLimit"),
    warmFailed: (statusCode, backend) =>
      backend
        ? translate(locale, "flow.warmFailedBackend", { code: statusCode, backend })
        : translate(locale, "flow.warmFailed", { code: statusCode }),
    predictFailed: (statusCode, backend) =>
      backend
        ? translate(locale, "flow.predictFailedBackend", { code: statusCode, backend })
        : translate(locale, "flow.predictFailed", { code: statusCode }),
    warmException: (message) => message || translate(locale, "flow.warmException"),
    predictException: (message) => message || translate(locale, "flow.predictException")
  };
}

/** Locale-aware user messages (reads current stored locale at call time for factories). */
export const USER_PREDICT_FLOW_MESSAGES: PredictFlowMessages = {
  get warmRateLimit() {
    return msgs(readStoredLocale()).warmRateLimit;
  },
  get predictRateLimit() {
    return msgs(readStoredLocale()).predictRateLimit;
  },
  warmFailed: (statusCode, backend) => msgs(readStoredLocale()).warmFailed(statusCode, backend),
  predictFailed: (statusCode, backend) => msgs(readStoredLocale()).predictFailed(statusCode, backend),
  warmException: (message) => msgs(readStoredLocale()).warmException(message),
  predictException: (message) => msgs(readStoredLocale()).predictException(message)
};

/** Admin keeps RO technical messages. */
export const ADMIN_PREDICT_FLOW_MESSAGES: PredictFlowMessages = {
  warmRateLimit: "Limită zilnică Warm atinsă.",
  predictRateLimit: "Limită zilnică Predict atinsă.",
  warmFailed: (statusCode, backend) =>
    backend ? `Warm a eșuat (HTTP ${statusCode}) · ${backend}` : `Warm a eșuat (HTTP ${statusCode}).`,
  predictFailed: (statusCode, backend) =>
    backend ? `Predict a eșuat (HTTP ${statusCode}) · ${backend}` : `Predict a eșuat (HTTP ${statusCode}).`,
  warmException: (message) => `Eroare: ${message}`,
  predictException: (message) => `Eroare: ${message}`
};
