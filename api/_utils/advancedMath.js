// utils/advancedMath.js

/**
 * Calculul xG-ului Sintetic (Pseudo-xG)
 * Bazat pe statisticile oficiale API-FOOTBALL
 */
export const calculateSyntheticXG = (statistics) => {
  // Verificăm dacă avem un array valid
  if (!statistics || !Array.isArray(statistics) || statistics.length === 0) return 0;

  let shotsInsideBox = 0;
  let shotsOutsideBox = 0;
  let corners = 0;
  const penalties = 0; // Se poate popula ulterior din fixtures/events

  statistics.forEach((stat) => {
    // Extragere sigură a valorii (API-ul poate trimite null sau string)
    const val = (stat.value === null || stat.value === undefined) ? 0 : Number(stat.value);
    const safeVal = isNaN(val) ? 0 : val;

    // Mapare pe tipurile de date din API-FOOTBALL
    switch (stat.type) {
      case 'Shots insidebox':
        shotsInsideBox = safeVal;
        break;
      case 'Shots outsidebox':
        shotsOutsideBox = safeVal;
        break;
      case 'Corner Kicks':
        corners = safeVal;
        break;
    }
  });

  // Formula xG calibrată pentru precizie
  const xG = (shotsInsideBox * 0.15) + (shotsOutsideBox * 0.03) + (corners * 0.03) + (penalties * 0.76);
  
  return Number(xG.toFixed(2));
};

/**
 * Distribuția Poisson
 */
const factorial = (n) => {
  if (n === 0 || n === 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
};

export const getPoissonProbability = (lambda, k) => {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
};

/**
 * Expected Value (EV)
 */
export const calculateEV = (probability, odds) => {
  const ev = (probability * odds) - 1;
  return Number((ev * 100).toFixed(2));
};

/**
 * Sfertul de Kelly
 */
export const calculateKellyQuarter = (probability, odds) => {
  const q = 1 - probability;
  const b = odds - 1;
  
  if (b <= 0) return 0; // Evităm împărțirea la zero sau cote invalide

  const kellyFull = ((b * probability) - q) / b;
  
  if (kellyFull <= 0) return 0; 
  
  const kellyQuarter = (kellyFull / 4) * 100; 
  return Math.min(Number(kellyQuarter.toFixed(2)), 5.00); 
};

/**
 * Verificare Value Bet
 */
export const isValueBet = (probability, odds, threshold = 1.15) => {
  return (probability * odds) >= threshold;
};