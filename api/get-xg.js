import { createClient } from '@vercel/kv';
import { calculateSyntheticXG } from './_utils/advancedMath.js';

// Configurăm manual clientul KV folosind numele exacte de variabile din screenshot-ul tău
const kv = createClient({
  url: process.env.STORAGEE_KV_REST_API_URL,
  token: process.env.STORAGEE_KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  // Setăm headere de CORS pentru a permite accesul din frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { fixtureId } = req.query;

  if (!fixtureId) {
    return res.status(400).json({ error: "fixtureId is missing" });
  }

  try {
    const cacheKey = `xg_v3_${fixtureId}`;
    
    // 1. Încercăm cache-ul (cu un try-catch separat ca să nu oprească tot fluxul)
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        console.log(`✅ Cache Hit pentru fixture ${fixtureId}`);
        return res.status(200).json(cached);
      }
    } catch (kvError) {
      console.error("KV Cache Error:", kvError.message);
    }

    // 2. Fetch de la API-FOOTBALL (folosind cheia APIFOOTBALL_KEY din screenshot)
    const apiUrl = `https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics?fixture=${fixtureId}`;
    const apiRes = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': process.env.APIFOOTBALL_KEY,
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
      }
    });

    const result = await apiRes.json();

    if (!result.response || result.response.length < 2) {
      console.warn(`⚠️ Statistici incomplete pentru meciul ${fixtureId}`);
      return res.status(404).json({ error: "Statistics not available yet for this match" });
    }

    // 3. Extragem datele și calculăm xG folosind motorul tău advancedMath
    const homeStats = result.response[0].statistics;
    const awayStats = result.response[1].statistics;

    const xGHome = calculateSyntheticXG(homeStats);
    const xGAway = calculateSyntheticXG(awayStats);

    const finalOutput = {
      fixtureId,
      homeXG: xGHome,
      awayXG: xGAway,
      updatedAt: new Date().toISOString()
    };

    // 4. Salvăm în cache (doar dacă avem date valide)
    try {
      await kv.set(cacheKey, finalOutput, { ex: 86400 });
    } catch (saveError) {
      console.error("Failed to save to Redis:", saveError.message);
    }

    return res.status(200).json(finalOutput);

  } catch (error) {
    console.error("🔴 Server Error 500:", error.message);
    return res.status(500).json({ 
      error: "Internal Server Error", 
      message: error.message 
    });
  }
}