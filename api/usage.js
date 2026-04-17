import { getApiUsage, getApiUsageHistory } from "./_utils/fetcher.js";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const days = Math.max(1, Math.min(Number(req.query.days) || 7, 60));
  const today = await getApiUsage();
  const yesterday = await getApiUsage(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const history = await getApiUsageHistory(days);

  return res.status(200).json({
    ok: true,
    today,
    yesterday,
    history
  });
}
