import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from "@supabase/supabase-js";
import type { User } from "../types";
import { localCalendarDateKey } from "../utils/appUtils";
import { isSupabaseConfigured, supabase } from "../utils/supabaseClient";

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

function parseBootstrapAdminEmails() {
  const raw = String((import.meta.env.VITE_ADMIN_EMAILS as string | undefined) || "");
  if (!raw.trim()) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

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
  const bootstrapAdminEmails = parseBootstrapAdminEmails();
  const isBootstrapAdmin = bootstrapAdminEmails.has(String(user.email || "").toLowerCase());
  const fallbackFavorites = Array.isArray(user.user_metadata?.favoriteLeagues)
    ? user.user_metadata.favoriteLeagues.filter((value: unknown): value is number => typeof value === "number")
    : [];
  const favoriteLeagues = sanitizeLeagueIds(profile?.favorite_leagues ?? fallbackFavorites);

  return {
    id: user.id,
    email: user.email ?? "",
    // Bootstrap admin must override DB role "user" (signup creates user by default).
    role: isBootstrapAdmin ? "admin" : (profile?.role ?? "user"),
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

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAuthEvent, setLastAuthEvent] = useState<AuthChangeEvent | null>(null);
  const [managedProfiles, setManagedProfiles] = useState<ManagedProfile[]>([]);
  const [predictCountToday, setPredictCountToday] = useState(0);
  const [predictLimitToday, setPredictLimitToday] = useState<number | null>(null);
  const [tierQuotaExempt, setTierQuotaExempt] = useState(false);

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

  /** Syncs profiles.role to admin in DB when email is in VITE_ADMIN_EMAILS (server checks ADMIN_EMAILS). */
  const promoteBootstrapAdminInDb = useCallback(
    async (authUser: SupabaseAuthUser, profile: ProfileRow | null, accessToken: string): Promise<ProfileRow | null> => {
      const emails = parseBootstrapAdminEmails();
      if (!emails.has(String(authUser.email || "").toLowerCase())) return profile;
      if (!profile || profile.role === "admin") return profile;
      if (profile.role !== "user") return profile;
      try {
        const response = await fetch("/api/fixtures?syncBootstrapAdmin=1", {
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
        // silent: UI still works via env bootstrap if sync fails
      }
      return profile;
    },
    [loadProfile]
  );

  const getSession = useCallback(async () => {
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
          setSession(null);
          setUser(null);
          throw userErr;
        }
      }
    }
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const sess = data.session;
    let nextProfile: ProfileRow | null = null;
    if (sess?.user) {
      nextProfile = await loadProfile(sess.user.id);
      const token = sess.access_token;
      if (token) {
        nextProfile = await promoteBootstrapAdminInDb(sess.user, nextProfile, token);
      }
    }
    setSession(sess);
    setUser(mapSupabaseUser(sess?.user ?? null, nextProfile));
    return sess;
  }, [loadProfile, promoteBootstrapAdminInDb]);

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
      const response = await fetch("/api/activate-trial", {
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
    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      setError(loginError.message);
      throw loginError;
    }
    let nextProfile = data.user ? await loadProfile(data.user.id) : null;
    const token = data.session?.access_token;
    if (data.user && token) {
      nextProfile = await promoteBootstrapAdminInDb(data.user, nextProfile, token);
    }
    setSession(data.session);
    setUser(mapSupabaseUser(data.user, nextProfile));
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
    // Profile row is created automatically by the DB trigger `handle_new_user_profile`
    // (migration 004, SECURITY DEFINER, idempotent via ON CONFLICT DO NOTHING).
    // Client-side upsert here was redundant and failed silently under RLS when the
    // session was absent (email confirmation ON), so we rely on the trigger only.
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
    if (!session?.user?.id) return null;
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ favorite_leagues: sanitized })
      .eq("user_id", session.user.id);
    if (updateError) {
      setError(updateError.message);
      throw updateError;
    }
    const nextProfile = await loadProfile(session.user.id);
    const nextUser = mapSupabaseUser(session.user, nextProfile);
    setUser(nextUser);
    return nextUser;
  }, [session?.user, loadProfile]);

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
    if (!Object.keys(payload).length) return null;

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
  }, [session?.user, loadProfile]);

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
    userTier: user?.tier || "free",
    trialRemainingTime,
    trialExpiresAt,
    predictCountToday,
    predictLimitToday,
    tierQuotaExempt,
    session,
    loading,
    error,
    lastAuthEvent,
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
