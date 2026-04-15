// src/lib/types.ts

/** Chei "1-0", "2-1" etc. => procent / scor */
export type CorrectScoreMap = Record<string, number | string | null>;

export interface PredictionSlim {
  /** ex: "Combo Double chance : Petrolul Ploiesti or draw and -3.5 goals" */
  advice?: string | null;
  /** "Yes" | "No" | etc (poate lipsi) */
  btts?: string | null;
  /** "Yes" | "No" | etc (poate lipsi) */
  over25?: string | null;
  /** obiect map "scor" => procent, dacă e disponibil */
  correctScore?: CorrectScoreMap | null;
}

/** Model de bază pentru un meci în UI */
export interface UseFootyItem {
  fixtureId: number;
  leagueId: number;
  leagueName?: string;
  season?: number;

  dateUtc: string;       // ISO string
  timestamp: number;     // unix

  homeTeam: string;
  awayTeam: string;

  // raw data opțional
  providerRaw?: {
    predictions?: PredictionSlim;
    odds?: unknown;
  };

  // predicția normalizată pentru UI
  prediction?: PredictionSlim;
}

/** Tip utilitar ca să "adaugăm" predicția peste orice tip de Item */
export type WithPrediction<T> = T & {
  prediction?: PredictionSlim;
  providerRaw?: {
    predictions?: PredictionSlim;
    odds?: unknown;
  };
};
