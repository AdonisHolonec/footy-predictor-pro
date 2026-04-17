import { useCallback, useEffect, useState } from "react";
import type { Session, User as SupabaseAuthUser } from "@supabase/supabase-js";
import type { User } from "../types";
import { supabase } from "../utils/supabaseClient";

function mapSupabaseUser(user: SupabaseAuthUser | null): User | null {
  if (!user) return null;
  const favoriteLeaguesRaw = user.user_metadata?.favoriteLeagues;
  const favoriteLeagues = Array.isArray(favoriteLeaguesRaw)
    ? favoriteLeaguesRaw.filter((value): value is number => typeof value === "number")
    : [];

  return {
    id: user.id,
    email: user.email ?? "",
    favoriteLeagues
  };
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const getSession = useCallback(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    setSession(data.session);
    setUser(mapSupabaseUser(data.session?.user ?? null));
    return data.session;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
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
    setError(null);
    const { data, error: signupError } = await supabase.auth.signUp({ email, password });
    if (signupError) {
      setError(signupError.message);
      throw signupError;
    }
    setSession(data.session ?? null);
    setUser(mapSupabaseUser(data.user ?? data.session?.user ?? null));
    return data;
  }, []);

  const logout = useCallback(async () => {
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
    setError(null);
    const sanitized = Array.from(
      new Set(
        favoriteLeagues
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      )
    );
    const { data, error: updateError } = await supabase.auth.updateUser({
      data: { favoriteLeagues: sanitized }
    });
    if (updateError) {
      setError(updateError.message);
      throw updateError;
    }
    const nextUser = mapSupabaseUser(data.user);
    setUser(nextUser);
    return nextUser;
  }, []);

  useEffect(() => {
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

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(mapSupabaseUser(nextSession?.user ?? null));
      setLoading(false);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, [getSession]);

  return {
    user,
    session,
    loading,
    error,
    login,
    signup,
    logout,
    getSession,
    updateFavoriteLeagues
  };
}
