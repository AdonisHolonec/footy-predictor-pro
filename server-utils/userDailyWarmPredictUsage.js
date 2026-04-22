import { parseAdminEmails, readBearer } from "./authAdmin.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const USAGE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseUsageDayFromQuery(query) {
  const raw = String(query?.usageDay || "").trim().slice(0, 10);
  if (!USAGE_DAY_RE.test(raw)) return null;
  return raw;
}

/**
 * Resolves whether the request is anonymous or authenticated usage tracking.
 * If Authorization is present, token must be valid and usageDay query param is required.
 */
export async function resolveAuthenticatedUsageContext(req) {
  const token = readBearer(req);
  if (!token) return { anonymous: true };

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { anonymous: false, error: { status: 503, body: { ok: false, error: "Tracking-ul de usage nu este disponibil (Supabase)." } } };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { anonymous: false, error: { status: 401, body: { ok: false, error: "Token invalid sau expirat." } } };
  }

  const usageDay = parseUsageDayFromQuery(req.query);
  if (!usageDay) {
    return {
      anonymous: false,
      error: {
        status: 400,
        body: { ok: false, error: "usageDay (YYYY-MM-DD) este obligatoriu când se trimite Authorization." }
      }
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_blocked")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (profileError) {
    return {
      anonymous: false,
      error: { status: 500, body: { ok: false, error: profileError.message || "Nu am putut încărca profilul." } }
    };
  }
  if (profile?.is_blocked) {
    return { anonymous: false, error: { status: 403, body: { ok: false, error: "Cont blocat." } } };
  }

  const userEmail = data.user?.email ? String(data.user.email).toLowerCase() : "";

  return { anonymous: false, userId: data.user.id, usageDay, userEmail };
}

/** Admins (DB role or bootstrap email list) are not subject to daily warm/predict quotas. */
export async function isWarmPredictQuotaExempt(userId, emailLower) {
  const sb = getSupabaseAdmin();
  if (!sb) return false;
  const { data: profile } = await sb.from("profiles").select("role").eq("user_id", userId).maybeSingle();
  if (profile?.role === "admin") return true;
  const adminSet = parseAdminEmails();
  const e = String(emailLower || "").toLowerCase();
  return Boolean(e && adminSet.has(e));
}

export async function peekWarmPredictUsage(userId, usageDay) {
  const sb = getSupabaseAdmin();
  if (!sb) return { warm: 0, predict: 0 };
  const { data, error } = await sb
    .from("user_daily_warm_predict_usage")
    .select("warm_count, predict_count")
    .eq("user_id", userId)
    .eq("usage_day", usageDay)
    .maybeSingle();
  if (error) {
    console.error("[usage peek]", error.message);
    return { warm: 0, predict: 0 };
  }
  return { warm: Number(data?.warm_count ?? 0), predict: Number(data?.predict_count ?? 0) };
}

export async function commitWarmPredictIncrement(userId, usageDay, kind, max = 3) {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "no_supabase" };
  const { data, error } = await sb.rpc("increment_warm_predict_usage", {
    p_user_id: userId,
    p_day: usageDay,
    p_kind: kind,
    p_max: max
  });
  if (error) {
    console.error("[usage increment]", error.message);
    return { ok: false, reason: error.message };
  }
  return data && typeof data === "object" ? data : { ok: false };
}

/** After a successful predict quota increment, if persistence fails, restore predict_count (best-effort). */
export async function rollbackPredictIncrement(userId, usageDay) {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "no_supabase" };
  const { data, error } = await sb.rpc("rollback_predict_increment", {
    p_user_id: userId,
    p_day: usageDay
  });
  if (error) {
    console.error("[usage rollback]", error.message);
    return { ok: false, reason: error.message };
  }
  return data && typeof data === "object" ? data : { ok: false };
}
