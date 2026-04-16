// Calculează Valoarea Așteptată (EV)
export function calculateEV(probability, odds) {
  if (!probability || !odds || odds <= 1) return 0;
  
  // Transformăm probabilitatea din procente (ex: 60) în zecimale (0.6)
  const p = probability > 1 ? probability / 100 : probability;
  
  const ev = (p * odds) - 1;
  return Number((ev * 100).toFixed(2)); 
}

// Calculează Criteriul Kelly (Sfertul de Kelly pentru siguranță)
export function calculateKelly(probability, odds, fraction = 0.25) {
  if (!probability || !odds || odds <= 1) return 0;

  const p = probability > 1 ? probability / 100 : probability;
  const q = 1 - p;
  const b = odds - 1; // Profitul net

  const kelly = (p * b - q) / b;
  
  // Dacă matematica spune că pariul e prost (kelly negativ), returnăm 0
  if (kelly <= 0) return 0; 
  
  return Number((kelly * fraction * 100).toFixed(2));
}