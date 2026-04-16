import { assertSupabaseConfigured } from "./_utils/supabaseAdmin.js";
import { readPredictionsHistory } from "./_utils/predictionsHistory.js";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) {
    return res.status(500).json({ ok: false, error: supabaseConfig.error });
  }

  const days = Number(req.query.days || 30);
  const limit = Number(req.query.limit || 500);

  try {
    const { items, stats } = await readPredictionsHistory(days, limit);
    return res.status(200).json({
      ok: true,
      days: Math.max(1, Math.min(days || 30, 120)),
      stats,
      items
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "History read failed." });
  }
}
