import { useCallback, useEffect, useState } from "react";
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
};

type ManagedProfile = {
  userId: string;
  role: "user" | "admin";
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

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return null;
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select(
        "user_id, role, favorite_leagues, is_blocked, notify_safe, notify_value, notify_email, notify_email_consent_at, onboarding_completed"
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
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
        const response = await fetch("/api/fixtures/day?syncBootstrapAdmin=1", {
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
    const response = await fetch(`/api/admin/profiles?${qs}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const json = await response.json();
    if (!json?.ok) {
      const message = json?.error || "Unable to load admin profiles.";
      setError(message);
      throw new Error(message);
    }
    type AdminRow = ProfileRow & {
      warmPredictUsage?: { usageDay: string; warm: number; predict: number };
    };
    const rows = (json.items as AdminRow[] | null) ?? [];
    const mapped: ManagedProfile[] = rows.map((row) => ({
      userId: row.user_id,
      role: row.role,
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
    const response = await fetch("/api/admin/profiles", {
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
    const response = await fetch("/api/admin/profiles", {
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

  return {
    user,
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
    updateNotificationPreferences,
    markOnboardingComplete
  };
}
