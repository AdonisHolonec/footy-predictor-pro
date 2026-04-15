// src/lib/footy.ts  (sau fișierul tău de parsing)
// ...alte importuri
import { addProbsToMarket, pickTopByProb, OddsMarket } from "@/lib/oddsMath";

// Tipul pe care îl folosești pentru returnarea piețelor
export type UiMarkets = {
  btts?: OddsMarket;          // GG/NG
  over25?: OddsMarket;        // Peste/Sub 2.5
  doubleChance?: OddsMarket;  // Șansă dublă
  goalsHT?: OddsMarket;       // Goluri în prima repriză
  corners?: OddsMarket;       // Cornere total
  cards?: OddsMarket;         // Cartonașe total
  correctScore?: OddsMarket;  // Scor corect (toate opțiunile)
  correctScoreTop?: OddsMarket; // "Top scoruri" derivate (cele mai probabile)
};

// Exemplu de funcție care primește "raw" de la providerul tău
// și construiește piețele cu cote + probabilități:
export function buildUiMarketsFromRaw(raw: any): UiMarkets {
  const markets: UiMarkets = {};

  // ------------- EXEMPLE: construiește piațe din raw -------------
  // GG/NG
  const bttsVals = [
    raw?.btts_yes ? { value: "GG (Yes)", odd: raw.btts_yes } : null,
    raw?.btts_no  ? { value: "NGG (No)", odd: raw.btts_no } : null,
  ].filter(Boolean) as any[];

  if (bttsVals.length) {
    markets.btts = addProbsToMarket({
      name: "GG/NG",
      values: bttsVals,
    })!;
  }

  // Peste/Sub 2.5
  const over25Vals = [
    raw?.over_25 ? { value: "Peste 2.5 (Over)", odd: raw.over_25 } : null,
    raw?.under_25 ? { value: "Sub 2.5 (Under)", odd: raw.under_25 } : null,
  ].filter(Boolean) as any[];

  if (over25Vals.length) {
    markets.over25 = addProbsToMarket({
      name: "Peste 2.5",
      values: over25Vals,
    })!;
  }

  // Șansă dublă
  const dcVals = [
    raw?.dc_hd ? { value: "1X (Home/Draw)", odd: raw.dc_hd } : null,
    raw?.dc_da ? { value: "12 (Home/Away)", odd: raw.dc_da } : null,
    raw?.dc_ha ? { value: "X2 (Draw/Away)", odd: raw.dc_ha } : null,
  ].filter(Boolean) as any[];

  if (dcVals.length) {
    markets.doubleChance = addProbsToMarket({
      name: "Șansă dublă",
      values: dcVals,
    })!;
  }

  // Goluri 1st Half
  const htVals = [
    raw?.ht_over_05 ? { value: "Over 0.5", odd: raw.ht_over_05 } : null,
    raw?.ht_over_15 ? { value: "Over 1.5", odd: raw.ht_over_15 } : null,
  ].filter(Boolean) as any[];

  if (htVals.length) {
    markets.goalsHT = addProbsToMarket({
      name: "Goluri 1st Half",
      values: htVals,
    })!;
  }

  // Cornere total (opțional; dacă providerul oferă)
  const cornerVals = [
    raw?.corners_over_main ? { value: "Over (linia principală)", odd: raw.corners_over_main } : null,
    raw?.corners_under_main ? { value: "Under (linia principală)", odd: raw.corners_under_main } : null,
  ].filter(Boolean) as any[];

  if (cornerVals.length) {
    markets.corners = addProbsToMarket({
      name: "Total Cornere",
      values: cornerVals,
    })!;
  }

  // Cartonașe total (opțional)
  const cardsVals = [
    raw?.cards_over_main ? { value: "Over (linia principală)", odd: raw.cards_over_main } : null,
    raw?.cards_under_main ? { value: "Under (linia principală)", odd: raw.cards_under_main } : null,
  ].filter(Boolean) as any[];

  if (cardsVals.length) {
    markets.cards = addProbsToMarket({
      name: "Total Cartonașe",
      values: cardsVals,
    })!;
  }

  // Scor corect — o listă de opțiuni (extragă-le din provider)
  const csVals = Array.isArray(raw?.correct_score)
    ? raw.correct_score
        .map((r: any) => ({
          value: r.score,       // ex: "4:1"
          odd:   r.odd          // ex: 351
        }))
        .filter((x: any) => x.value && x.odd)
    : [];

  if (csVals.length) {
    markets.correctScore = addProbsToMarket({
      name: "Scor corect",
      values: csVals,
    })!;

    // Top 4-5 scoruri cu probabilitatea cea mai mare
    markets.correctScoreTop = {
      name: "Scor corect (top)",
      values: pickTopByProb(markets.correctScore.values, 5),
    };
  }

  return markets;
}
