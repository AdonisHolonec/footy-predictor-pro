// utils/advancedMath.js

/**
 * 1. Calculul xG-ului Sintetic (Pseudo-xG)
 */
export const calculateSyntheticXG = (statistics) => {
  if (!statistics || !Array.isArray(statistics) || statistics.length === 0) return 0;
  let shotsInsideBox = 0;
  let shotsOutsideBox = 0;
  let corners = 0;
  let penalties = 0; 

  statistics.forEach((stat) => {
    const val = (stat.value === null || stat.value === undefined) ? 0 : Number(stat.value);
    const safeVal = isNaN(val) ? 0 : val;
    switch (stat.type) {
      case 'Shots insidebox': shotsInsideBox = safeVal; break;
      case 'Shots outsidebox': shotsOutsideBox = safeVal; break;
      case 'Corner Kicks': corners = safeVal; break;
    }
  });

  const xG = (shotsInsideBox * 0.15) + (shotsOutsideBox * 0.03) + (corners * 0.03) + (penalties * 0.76);
  return Number(xG.toFixed(2));
};

/**
 * 2. Ponderarea Formei
 */
export const calculateWeightedXG = (xGHistory) => {
  if (!xGHistory || xGHistory.length === 0) return 0;
  if (xGHistory.length < 3) {
    return xGHistory.reduce((a, b) => a + b, 0) / xGHistory.length;
  }
  const recent2 = xGHistory.slice(-2);
  const avgRecent = recent2.reduce((a, b) => a + b, 0) / 2;
  const avgTotal = xGHistory.reduce((a, b) => a + b, 0) / xGHistory.length;
  const weightedXG = (avgTotal * 0.4) + (avgRecent * 0.6);
  return Number(weightedXG.toFixed(2));
};

/**
 * 3. Distribuția Poisson
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
 * 4. Expected Value (EV)
 */
export const calculateEV = (probability, odds) => {
  const ev = (probability * odds) - 1;
  return Number((ev * 100).toFixed(2));
};

/**
 * 5. Sfertul de Kelly Adaptiv (Updated: Max 3%)
 */
export const calculateKellyQuarter = (probability, odds, isHighConfidence = true) => {
  const q = 1 - probability;
  const b = odds - 1;
  if (b <= 0) return 0;
  const kellyFull = ((b * probability) - q) / b;
  if (kellyFull <= 0) return 0; 
  const fraction = isHighConfidence ? 0.25 : 0.15;
  const recommendedStake = (kellyFull * fraction) * 100; 
  return Math.min(Number(recommendedStake.toFixed(2)), 3.00); 
};

/**
 * 6. Verificare Value Bet
 */
export const isValueBet = (probability, odds, threshold = 1.10) => {
  const ev = probability * odds;
  const isCotaValoroasa = odds >= 1.45;
  const isProbabilitateRealista = probability >= 0.25;
  return ev >= threshold && isCotaValoroasa && isProbabilitateRealista;
};

/**
 * 7. RAFINAREA FORMEI (Luck Factor) - NOU
 */
export const adjustLambdaByEfficiency = (actualGoals, xG) => {
  if (!xG || xG <= 0) return actualGoals;
  const adjusted = (actualGoals + xG) / 2;
  return Number(adjusted.toFixed(2));
};