// src/services/predictions.ts
import { getPredictions } from "../lib/api";

export async function fetchPredictions() {
  return getPredictions();
}
