import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from "@supabase/supabase-js";
import type { User } from "../types";
import { localCalendarDateKey } from "../utils/appUtils";
import { isSupabaseConfigured, readPersistedSession, supabase } from "../utils/supabaseClient";
import {
  AUTH_REQUEST_TIMEOUT_MS,
  AUTH_TIMEOUT_MESSAGE_KEY,
  SESSION_RESTORE_TIMEOUT_MS,
  SessionRestoreTimeoutError,
  createTimeoutFetch,
  isAuthTimeoutError,
  isSessionRestoreTimeoutError,
  withDeadline
} from "../utils/authTimeout";

/** One deadline for the app-level auth traffic that does not go through auth-js. */
const boundedFetch = createTimeoutFetch(AUTH_REQUEST_TIMEOUT_MS);

type ProfileRow = {
  user_id: string;
  role: "user" | "admin";
  favorite_leagues: number[] | null;
  is_blocked: boolean | null;
  notify_safe?: boolean | null;
  notify_value?: boolean | null;
  notify_email?: boolean | null;
  notify_email_consent_at?: string | null;
  onboarding_completed?: boolean | null;
  tier?: "free" | "premium" | "ultra" | null;
  subscription_expires_at?: string | null;
  premium_trial_activated_at?: string | null;
  ultra_trial_activated_at?: string | null;
};

type ManagedProfile = {
  userId: string;
  email?: string | null;
  role: "user" | "admin";
  tier?: "free" | "premium" | "ultra";
  subscriptionExpiresAt?: string | null;
  favoriteLeagues: number[];
  isBlocked: boolean;
  warmPredictUsage?: { usageDay: string; warm: number; predict: number };
};

function sanitizeLeagueIds(values: number[]) {
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    )
  );
}

function mapSupabaseUser(user: SupabaseAuthUser | null, profile: ProfileRow | null = null): User | null {
  if (!user) return null;
  const fallbackFavorites = Array.isArray(user.user_metadata?.favoriteLeagues)
    ? user.user_metadata.favoriteLeagues.filter((value: unknown): value is number => typeof value === "number")
    : [];
  const favoriteLeagues = sanitizeLeagueIds(profile?.favorite_leagues ?? fallbackFavorites);

  return {
    id: user.id,
    email: user.email ?? "",
    // Admin UI from DB role only — never from client env email lists (C6).
    role: profile?.role ?? "user",
    favoriteLeagues,
    isBlocked: Boolean(profile?.is_blocked),
    onboardingCompleted: Boolean(profile?.onboarding_completed),
    tier: profile?.tier || "free",
    subscription_expires_at: profile?.subscription_expires_at ?? null,
    premium_trial_activated_at: profile?.premium_trial_activated_at ?? null,
    ultra_trial_activated_at: profile?.ultra_trial_activated_at ?? null,
    predict_count_today: 0,
    notificationPrefs: {
      safe: profile?.notify_safe ?? true,
      value: profile?.notify_value ?? true,
      email: profile?.notify_email ?? false
    },
    emailNotificationsConsentedAt: profile?.notify_email_consent_at ?? null
  };
}

/**
 * The whole auth lifecycle: session, profile, tier, and the Supabase
 * subscription. Runs EXACTLY ONCE, inside AuthProvider — never call it
 * directly. Consumers use `useAuth()` below, which reads the shared value.
 *
 * It used to be the exported hook, so each of its seven consumers built its
 * own state, its own `getSession()` on mount and its own
 * `onAuthStateChange` subscription. Three of them mount together on
 * /workspace (ThemeBoot, RootRouter's AuthGate, UserDashboard), which is why
 * one activation journey issued 9-11 POSTs to
 * /api/fixtures?syncBootstrapAdmin=1 — every one a 403 — plus a duplicated
 * tierStatus call and three copies of the session/profile round-trips.
 */
/**
 * Five distinguishable states, because "no user object" used to mean all of
 * them at once — and AuthGate read it as "signed out", bouncing a user with a
 * perfectly valid session to /login the moment a profile read wobbled.
 */
export type AuthStatus =
  /** Still resolving; nothing decided yet. */
  | "unresolved"
  /** Confirmed absent: there is genuinely no session. */
  | "no-session"
  /** Confirmed present, profile loaded. */
  | "authenticated"
  /** Session present, profile still loading. */
  | "profile-pending"
  /** Session present, but an auth or profile request failed or timed out. */
  | "auth-error";

function useAuthState() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAuthEvent, setLastAuthEvent] = useState<AuthChangeEvent | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("unresolved");
  const [managedProfiles, setManagedProfiles] = useState<ManagedProfile[]>([]);
  const [predictCountToday, setPredictCountToday] = useState(0);
  const [predictLimitToday, setPredictLimitToday] = useState<number | null>(null);
  const [tierQuotaExempt, setTierQuotaExempt] = useState(false);
  /** Access tokens already offered to the bootstrap-admin check. */
  const bootstrapAsked = useRef<Set<string>>(new Set());

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return null;
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select(
        "user_id, role, favorite_leagues, is_blocked, notify_safe, notify_value, notify_email, notify_email_consent_at, onboarding_completed, tier, subscription_expires_at, premium_trial_activated_at, ultra_trial_activated_at"
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) {
      const msg = String(profileError.message || "").toLowerCase();
      const missingTierCols = msg.includes("column") && (msg.includes("tier") || msg.includes("subscription_expires_at"));
      if (!missingTierCols) throw profileError;
      // Backward-compat: DB migration for tier columns not applied yet.
      const { data: legacyData, error: legacyError } = await supabase
        .from("profiles")
        .select(
          "user_id, role, favorite_leagues, is_blocked, notify_safe, notify_value, notify_email, notify_email_consent_at, onboarding_completed"
        )
        .eq("user_id", userId)
        .maybeSingle();
      if (legacyError) throw legacyError;
      return (legacyData as ProfileRow | null) ?? null;
    }
    return (data as ProfileRow | null) ?? null;
  }, []);

  /**
   * Asks the server to promote profiles.role → admin when email is in ADMIN_EMAILS.
   * Client never sees the allowlist; UI updates only after DB role reloads.
   */
  const promoteBootstrapAdminInDb = useCallback(
    async (authUser: SupabaseAuthUser, profile: ProfileRow | null, accessToken: string): Promise<ProfileRow | null> => {
      if (!profile || profile.role === "admin") return profile;
      if (profile.role !== "user") return profile;
      /*
        The provider removes the duplicate INSTANCES, but not the duplicate
        PATHS: getSession() runs on mount, on every predict (usePredictFlow's
        resolveAccessToken) and when favourite leagues are saved, and
        onAuthStateChange fires again on SIGNED_IN and TOKEN_REFRESHED. Each
        would re-ask a question whose answer cannot change while the token
        does not: the allowlist is server-side and keyed on the token's email.

        Keyed by TOKEN, never by user id — a fresh sign-in mints a new token,
        so signing out cannot suppress the next session's promotion, and a
        real bootstrap admin is still promoted on its first ask.
      */
      if (bootstrapAsked.current.has(accessToken)) return profile;
      // Tokens rotate roughly hourly; keep the set from growing all session.
      if (bootstrapAsked.current.size > 50) bootstrapAsked.current.clear();
      bootstrapAsked.current.add(accessToken);
      try {
        // Bounded: a best-effort secondary promotion. Unbounded, this single
        // request could hold the sign-in button open on its own.
        const response = await boundedFetch("/api/fixtures?syncBootstrapAdmin=1", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const json = (await response.json()) as {
          ok?: boolean;
          promoted?: boolean;
          reason?: string;
        };
        if (!json?.ok) return profile;
        if (json.promoted || json.reason === "already_admin" || json.reason === "unexpected_role") {
          return await loadProfile(authUser.id);
        }
      } catch {
        // Silent by design — non-admin users get 403 and the admin UI waits
        // for the DB role. A THROW is different from a 403 though: nothing was
        // decided, so release the token and let a later path ask again.
        bootstrapAsked.current.delete(accessToken);
      }
      return profile;
    },
    [loadProfile]
  );

  /**
   * The unbounded restore sequence. Callers must not await this directly — it is
   * the thing that could hang; `getSession` below is what puts a clock on it.
   */
  const restoreSession = useCallback(async () => {
    if (!supabase) {
      setSession(null);
      setUser(null);
      throw new Error("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }
    // Must hydrate from storage first: getUser() before getSession() triggers "Auth session missing!"
    // because the in-memory client has not loaded the persisted session yet.
    const { data: initial, error: initialErr } = await supabase.auth.getSession();
    if (initialErr) throw initialErr;
    if (initial.session) {
      const { error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        const { error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr) {
          /*
            This branch used to run `setSession(null); setUser(null); throw` —
            which is how a 503 on getUser() bounced a user holding a valid,
            unexpired session straight to /login. "The server did not answer" is
            not "you are signed out": the stored session is still the only
            evidence either way, and discarding it turns a transient upstream
            wobble into a forced logout.

            So a still-usable session is kept and reported as degraded. Only a
            genuinely rejected credential clears state — auth-js already made
            that call by removing the session from storage, so re-reading it
            below is what distinguishes the two cases.
          */
          const { data: after } = await supabase.auth.getSession();
          if (after.session) {
            setSession(after.session);
            setUser(mapSupabaseUser(after.session.user, null));
            setAuthStatus("auth-error");
            setError(isAuthTimeoutError(userErr) ? AUTH_TIMEOUT_MESSAGE_KEY : userErr.message);
            return after.session;
          }
          setSession(null);
          setUser(null);
          setAuthStatus("no-session");
          throw userErr;
        }
      }
    }
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const sess = data.session;
    if (!sess?.user) {
      setSession(null);
      setUser(null);
      setAuthStatus("no-session");
      return sess;
    }
    // The session is established from here on. Profile enrichment is secondary:
    // it may fail without unauthenticating anyone.
    setSession(sess);
    setUser(mapSupabaseUser(sess.user, null));
    setAuthStatus("profile-pending");
    let nextProfile: ProfileRow | null;
    try {
      nextProfile = await loadProfile(sess.user.id);
      const token = sess.access_token;
      if (token) {
        nextProfile = await promoteBootstrapAdminInDb(sess.user, nextProfile, token);
      }
      setUser(mapSupabaseUser(sess.user, nextProfile));
      setAuthStatus("authenticated");
    } catch (profileError: unknown) {
      setUser(mapSupabaseUser(sess.user, null));
      setAuthStatus("auth-error");
      setError(
        isAuthTimeoutError(profileError)
          ? AUTH_TIMEOUT_MESSAGE_KEY
          : profileError instanceof Error
            ? profileError.message
            : "Unable to load profile"
      );
    }
    return sess;
  }, [loadProfile, promoteBootstrapAdminInDb]);

  /**
   * Session restore, with a clock on it.
   *
   * L1 gave every auth REQUEST a deadline and those deadlines fired in
   * production — three times, ten seconds apart — yet the app still sat on
   * "Se încarcă sesiunea…" forever. Bounding each attempt does not bound a
   * sequence of them: `auth.getSession()` awaits auth-js's `initializePromise`,
   * which spans however many refresh attempts auth-js decides to make. Since
   * `setLoading(false)` lives in this promise's `finally`, an unbounded restore
   * is an unbounded spinner.
   *
   * On timeout the question is not "is this user signed in" — a timeout answers
   * nothing about that. Storage answers it: auth-js removes a session it has
   * actually rejected, so a session still on disk is a session nobody has
   * invalidated, and it is kept and marked degraded. Only its absence routes
   * anyone to /login.
   */
  const getSession = useCallback(async () => {
    try {
      return await withDeadline(
        restoreSession(),
        SESSION_RESTORE_TIMEOUT_MS,
        () => new SessionRestoreTimeoutError(SESSION_RESTORE_TIMEOUT_MS)
      );
    } catch (restoreError: unknown) {
      if (!isSessionRestoreTimeoutError(restoreError)) throw restoreError;

      const persisted = readPersistedSession();
      if (!persisted) {
        // No evidence of a session anywhere: ordinary unauthenticated routing.
        setSession(null);
        setUser(null);
        setAuthStatus("no-session");
        return null;
      }
      /*
        A timeout is not a revocation. The stored session is untouched, the user
        stays signed in, and the state says "degraded" so the UI can say so —
        rather than a spinner that never ends or a logout nobody asked for.
      */
      const restored = persisted as unknown as Session;
      setSession(restored);
      setUser(mapSupabaseUser(restored.user, null));
      setAuthStatus("auth-error");
      setError(AUTH_TIMEOUT_MESSAGE_KEY);
      return restored;
    }
  }, [restoreSession]);

  const refreshTierStatus = useCallback(async () => {
    if (!session?.access_token) return null;
    try {
      const response = await fetch("/api/fixtures?tierStatus=1", {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      const json = await response.json();
      if (!response.ok || !json?.ok || !json?.tierStatus) return null;
      const ts = json.tierStatus as {
        tier?: "free" | "premium" | "ultra";
        subscriptionExpiresAt?: string | null;
        premiumTrialRemainingMs?: number;
        ultraTrialRemainingMs?: number;
        predictCountToday?: number;
        predictLimit?: number | null;
        quotaExempt?: boolean;
      };
      setPredictCountToday(Math.max(0, Number(ts.predictCountToday) || 0));
      setPredictLimitToday(ts.predictLimit == null ? null : Number(ts.predictLimit));
      setTierQuotaExempt(Boolean(ts.quotaExempt));
      setUser((prev) =>
        prev
          ? {
              ...prev,
              tier: ts.tier || prev.tier,
              subscription_expires_at: ts.subscriptionExpiresAt ?? prev.subscription_expires_at,
              predict_count_today: Math.max(0, Number(ts.predictCountToday) || 0)
            }
          : prev
      );
      return ts;
    } catch {
      return null;
    }
  }, [session?.access_token]);

  const activate24hTrial = useCallback(
    async (tier: "premium" | "ultra") => {
      if (!session?.access_token) throw new Error("Autentificare necesară.");
      const response = await fetch("/api/billing?view=trial", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ tier })
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Nu am putut activa trial-ul.");
      }
      if (session?.user?.id) {
        const nextProfile = await loadProfile(session.user.id);
        setUser(mapSupabaseUser(session.user, nextProfile));
      }
      await refreshTierStatus();
      return json;
    },
    [session?.access_token, session?.user, loadProfile, refreshTierStatus]
  );

  const login = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      const missingConfigError = new Error("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setError(missingConfigError.message);
      throw missingConfigError;
    }
    setError(null);
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"];
    try {
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) {
        setError(result.error.message);
        throw result.error;
      }
      data = result.data;
    } catch (signInError: unknown) {
      // auth-js rewraps a transport throw, so the deadline arrives here rather
      // than as `result.error`.
      if (isAuthTimeoutError(signInError)) {
        setAuthStatus("auth-error");
        setError(AUTH_TIMEOUT_MESSAGE_KEY);
      }
      throw signInError;
    }
    /*
      signInWithPassword has succeeded: the user IS authenticated. Everything
      below is enrichment, and none of it may un-authenticate them or hold the
      button open. Previously a hung profile read here left "Se procesează…" on
      screen forever, because a promise that never settles reaches neither catch
      nor finally.
    */
    setSession(data.session);
    setUser(mapSupabaseUser(data.user, null));
    setAuthStatus(data.session ? "profile-pending" : "no-session");
    let nextProfile: ProfileRow | null;
    try {
      nextProfile = data.user ? await loadProfile(data.user.id) : null;
      const token = data.session?.access_token;
      if (data.user && token) {
        nextProfile = await promoteBootstrapAdminInDb(data.user, nextProfile, token);
      }
      setUser(mapSupabaseUser(data.user, nextProfile));
      if (data.session) setAuthStatus("authenticated");
    } catch (profileError: unknown) {
      // Surfaced, never swallowed — but as a degraded state, not a failed login.
      setUser(mapSupabaseUser(data.user, null));
      if (data.session) setAuthStatus("auth-error");
      setError(
        isAuthTimeoutError(profileError)
          ? AUTH_TIMEOUT_MESSAGE_KEY
          : profileError instanceof Error
            ? profileError.message
            : "Unable to load profile"
      );
    }
    return data;
  }, [loadProfile, promoteBootstrapAdminInDb]);

  const signup = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      const missingConfigError = new Error("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setError(missingConfigError.message);
      throw missingConfigError;
    }
    setError(null);
    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin
      }
    });
    if (signupError) {
      setError(signupError.message);
      throw signupError;
    }
    if (data.user) {
      await supabase.from("profiles").upsert(
        {
          user_id: data.user.id,
          role: "user",
          favorite_leagues: [],
          is_blocked: false
        },
        { onConflict: "user_id" }
      );
    }
    const authUser = data.user ?? data.session?.user ?? null;
    let nextProfile = authUser ? await loadProfile(authUser.id) : null;
    const token = data.session?.access_token;
    if (authUser && token) {
      nextProfile = await promoteBootstrapAdminInDb(authUser, nextProfile, token);
    }
    setSession(data.session ?? null);
    setUser(mapSupabaseUser(authUser, nextProfile));
    return data;
  }, [loadProfile, promoteBootstrapAdminInDb]);

  const sendPasswordResetEmail = useCallback(async (email: string) => {
    if (!supabase) {
      const missingConfigError = new Error("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setError(missingConfigError.message);
      throw missingConfigError;
    }
    setError(null);
    const { data, error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    });
    if (resetError) {
      setError(resetError.message);
      throw resetError;
    }
    return data;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) {
      const missingConfigError = new Error("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setError(missingConfigError.message);
      throw missingConfigError;
    }
    setError(null);
    const { data, error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      throw updateError;
    }
    const authUser = data.user;
    const nextProfile = authUser?.id ? await loadProfile(authUser.id) : null;
    setUser(mapSupabaseUser(authUser, nextProfile));
    return data;
  }, [loadProfile]);

  const logout = useCallback(async () => {
    if (!supabase) {
      const missingConfigError = new Error("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setError(missingConfigError.message);
      throw missingConfigError;
    }
    setError(null);
    const { error: logoutError } = await supabase.auth.signOut();
    if (logoutError) {
      setError(logoutError.message);
      throw logoutError;
    }
    setSession(null);
    setUser(null);
  }, []);

  const updateFavoriteLeagues = useCallback(async (favoriteLeagues: number[]) => {
    if (!supabase) {
      const missingConfigError = new Error("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setError(missingConfigError.message);
      throw missingConfigError;
    }
    setError(null);
    const sanitized = sanitizeLeagueIds(favoriteLeagues);
    const activeSession = await getSession();
    if (!activeSession?.user?.id) {
      const noSessionError = new Error("Nu există sesiune activă pentru salvarea preferințelor.");
      setError(noSessionError.message);
      throw noSessionError;
    }
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ favorite_leagues: sanitized })
      .eq("user_id", activeSession.user.id);
    if (updateError) {
      setError(updateError.message);
      throw updateError;
    }
    const nextProfile = await loadProfile(activeSession.user.id);
    const nextUser = mapSupabaseUser(activeSession.user, nextProfile);
    setUser(nextUser);
    return nextUser;
  }, [getSession, loadProfile]);

  const refreshManagedProfiles = useCallback(async () => {
    if (!supabase || user?.role !== "admin" || !session?.access_token) return [];
    const usageDay = localCalendarDateKey();
    const qs = new URLSearchParams({
      includeWarmPredictUsage: "1",
      usageDay
    });
    const response = await fetch(`/api/admin?${qs}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const json = await response.json();
    if (!json?.ok) {
      const message = json?.error || "Unable to load admin profiles.";
      setError(message);
      throw new Error(message);
    }
    type AdminRow = ProfileRow & {
      email?: string | null;
      warmPredictUsage?: { usageDay: string; warm: number; predict: number };
    };
    const rows = (json.items as AdminRow[] | null) ?? [];
    const mapped: ManagedProfile[] = rows.map((row) => ({
      userId: row.user_id,
      email: row.email || null,
      role: row.role,
      tier: row.tier || "free",
      subscriptionExpiresAt: row.subscription_expires_at ?? null,
      favoriteLeagues: sanitizeLeagueIds(row.favorite_leagues ?? []),
      isBlocked: Boolean(row.is_blocked),
      warmPredictUsage:
        row.warmPredictUsage &&
        typeof row.warmPredictUsage.warm === "number" &&
        typeof row.warmPredictUsage.predict === "number"
          ? {
              usageDay: String(row.warmPredictUsage.usageDay || usageDay),
              warm: row.warmPredictUsage.warm,
              predict: row.warmPredictUsage.predict
            }
          : undefined
    }));
    setManagedProfiles(mapped);
    return mapped;
  }, [user?.role, session?.access_token]);

  const updateProfileRole = useCallback(async (targetUserId: string, role: "user" | "admin") => {
    if (!supabase || !session?.access_token) return;
    const response = await fetch("/api/admin", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ userId: targetUserId, role })
    });
    const json = await response.json();
    if (!json?.ok) {
      const message = json?.error || "Unable to update profile role.";
      setError(message);
      throw new Error(message);
    }
    await refreshManagedProfiles();
  }, [refreshManagedProfiles, session?.access_token]);

  const toggleProfileBlock = useCallback(async (targetUserId: string, isBlocked: boolean) => {
    if (!supabase || !session?.access_token) return;
    const response = await fetch("/api/admin", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ userId: targetUserId, isBlocked })
    });
    const json = await response.json();
    if (!json?.ok) {
      const message = json?.error || "Unable to update profile blocked state.";
      setError(message);
      throw new Error(message);
    }
    await refreshManagedProfiles();
  }, [refreshManagedProfiles, session?.access_token]);

  const updateProfileMonetization = useCallback(
    async (
      targetUserId: string,
      payload: { tier?: "free" | "premium" | "ultra"; subscriptionExpiresAt?: string | null }
    ) => {
      if (!supabase || !session?.access_token) return;
      const response = await fetch("/api/admin", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ userId: targetUserId, ...payload })
      });
      const json = await response.json();
      if (!json?.ok) {
        const message = json?.error || "Unable to update subscription.";
        setError(message);
        throw new Error(message);
      }
      await refreshManagedProfiles();
    },
    [refreshManagedProfiles, session?.access_token]
  );

  const updateNotificationPreferences = useCallback(
    async (
      prefs: Partial<{ safe: boolean; value: boolean; email: boolean; emailConsentAcknowledged?: boolean }>
    ) => {
    if (!supabase || !session?.user?.id) return null;
    const payload: Record<string, unknown> = {};
    if (typeof prefs.safe === "boolean") payload.notify_safe = prefs.safe;
    if (typeof prefs.value === "boolean") payload.notify_value = prefs.value;
    if (typeof prefs.email === "boolean") {
      payload.notify_email = prefs.email;
      if (prefs.email === false) {
        payload.notify_email_consent_at = null;
      } else if (prefs.email === true && prefs.emailConsentAcknowledged === true) {
        payload.notify_email_consent_at = new Date().toISOString();
      }
    }
    if (!Object.keys(payload).length) return user;

    const { error: prefsError } = await supabase
      .from("profiles")
      .update(payload)
      .eq("user_id", session.user.id);
    if (prefsError) {
      setError(prefsError.message);
      throw prefsError;
    }
    const nextProfile = await loadProfile(session.user.id);
    const nextUser = mapSupabaseUser(session.user, nextProfile);
    setUser(nextUser);
    return nextUser;
  }, [session?.user, loadProfile, user]);

  const markOnboardingComplete = useCallback(async () => {
    if (!supabase || !session?.user?.id) return null;
    const { error: onboardingError } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true })
      .eq("user_id", session.user.id);
    if (onboardingError) {
      setError(onboardingError.message);
      throw onboardingError;
    }
    const nextProfile = await loadProfile(session.user.id);
    const nextUser = mapSupabaseUser(session.user, nextProfile);
    setUser(nextUser);
    return nextUser;
  }, [session?.user, loadProfile]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      setError("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    let isMounted = true;
    getSession()
      .catch((sessionError: unknown) => {
        if (!isMounted) return;
        const message = sessionError instanceof Error ? sessionError.message : "Unable to restore session";
        setError(message);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setLastAuthEvent(event);
      setSession(nextSession);
      if (!nextSession?.user) {
        setUser(null);
        setLoading(false);
        return;
      }
      void (async () => {
        try {
          let profile = await loadProfile(nextSession.user.id);
          const token = nextSession.access_token;
          if (token) {
            profile = await promoteBootstrapAdminInDb(nextSession.user, profile, token);
          }
          setUser(mapSupabaseUser(nextSession.user, profile));
        } catch (profileError: unknown) {
          const message = profileError instanceof Error ? profileError.message : "Unable to load profile";
          setError(message);
          setUser(mapSupabaseUser(nextSession.user, null));
        } finally {
          setLoading(false);
        }
      })();
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, [getSession, loadProfile, promoteBootstrapAdminInDb]);

  useEffect(() => {
    if (!session?.access_token) {
      setPredictCountToday(0);
      setPredictLimitToday(null);
      setTierQuotaExempt(false);
      return;
    }
    void refreshTierStatus();
  }, [session?.access_token, refreshTierStatus]);

  const trialRemainingTime = useMemo(() => {
    const now = Date.now();
    const rem = (iso: string | null | undefined) => {
      if (!iso) return 0;
      const start = new Date(iso).getTime();
      if (!Number.isFinite(start)) return 0;
      return Math.max(0, start + 24 * 60 * 60 * 1000 - now);
    };
    return {
      premiumMs: rem(user?.premium_trial_activated_at),
      ultraMs: rem(user?.ultra_trial_activated_at)
    };
  }, [user?.premium_trial_activated_at, user?.ultra_trial_activated_at]);

  /** Mirrors resolveEffectiveTierFromProfile() in server-utils/accessTier.js so the UI
   *  never shows premium/ultra affordances the server has already stopped honoring. */
  const isSubscriptionExpired = useMemo(() => {
    if (!user?.subscription_expires_at) return false;
    const t = new Date(user.subscription_expires_at).getTime();
    return Number.isFinite(t) && t <= Date.now();
  }, [user?.subscription_expires_at]);

  const hasActiveSubscription = useMemo(() => {
    const requestedTier = user?.tier || "free";
    if (requestedTier !== "premium" && requestedTier !== "ultra") return false;
    if (!user?.subscription_expires_at) return true; // open-ended paid tier, no expiry set
    return !isSubscriptionExpired;
  }, [user?.tier, user?.subscription_expires_at, isSubscriptionExpired]);

  const effectiveTier = useMemo(() => {
    const requestedTier = user?.tier || "free";
    if (hasActiveSubscription && (requestedTier === "premium" || requestedTier === "ultra")) {
      return requestedTier;
    }
    if (trialRemainingTime.ultraMs > 0) return "ultra";
    if (trialRemainingTime.premiumMs > 0) return "premium";
    return "free";
  }, [user?.tier, hasActiveSubscription, trialRemainingTime]);

  const trialExpiresAt = useMemo(() => {
    const premiumStart = user?.premium_trial_activated_at ? new Date(user.premium_trial_activated_at).getTime() : NaN;
    const ultraStart = user?.ultra_trial_activated_at ? new Date(user.ultra_trial_activated_at).getTime() : NaN;
    const premiumExpiry = Number.isFinite(premiumStart) ? premiumStart + 24 * 60 * 60 * 1000 : NaN;
    const ultraExpiry = Number.isFinite(ultraStart) ? ultraStart + 24 * 60 * 60 * 1000 : NaN;
    const now = Date.now();
    const active = [premiumExpiry, ultraExpiry].filter((ts) => Number.isFinite(ts) && ts > now);
    if (!active.length) return null;
    return new Date(Math.max(...active)).toISOString();
  }, [user?.premium_trial_activated_at, user?.ultra_trial_activated_at]);

  return {
    user,
    userTier: effectiveTier,
    isSubscriptionExpired,
    hasActiveSubscription,
    trialRemainingTime,
    trialExpiresAt,
    predictCountToday,
    predictLimitToday,
    tierQuotaExempt,
    session,
    loading,
    error,
    lastAuthEvent,
    authStatus,
    managedProfiles,
    login,
    signup,
    sendPasswordResetEmail,
    updatePassword,
    logout,
    getSession,
    updateFavoriteLeagues,
    refreshManagedProfiles,
    updateProfileRole,
    toggleProfileBlock,
    updateProfileMonetization,
    refreshTierStatus,
    activate24hTrial,
    updateNotificationPreferences,
    markOnboardingComplete
  };
}

/** Everything `useAuth()` hands a consumer. */
export type AuthState = ReturnType<typeof useAuthState>;

/*
  Deliberately `null` rather than a default object: a consumer rendered
  outside the provider must fail loudly at the boundary, not silently read a
  logged-out shape and redirect the user to /login.
*/
const AuthContext = createContext<AuthState | null>(null);

/**
 * Owns the single auth lifecycle. Mount it once, above every consumer —
 * RootRouter does, inside BrowserRouter, which is the narrowest boundary that
 * still covers ThemeBoot and every route.
 *
 * The file is `.ts`, so the element is built with `createElement` rather than
 * JSX; renaming it to `.tsx` would move the hook and churn eleven import
 * paths for no behavioural gain.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthState();
  return createElement(AuthContext.Provider, { value }, children);
}

/**
 * The shared auth state. Same shape and same values as before the provider
 * existed — consumers did not change; only the number of lifecycles did.
 */
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside <AuthProvider>. RootRouter mounts it for the whole app.");
  }
  return value;
}
