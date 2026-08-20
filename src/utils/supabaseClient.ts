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

/**
 * The persisted session, read straight from storage.
 *
 * The distinction L2 needs: a restore that TIMED OUT tells us nothing about
 * whether the user is signed in, while auth-js removing the session from
 * storage means it has actually decided the credential is dead. Storage is
 * therefore the tie-breaker, and reading it never touches the network.
 *
 * Same key auth-js uses, so this observes its state rather than inventing one.
 */
export function readPersistedSession(): { access_token?: string; user?: { id?: string } } | null {
  if (!supabaseUrl) return null;
  try {
    const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: string; user?: { id?: string } } | null;
    if (!parsed || typeof parsed !== "object") return null;
    // A record without a user is not a session anyone can be restored into.
    return parsed.access_token && parsed.user?.id ? parsed : null;
  } catch {
    // Unparseable or unavailable storage is simply "no evidence of a session".
    return null;
  }
}

export type SlimSupabaseClient = ReturnType<typeof createSlimClient>;

export const supabase = isSupabaseConfigured
  ? createSlimClient(supabaseUrl!, supabaseAnonKey!)
  : null;
