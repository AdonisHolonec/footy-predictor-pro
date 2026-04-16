import { kv } from '@vercel/kv';
import { calculateSyntheticXG } from './_utils/advancedMath.js';

export default async function handler(req, res) {
  const { fixtureId } = req.query; // ID-ul meciului primit din frontend

  try {
    // 1. Verificăm dacă avem deja xG-ul în Cache (Vercel KV)
    const cacheKey = `xg_data_${fixtureId}`;
    const cachedData = await kv.get(cacheKey);

    if (cachedData) {
      console.log("🚀 Date livrate din Cache (Redis)");
      return res.status(200).json(cachedData);
    }

    // 2. Dacă nu este în cache, chemăm API-FOOTBALL
    console.log("📡 Cerere nouă către API-FOOTBALL...");
    const response = await fetch(`https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics?fixture=${fixtureId}`, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
      }
    });

    const data = await response.json();
    
    // Extragem statisticile pentru ambele echipe
    const teamHomeStats = data.response[0]?.statistics;
    const teamAwayStats = data.response[1]?.statistics;

    // 3. Calculăm xG-ul folosind noul nostru motor advancedMath
    const xGHome = calculateSyntheticXG(teamHomeStats);
    const xGAway = calculateSyntheticXG(teamAwayStats);

    const result = {
      fixtureId,
      homeXG: xGHome,
      awayXG: xGAway,
      timestamp: Date.now()
    };

    // 4. Salvăm în Vercel KV pentru 24 de ore (86400 secunde)
    // Astfel, nu mai plătești API-ul pentru acest meci niciodată!
    await kv.set(cacheKey, result, { ex: 86400 });

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ error: "Eroare la procesarea xG" });
  }
}