import { getSupabaseAdmin } from "./supabaseAdmin.js";

export function parseAdminEmails() {
  const raw = [process.env.ADMIN_EMAILS, process.env.VITE_ADMIN_EMAILS]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(",");
  if (!raw.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function readBearer(req) {
  const raw = req.headers?.authorization || "";
  const match = String(raw).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

export async function getRequester(req) {
  const token = readBearer(req);
  if (!token) return { ok: false, status: 401, error: "Lipsește token-ul de autorizare." };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, status: 500, error: "Clientul Supabase admin nu este disponibil." };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { ok: false, status: 401, error: "Token invalid sau expirat." };
  return { ok: true, user: data.user, token };
}

export async function assertAdmin(req) {
  const requester = await getRequester(req);
  if (!requester.ok) return requester;
  const supabase = getSupabaseAdmin();
  const adminEmailSet = parseAdminEmails();
  const requesterEmail = String(requester.user?.email || "").toLowerCase();
  const isBootstrapAdmin = requesterEmail ? adminEmailSet.has(requesterEmail) : false;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, is_blocked")
    .eq("user_id", requester.user.id)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message || "Nu am putut încărca profilul solicitantului." };
  if (profile?.is_blocked) return { ok: false, status: 403, error: "Administratorii blocați nu pot efectua această acțiune." };
  if (profile?.role === "admin" || isBootstrapAdmin) {
    return { ok: true, user: requester.user };
  }
  return { ok: false, status: 403, error: "Este necesar acces de administrator." };
}
