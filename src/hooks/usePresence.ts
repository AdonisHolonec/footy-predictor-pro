import { useCallback, useEffect, useRef, useState } from "react";
import { fetchActivityStats, sendHeartbeat, type ActivityStats } from "../services/presenceService";

/**
 * The heartbeat, and the aggregate everyone sees.
 *
 * WHAT "ONLINE" MEANS HERE. A heartbeat, not a socket. The browser client is
 * assembled from @supabase/auth-js + @supabase/postgrest-js precisely so realtime
 * stays out of the bundle (src/utils/supabaseClient.ts), and there is no
 * websocket anywhere in the app — so this follows the pattern
 * useReferralBonusToasts already set: a bounded timer plus user activity.
 *
 * IT BEATS WHEN SIGNED OUT TOO. Anonymous visitors count toward the day's
 * accesses, so the request still goes out; the server gives them a place in the
 * access set and no presence row, because "online" needs an identity to
 * deduplicate by. `userId` is passed only so a sign-in or sign-out restarts the
 * cadence immediately rather than at the next tick.
 *
 * ONE LOGICAL USER, NOT ONE TAB. Dedupe is the server's job and falls out of the
 * schema: `user_presence` is keyed by user_id, so three tabs upsert the same row
 * and count once. Nothing here coordinates between tabs.
 *
 * NEVER INVENT A COUNT. `stats` stays null until a request succeeds, and a failed
 * refresh keeps the last good value rather than falling back to zero — zero is a
 * meaningful reading ("nobody is online") and must never stand in for "we do not
 * know".
 */

/**
 * Both the timer cadence and the floor between ANY two beats.
 *
 * The approved contract is "no more frequent than once every 30 seconds", and the
 * server's window is 90s — three intervals — so two consecutive beats can be lost
 * to a tunnel or a sleeping radio before a present user is called offline.
 */
const HEARTBEAT_MIN_INTERVAL_MS = 30_000;

export type UsePresenceResult = {
  /** null until the first successful read — never a placeholder zero. */
  stats: ActivityStats | null;
  /** True once any read has succeeded this session. */
  ready: boolean;
};

export function usePresence(userId: string | null | undefined): UsePresenceResult {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const lastBeatRef = useRef(0);
  /** Guards against a late response from a previous identity landing on a new one. */
  const identityRef = useRef<string | null>(null);

  const beat = useCallback(async (force: boolean) => {
    const identity = identityRef.current;
    // A hidden tab is not a present user. Skipping here is what lets a
    // backgrounded phone fall out of the window naturally, with no logout
    // request and no cleanup job.
    if (typeof document !== "undefined" && document.hidden) return;

    const now = Date.now();
    // The floor applies to every beat, not just activity-driven ones: focus and
    // visibilitychange fire in bursts (alt-tabbing, devtools, a mobile browser
    // restoring a tab) and a burst of events must not become a burst of requests.
    if (!force && now - lastBeatRef.current < HEARTBEAT_MIN_INTERVAL_MS) return;
    lastBeatRef.current = now;

    try {
      const next = await sendHeartbeat();
      // Discard if the identity changed while this was in flight.
      if (identityRef.current !== identity) return;
      setStats(next);
    } catch {
      // Offline, a 500, a dropped connection: keep the last known reading. The
      // next beat repairs it, and presence self-heals because the server only
      // ever looks at a time window.
    }
  }, []);

  useEffect(() => {
    identityRef.current = userId ? String(userId) : null;
    // A sign-in or sign-out is a new identity and deserves an immediate beat,
    // so the floor is bypassed exactly once per identity change.
    lastBeatRef.current = 0;
    void beat(true);

    const timer = window.setInterval(() => void beat(false), HEARTBEAT_MIN_INTERVAL_MS);
    const onActivity = () => void beat(false);
    window.addEventListener("focus", onActivity);
    document.addEventListener("visibilitychange", onActivity);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onActivity);
      document.removeEventListener("visibilitychange", onActivity);
    };
  }, [userId, beat]);

  return { stats, ready: stats !== null };
}

/**
 * Read the aggregate WITHOUT recording anything.
 *
 * For surfaces that display activity but must not become part of it, so that
 * rendering a panel never inflates the number the panel is reporting.
 */
export function useActivityStats(enabled: boolean): UsePresenceResult {
  const [stats, setStats] = useState<ActivityStats | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStats(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchActivityStats();
        if (!cancelled) setStats(next);
      } catch {
        // Keep the last reading; see usePresence.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), HEARTBEAT_MIN_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return { stats, ready: stats !== null };
}
