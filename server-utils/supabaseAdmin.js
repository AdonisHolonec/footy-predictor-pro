import { createClient } from "@supabase/supabase-js";

import { instrumentFetch } from "./observability/transportTiming.js";

let cachedClient = null;

function readSupabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, serviceRoleKey };
}

/** The host the transport phases belong to; never logged, only compared. */
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;
  const { url, serviceRoleKey } = readSupabaseEnv();
  if (!url || !serviceRoleKey) return null;
  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // D4: the innermost fetch layer, for measurement only. supabase-js applies
    // auth and headers in `fetchWithAuth` BEFORE calling this, so the wrapper
    // sees a fully prepared (input, init) pair and forwards both unchanged. No
    // dispatcher, agent, keep-alive or timeout is configured here — omitting
    // `global.fetch` and passing this wrapper reach the same `globalThis.fetch`.
    global: { fetch: instrumentFetch(undefined, { hostname: hostnameOf(url) }) }
  });
  return cachedClient;
}

export function assertSupabaseConfigured() {
  const { url, serviceRoleKey } = readSupabaseEnv();
  if (!url || !serviceRoleKey) {
    const missing = [];
    if (!url) missing.push("SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    return { ok: false, error: `Supabase nu este configurat. Lipsesc variabilele de mediu: ${missing.join(", ")}` };
  }
  return { ok: true };
}
