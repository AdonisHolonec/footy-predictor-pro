import { getRequester } from "../server-utils/authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const requester = await getRequester(req);
  if (!requester.ok) {
    return res.status(requester.status || 401).json({ ok: false, error: requester.error });
  }

  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase unavailable." });

  let body = req.body || {};
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body || "{}");
    } catch {
      body = {};
    }
  }
  const tier = String(body.tier || "").toLowerCase();
  if (!["premium", "ultra"].includes(tier)) {
    return res.status(400).json({ ok: false, error: "Trial tier invalid. Use premium or ultra." });
  }

  const trialField = tier === "premium" ? "premium_trial_activated_at" : "ultra_trial_activated_at";

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, premium_trial_activated_at, ultra_trial_activated_at")
    .eq("user_id", requester.user.id)
    .maybeSingle();
  if (profileError) return res.status(500).json({ ok: false, error: profileError.message });
  if (!profile) return res.status(404).json({ ok: false, error: "Profile not found." });
  if (profile[trialField]) {
    return res.status(409).json({ ok: false, error: "Acest trial a fost deja folosit." });
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ [trialField]: nowIso })
    .eq("user_id", requester.user.id);
  if (updateError) {
    return res.status(500).json({ ok: false, error: updateError.message });
  }

  return res.status(200).json({
    ok: true,
    tier,
    activatedAt: nowIso,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  });
}
