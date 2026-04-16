import { createClient } from "@supabase/supabase-js";

let cachedClient = null;

function readSupabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, serviceRoleKey };
}

export function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;

  const { url, serviceRoleKey } = readSupabaseEnv();
  if (!url || !serviceRoleKey) {
    return null;
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return cachedClient;
}

export function assertSupabaseConfigured() {
  const { url, serviceRoleKey } = readSupabaseEnv();
  if (!url || !serviceRoleKey) {
    const missing = [];
    if (!url) missing.push("SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    return {
      ok: false,
      error: `Supabase is not configured. Missing env: ${missing.join(", ")}`
    };
  }
  return { ok: true };
}
