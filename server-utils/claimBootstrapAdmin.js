import { getRequester } from "./authAdmin.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

function parseAdminEmailsFromEnv() {
  const raw = String(process.env.ADMIN_EMAILS || "");
  if (!raw.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Promotes profiles.role to admin when the authenticated user's email is listed in ADMIN_EMAILS.
 * Uses service role (bypasses RLS). Idempotent.
 */
export async function handleClaimBootstrapAdmin(req) {
  if (req.method !== "POST") {
    return { status: 405, body: { ok: false, error: "Metodă nepermisă." } };
  }

  const requester = await getRequester(req);
  if (!requester.ok) {
    return { status: requester.status || 401, body: { ok: false, error: requester.error } };
  }

  const email = String(requester.user?.email || "").toLowerCase();
  if (!email || !parseAdminEmailsFromEnv().has(email)) {
    return { status: 403, body: { ok: false, error: "Emailul nu este in lista ADMIN_EMAILS." } };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { status: 500, body: { ok: false, error: "Clientul Supabase admin nu este disponibil." } };
  }

  const userId = requester.user.id;

  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("role, is_blocked")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    return { status: 500, body: { ok: false, error: readError.message || "Nu am putut citi profilul." } };
  }
  if (!row) {
    return { status: 404, body: { ok: false, error: "Profil inexistent." } };
  }
  if (row.is_blocked) {
    return { status: 403, body: { ok: false, error: "Cont blocat." } };
  }
  if (row.role === "admin") {
    return { status: 200, body: { ok: true, promoted: false, reason: "already_admin" } };
  }
  if (row.role !== "user") {
    return { status: 200, body: { ok: true, promoted: false, reason: "unexpected_role" } };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ role: "admin" })
    .eq("user_id", userId)
    .eq("role", "user");

  if (updateError) {
    return { status: 500, body: { ok: false, error: updateError.message || "Actualizarea a eșuat." } };
  }

  return { status: 200, body: { ok: true, promoted: true } };
}
