export type PredictFlowMessages = {
  warmRateLimit: string;
  predictRateLimit: string;
  warmFailed: (statusCode: number, backend: string) => string;
  predictFailed: (statusCode: number, backend: string) => string;
  warmException: (message: string) => string;
  predictException: (message: string) => string;
};

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

export const USER_PREDICT_FLOW_MESSAGES: PredictFlowMessages = {
  warmRateLimit: "Cererea Warm a fost limitată temporar de server.",
  predictRateLimit: "Cererea Predict a fost limitată temporar de server.",
  warmFailed: (statusCode, backend) =>
    backend
      ? `Warm a eșuat (HTTP ${statusCode}) · ${backend}`
      : `Warm a eșuat (HTTP ${statusCode}). Limita nu e neapărat atinsă; încearcă din nou sau verifică rețeaua.`,
  predictFailed: (statusCode, backend) =>
    backend
      ? `Predict a eșuat (HTTP ${statusCode}) · ${backend}`
      : `Predict a eșuat (HTTP ${statusCode}). Limita nu e neapărat atinsă; încearcă din nou sau verifică rețeaua.`,
  warmException: (message) => message || "Warm a esuat.",
  predictException: (message) => message || "Predict a esuat."
};
