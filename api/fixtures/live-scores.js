// api/fixtures/live-scores.js — lightweight status/score refresh for in-play fixtures.
import { getWithCache } from "../../server-utils/fetcher.js";

/** Server-side cache TTL; keeps API usage predictable while scores stay fresh enough for UI. */
const LIVE_SCORES_CACHE_TTL_SEC = 30;

function parseIds(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const parts = s.split(/[,]+/).map((x) => x.trim()).filter(Boolean);
  const nums = [];
  for (const p of parts) {
    const n = Number(p);
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  return [...new Set(nums)].slice(0, 24);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }
  const ids = parseIds(req.query.ids);
  if (!ids.length) {
    return res.status(400).json({ ok: false, error: "Parametrul ids lipsește sau e invalid (ex: ?ids=123,456)." });
  }
  const idsParam = ids.join("-");
  try {
    const r = await getWithCache("/fixtures", { ids: idsParam }, LIVE_SCORES_CACHE_TTL_SEC);
    if (!r.ok) {
      return res.status(502).json({ ok: false, error: typeof r.error === "string" ? r.error : "Upstream fixtures error." });
    }
    const rows = r.data?.response || [];
    const fixtures = rows.map((fx) => ({
      id: fx?.fixture?.id,
      status: fx?.fixture?.status?.short || "",
      score: {
        home: typeof fx?.goals?.home === "number" ? fx.goals.home : null,
        away: typeof fx?.goals?.away === "number" ? fx.goals.away : null
      }
    }));
    return res.status(200).json({
      ok: true,
      fixtures,
      cacheTtlSec: LIVE_SCORES_CACHE_TTL_SEC,
      fromCache: Boolean(r.fromCache)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Eroare internă." });
  }
}
