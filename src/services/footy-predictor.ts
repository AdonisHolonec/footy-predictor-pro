// src/services/footy-predictor.ts
import { getPredictions } from "../lib/api";

/** Obține datele pentru UI (apelat din componente/hook-uri). */
export async function getFootyPredictorData() {
  return getPredictions();
}
