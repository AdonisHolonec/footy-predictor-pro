import { useCallback, useEffect, useState } from "react";
import type { AuthChangeEvent, Session, User as SupabaseAuthUser } from "@supabase/supabase-js";
import type { User } from "../types";
import { isSupabaseConfigured, supabase } from "../utils/supabaseClient";

type ProfileRow = {
  user_id: string;
  role: "user" | "admin";
  favorite_leagues: number[] | null;
  is_blocked: boolean | null;
};

type ManagedProfile = {
  userId: string;
  role: "user" | "admin";
  favoriteLeagues: number[];
  isBlocked: boolean;
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

function mapSupabaseUser(user: SupabaseAuthUser | null, profile: ProfileRow | null): User | null {
  if (!user) return null;
  const fallbackFavorites = Array.isArray(user.user_metadata?.favoriteLeagues)
    ? user.user_metadata.favoriteLeagues.filter((value: unknown): value is number => typeof value === "number")
    : [];
  const favoriteLeagues = sanitizeLeagueIds(profile?.favorite_leagues ?? fallbackFavorites);

  return {
    id: user.id,
    email: user.email ?? "",
    role: profile?.role ?? "user",
    favoriteLeagues,
    isBlocked: Boolean(profile?.is_blocked)
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
      .select("user_id, role, favorite_leagues, is_blocked")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    return (data as ProfileRow | null) ?? null;
  }, []);

  const getSession = useCallback(async () => {
    if (!supabase) {
      setSession(null);
      setUser(null);
      throw new Error("Supabase auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const nextProfile = data.session?.user ? await loadProfile(data.session.user.id) : null;
    setSession(data.session);
    setUser(mapSupabaseUser(data.session?.user ?? null, nextProfile));
    return data.session;
  }, [loadProfile]);

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
    setSession(data.session);
    setUser(mapSupabaseUser(data.user));
    return data;
  }, []);

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
    const nextProfile = data.user ? await loadProfile(data.user.id) : null;
    setSession(data.session ?? null);
    setUser(mapSupabaseUser(data.user ?? data.session?.user ?? null, nextProfile));
    return data;
  }, [loadProfile]);

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
    setUser(mapSupabaseUser(data.user));
    return data;
  }, []);

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
    const response = await fetch("/api/admin/profiles", {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const json = await response.json();
    if (!json?.ok) {
      const message = json?.error || "Unable to load admin profiles.";
      setError(message);
      throw new Error(message);
    }
    const rows = (json.items as ProfileRow[] | null) ?? [];
    const mapped = rows.map((row) => ({
      userId: row.user_id,
      role: row.role,
      favoriteLeagues: sanitizeLeagueIds(row.favorite_leagues ?? []),
      isBlocked: Boolean(row.is_blocked)
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
      void loadProfile(nextSession.user.id)
        .then((profile) => setUser(mapSupabaseUser(nextSession.user, profile)))
        .catch((profileError: unknown) => {
          const message = profileError instanceof Error ? profileError.message : "Unable to load profile";
          setError(message);
          setUser(mapSupabaseUser(nextSession.user, null));
        })
        .finally(() => setLoading(false));
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, [getSession, loadProfile]);

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
    toggleProfileBlock
  };
}
