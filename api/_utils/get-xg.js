import { createClient } from '@vercel/kv';
import { calculateSyntheticXG } from './_utils/advancedMath.js';

// Cream clientul manual pentru a folosi numele tale specifice de variabile (cu STORAGEE)
const kv = createClient({
  url: process.env.STORAGEE_KV_REST_API_URL,
  token: process.env.STORAGEE_KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  const { fixtureId } = req.query;

  if (!fixtureId) {
    return res.status(400).json({ error: "fixtureId este obligatoriu" });
  }

  try {
    const cacheKey = `xg_data_${fixtureId}`;
    
    // 1. Încercăm să luăm din Cache
    try {
      const cachedData = await kv.get(cacheKey);
      if (cachedData) {
        return res.status(200).json(cachedData);
      }
    } catch (redisError) {
      console.error("Redis Error:", redisError);
      // Mergem mai departe chiar dacă Redis eșuează, ca să nu blocăm aplicația
    }

    // 2. Apel către API-FOOTBALL (folosind cheia corectă din screenshot)
    const response = await fetch(`https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics?fixture=${fixtureId}`, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': process.env.APIFOOTBALL_KEY, // Corectat conform screenshot
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
      }
    });

    const data = await response.json();

    if (!data.response || data.response.length === 0) {
      return res.status(404).json({ error: "Nu s-au găsit statistici pentru acest meci" });
    }
    
    const teamHomeStats = data.response[0]?.statistics;
    const teamAwayStats = data.response[1]?.statistics;

    const xGHome = calculateSyntheticXG(teamHomeStats);
    const xGAway = calculateSyntheticXG(teamAwayStats);

    const result = {
      fixtureId,
      homeXG: xGHome,
      awayXG: xGAway,
      timestamp: Date.now(),
      source: 'api'
    };

    // 3. Salvăm în Cache (24h)
    try {
      await kv.set(cacheKey, result, { ex: 86400 });
    } catch (cacheError) {
      console.error("Failed to save to cache:", cacheError);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: "Eroare internă", details: error.message });
  }
}