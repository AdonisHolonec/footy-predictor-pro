import { assertSupabaseConfigured, getSupabaseAdmin } from "../../server-utils/supabaseAdmin.js";
import { assertAdmin } from "../../server-utils/authAdmin.js";
import { parseUsageDayFromQuery } from "../../server-utils/userDailyWarmPredictUsage.js";

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
  const requesterId = adminCheck.user?.id;

  const supabase = getSupabaseAdmin();

  try {
    if (req.method === "GET") {
      const includeWarmPredictUsage = String(req.query.includeWarmPredictUsage || "") === "1";
      const usageDay = parseUsageDayFromQuery(req.query);

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, role, favorite_leagues, is_blocked, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      let items = data || [];

      if (includeWarmPredictUsage) {
        if (!usageDay) {
          return res.status(400).json({
            ok: false,
            error: "usageDay (YYYY-MM-DD) is required when includeWarmPredictUsage=1."
          });
        }
        const { data: usageRows, error: usageError } = await supabase
          .from("user_daily_warm_predict_usage")
          .select("user_id, warm_count, predict_count")
          .eq("usage_day", usageDay);
        if (usageError) throw usageError;
        const byUser = new Map((usageRows || []).map((r) => [r.user_id, r]));
        items = items.map((p) => {
          const u = byUser.get(p.user_id);
          return {
            ...p,
            warmPredictUsage: {
              usageDay,
              warm: u ? Number(u.warm_count) : 0,
              predict: u ? Number(u.predict_count) : 0
            }
          };
        });
      }

      return res.status(200).json({ ok: true, items });
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

    // Avoid accidental self lock-out from the admin workspace.
    if (requesterId && userId === requesterId) {
      if (nextUpdate.is_blocked === true) {
        return res.status(400).json({ ok: false, error: "Nu te poti bloca pe tine insuti." });
      }
      if (nextUpdate.role === "user") {
        return res.status(400).json({ ok: false, error: "Nu iti poti elimina propriul rol de admin." });
      }
    }

    // Keep at least one active admin account.
    if (nextUpdate.role === "user" || nextUpdate.is_blocked === true) {
      const { data: targetProfile, error: targetProfileError } = await supabase
        .from("profiles")
        .select("user_id, role, is_blocked")
        .eq("user_id", userId)
        .maybeSingle();
      if (targetProfileError) throw targetProfileError;
      const targetIsActiveAdmin = targetProfile?.role === "admin" && !targetProfile?.is_blocked;
      if (targetIsActiveAdmin) {
        const { data: activeAdmins, error: activeAdminsError } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("role", "admin")
          .eq("is_blocked", false);
        if (activeAdminsError) throw activeAdminsError;
        if ((activeAdmins || []).length <= 1) {
          return res.status(400).json({ ok: false, error: "Trebuie sa existe cel putin un admin activ." });
        }
      }
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
