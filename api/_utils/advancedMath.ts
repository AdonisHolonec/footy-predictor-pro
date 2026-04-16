// Calculează Valoarea Așteptată (EV)
// Returnează un procentaj (ex: 5.4 înseamnă un avantaj de +5.4% pe termen lung)
export function calculateEV(probability: number, odds: number): number {
  if (!probability || !odds || odds <= 1) return 0;
  
  // Transformăm probabilitatea din procente (ex: 60) în zecimale (0.6)
  const p = probability > 1 ? probability / 100 : probability;
  
  const ev = (p * odds) - 1;
  return Number((ev * 100).toFixed(2)); 
}

// Calculează Criteriul Kelly (Sfertul de Kelly pentru siguranță)
// Returnează procentul recomandat din banca totală (ex: 1.5 înseamnă pariază 1.5% din buget)
export function calculateKelly(probability: number, odds: number, fraction: number = 0.25): number {
  if (!probability || !odds || odds <= 1) return 0;

  const p = probability > 1 ? probability / 100 : probability;
  const q = 1 - p;
  const b = odds - 1; // Profitul net

  const kelly = (p * b - q) / b;
  
  // Dacă matematica spune că pariul e prost (kelly negativ), returnăm 0
  if (kelly <= 0) return 0; 
  
  return Number((kelly * fraction * 100).toFixed(2));
}