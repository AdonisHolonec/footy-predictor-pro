import { AuthClient } from "@supabase/auth-js";
import { PostgrestClient } from "@supabase/postgrest-js";
import { AUTH_REQUEST_TIMEOUT_MS, createTimeoutFetch } from "./authTimeout";

// Client slim: aplicația folosește doar auth + PostgREST, dar `createClient`
// din @supabase/supabase-js importă static și realtime, storage, functions și
// iceberg (~83 kB minificat în chunk-ul `index`). Construim clientul direct din
// sub-pachetele necesare, replicând comportamentul din supabase-js v2.110
// (src/SupabaseClient.ts + src/lib/fetch.ts):
//  - același storage key (`sb-<project-ref>-auth-token`), ca sesiunile
//    existente din localStorage să rămână valide;
//  - același fallback `Authorization: Bearer <token sesiune ?? cheie anon>`
//    injectat per-request pe PostgREST, deci RLS vede userul curent și după
//    un token refresh.

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?.trim()
  .replace(/\/$/, "");
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function createSlimClient(url: string, anonKey: string) {
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

  /*
    auth-js 2.110.7 ships no AbortController and no setTimeout in its fetch
    layer, so a stalled GoTrue request is a promise that never settles. Injecting
    the deadline here bounds every auth call — sign-in, getUser, refresh — at the
    transport, without touching URL, headers, JWT handling or storage.
  */
  const boundedFetch = createTimeoutFetch(AUTH_REQUEST_TIMEOUT_MS);

  const auth = new AuthClient({
    url: `${url}/auth/v1`,
    headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
    storageKey,
    fetch: boundedFetch,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "implicit"
  });

  const fetchWithSessionToken: typeof fetch = async (input, init) => {
    const { data } = await auth.getSession();
    const token = data.session?.access_token ?? anonKey;
    const headers = new Headers(init?.headers);
    if (!headers.has("apikey")) headers.set("apikey", anonKey);
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    /*
      Bounded too: this wrapper awaits getSession() before every PostgREST
      request, so an auth stall already propagates here. A profile read that
      never settles is what kept login() past signInWithPassword.
    */
    return boundedFetch(input, { ...init, headers });
  };

  const rest = new PostgrestClient(`${url}/rest/v1`, {
    schema: "public",
    fetch: fetchWithSessionToken
  });

  return {
    auth,
    from: (relation: string) => rest.from(relation)
  };
}

export type SlimSupabaseClient = ReturnType<typeof createSlimClient>;

export const supabase = isSupabaseConfigured
  ? createSlimClient(supabaseUrl!, supabaseAnonKey!)
  : null;
