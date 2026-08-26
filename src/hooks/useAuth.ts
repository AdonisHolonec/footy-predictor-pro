import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from "@supabase/supabase-js";
import type { User } from "../types";
import { localCalendarDateKey } from "../utils/appUtils";
import { ResendCooldownError, authErrorMessageKey } from "../utils/authError";

/**
 * Minimum gap between two confirmation emails, matched to Supabase's own default
 * email rate limit so the local refusal lands before the server's does.
 */
export const RESEND_COOLDOWN_MS = 60_000;
import { isSupabaseConfigured, readPersistedSession, supabase } from "../utils/supabaseClient";
import type { ClientEntitlement } from "./entitlement";
import { applyEntitlementToUser, isSubscriptionExpiredFrom, parseTierStatus } from "./entitlement";
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
    /*
      Tri-state on purpose: `undefined` means "the profile has not loaded", which
      is NOT the same as "this user never onboarded". Collapsing both to false is
      what made the carousel flash — L1 establishes the session before enriching
      it, so there is now a real window where `user` exists with no profile, and
      `Boolean(undefined)` told the dashboard to onboard an existing user.
    */
    onboardingCompleted: profile ? Boolean(profile.onboarding_completed) : undefined,
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
  /**
   * The server's entitlement answer, verbatim. `null` means "not asked yet",
   * which is NOT the same as "free" — see `entitlementResolved` below.
   */
  const [entitlement, setEntitlement] = useState<ClientEntitlement | null>(null);
  /** Access tokens already offered to the bootstrap-admin check. */
  const bootstrapAsked = useRef<Set<string>>(new Set());
  /* One clock for every resend entry point — see resendConfirmationEmail. */
  const lastResendAt = useRef(0);

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
      const ts = parseTierStatus(json.tierStatus);
      if (!ts) return null;
      setEntitlement(ts);
      setPredictCountToday(ts.predictCountToday);
      setPredictLimitToday(ts.predictLimit);
      setTierQuotaExempt(ts.quotaExempt);
      /*
        `tier` receives requestedTier, NOT ts.tier. This line used to store the
        EFFECTIVE tier here and let the memos below re-derive access from it —
        the bug PR2b exists to remove. `user.tier` is the user's own plan.
      */
      setUser((prev) => (prev ? applyEntitlementToUser(prev, ts) : prev));
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
        /*
          Classified, not echoed. `t()` falls back to the key it is given, so
          setting `result.error.message` here rendered Supabase's English
          verbatim inside a Romanian screen — "Email not confirmed" read as a
          wrong password. The key wins when we recognise the code; anything we
          do not recognise keeps the original text rather than being flattened
          into a useless generic.
        */
        setError(authErrorMessageKey(result.error) ?? result.error.message);
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
    /*
      The profile row is created by the database, not here.

      `on_auth_user_created_profile` (migration 004) fires AFTER INSERT on
      auth.users and runs `handle_new_user_profile()` — SECURITY DEFINER,
      inserting the same `(user_id, 'user', '{}', false)` with ON CONFLICT DO
      NOTHING. The client upsert that used to sit here wrote byte-identical
      values, so it could only ever be a no-op or a failure.

      It was always the failure: with email confirmation on, signUp() returns no
      session, so the request went out under the anon key, `auth.uid()` was NULL,
      and the INSERT policy `with check (auth.uid() = user_id)` (migration 008)
      rejected it. Its result was never checked, so every signup silently ate the
      refusal. Removing it changes no observable behaviour — it only stops the
      app claiming to do something the trigger had already done.
    */
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

  /**
   * Ask Supabase for a fresh signup-confirmation email.
   *
   * Same GoTrue client as everything else in this hook — `auth.resend` has been
   * available since auth-js 2.x and needs no new client, endpoint or table.
   *
   * `emailRedirectTo` is the SAME value signup() sends, deliberately: the link in
   * the replacement email must land where the first one did, or the new link
   * fails differently from the old one.
   *
   * Returns nothing useful on purpose. A queued email says only that Supabase
   * accepted the request — it is not confirmation, and no caller may treat it as
   * one. Rate limiting is Supabase's; the caller owns the in-flight guard.
   */
  const resendConfirmationEmail = useCallback(async (email: string) => {
    /*
      Cooldown lives HERE, in the one function both entry points call, so the
      expired-link notice and the login error cannot each spend the allowance
      unaware of the other. Supabase's own default email rate limit is a minute;
      arriving there returns `over_email_send_rate_limit`, which the user reads
      as a failure. Refusing locally first turns that into a wait we can name.
    */
    const waitedMs = Date.now() - lastResendAt.current;
    if (lastResendAt.current > 0 && waitedMs < RESEND_COOLDOWN_MS) {
      throw new ResendCooldownError(Math.ceil((RESEND_COOLDOWN_MS - waitedMs) / 1000));
    }
    if (!supabase) {
      const missingConfigError = new Error("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setError(missingConfigError.message);
      throw missingConfigError;
    }
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (resendError) {
      setError(authErrorMessageKey(resendError) ?? resendError.message);
      throw resendError;
    }
    // Stamped only on success: a refused send must not start the clock.
    lastResendAt.current = Date.now();
  }, []);

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
    try {
      const { error: logoutError } = await supabase.auth.signOut();
      if (logoutError) {
        setError(logoutError.message);
        throw logoutError;
      }
    } finally {
      /*
        Always clear locally, even if the network call failed. Signing out is an
        explicit instruction, not an inference — and the false-logout guard above
        would otherwise read the leftover storage record as "still signed in" and
        keep the user in the app they just asked to leave.
      */
      setSession(null);
      setUser(null);
      setAuthStatus("no-session");
    }
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
      if (!nextSession?.user) {
        /*
          A null session is not a logout.

          In auth-js 2.110.7 exactly two events can arrive with a null session:
          SIGNED_OUT, emitted only by `_removeSession()`, and INITIAL_SESSION,
          which is emitted with `null` when initialisation *errors* — including
          when our own request deadlines fire. Everything else (SIGNED_IN,
          TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY, the MFA events)
          always carries a session.

          That second case is the false logout observed in production: the app
          had a working session, auth-js failed to initialise against a degraded
          server, and this listener read `session == null` as "signed out" and
          bounced /workspace -> /login while the stored record sat untouched.

          Storage is the discriminator, because `_removeSession()` deletes the
          record before emitting SIGNED_OUT. A record that is still there means
          nothing has been invalidated; its absence means auth-js decided the
          credential is dead. This is a UI-preservation signal only — every
          protected resource is still gated by the JWT, RLS and the APIs.
        */
        const persisted = readPersistedSession();
        if (persisted?.user?.id) {
          setAuthStatus("auth-error");
          setLoading(false);
          // Deliberately does not clear: nobody invalidated this session.
          return;
        }
        setSession(null);
        setUser(null);
        setAuthStatus("no-session");
        setLoading(false);
        return;
      }
      setSession(nextSession);
      void (async () => {
        try {
          let profile = await loadProfile(nextSession.user.id);
          const token = nextSession.access_token;
          if (token) {
            profile = await promoteBootstrapAdminInDb(nextSession.user, profile, token);
          }
          setUser(mapSupabaseUser(nextSession.user, profile));
          setAuthStatus("authenticated");
        } catch (profileError: unknown) {
          const message = profileError instanceof Error ? profileError.message : "Unable to load profile";
          setError(message);
          setUser(mapSupabaseUser(nextSession.user, null));
          setAuthStatus("auth-error");
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
      // Back to "not asked yet" — a signed-out client knows nothing about tier.
      setEntitlement(null);
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

  /*
    ENTITLEMENT IS READ, NOT COMPUTED.

    These three used to mirror resolveEffectiveTierFromProfile() in React —
    subscription expiry by local clock, then paid-tier precedence, then a trial
    fallback. That mirror could only ever be as current as the last rule change
    it was hand-copied through, and PR1's bonus time was the change that broke
    it. All three now read the server's answer.

    Unresolved (`entitlement === null`) deliberately reports "free" rather than
    guessing from the profile: until the server has answered, the client has not
    been granted anything. This is also what the old memos returned before the
    profile landed, so first paint is unchanged — but there is no longer an
    intermediate, differently-wrong value in between.
  */
  const userTier = entitlement?.tier ?? "free";
  const hasActiveSubscription = entitlement?.hasActiveSubscription ?? false;
  const isSubscriptionExpired = isSubscriptionExpiredFrom(entitlement);
  /** Distinguishes "free" from "not asked yet" for consumers that must not act on a placeholder. */
  const entitlementResolved = entitlement !== null;

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
    /** EFFECTIVE tier from the server. Feature gates read this, never `user.tier`. */
    userTier,
    entitlement,
    entitlementResolved,
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
    resendConfirmationEmail,
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
