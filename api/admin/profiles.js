import { assertSupabaseConfigured, getSupabaseAdmin } from "../../server-utils/supabaseAdmin.js";
import { assertAdmin } from "../../server-utils/authAdmin.js";

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const config = assertSupabaseConfigured();
  if (!config.ok) {
    return res.status(500).json({ ok: false, error: config.error });
  }

  const adminCheck = await assertAdmin(req);
  if (!adminCheck.ok) {
    return res.status(adminCheck.status || 403).json({ ok: false, error: adminCheck.error });
  }

  const supabase = getSupabaseAdmin();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, role, favorite_leagues, is_blocked, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      return res.status(200).json({ ok: true, items: data || [] });
    }

    const body = parseBody(req);
    const userId = String(body.userId || "").trim();
    const role = body.role;
    const isBlocked = body.isBlocked;

    if (!userId) {
      return res.status(400).json({ ok: false, error: "userId is required." });
    }

    const nextUpdate = {};
    if (role === "user" || role === "admin") nextUpdate.role = role;
    if (typeof isBlocked === "boolean") nextUpdate.is_blocked = isBlocked;

    if (!Object.keys(nextUpdate).length) {
      return res.status(400).json({ ok: false, error: "No valid fields to update." });
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(nextUpdate)
      .eq("user_id", userId)
      .select("user_id, role, favorite_leagues, is_blocked, created_at, updated_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ ok: false, error: "Profile not found." });
    }
    return res.status(200).json({ ok: true, profile: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Admin profiles request failed." });
  }
}
