import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgeReferralBonuses,
  fetchReferralBonuses,
  type ReferralBonus
} from "../services/referralNotificationService";

/**
 * The queue behind the referral bonus toast.
 *
 * DELIVERY IS NOT INSTANT IN BOTH DIRECTIONS, AND THE DIFFERENCE IS STRUCTURAL.
 *
 *  - The INVITEE's reward is created during their OWN Predict request: the server
 *    hook in linkUserPredictionFixtures calls attemptQualificationForUser before
 *    responding. By the time that request resolves the grant exists, so the
 *    workspace bumps `refreshKey` and the notice appears immediately.
 *
 *  - The INVITER's reward is created by somebody ELSE's Predict, in another
 *    session. Learning about it the moment it happens requires a push channel,
 *    and this client has none: it is assembled from @supabase/auth-js and
 *    @supabase/postgrest-js precisely so realtime is not in the bundle, and there
 *    is no WebSocket, EventSource or BroadcastChannel anywhere in the app.
 *
 * So the inviter is served by ACTIVITY, not by a timer: returning to the tab or
 * refocusing the window re-checks. That covers the realistic case — a person who
 * is looking at the app sees it within a second of touching it — and the existing
 * five-minute tier-status cadence remains as the background floor for a tab left
 * open and untouched.
 *
 * ONE AT A TIME, NEVER AGGREGATED. Two rewards from two different people are two
 * pieces of news, and merging them would throw away the part worth showing: who
 * joined. Grants queue and are shown in turn, each acknowledged by its own id.
 *
 * ACKNOWLEDGE ON DISPLAY, NOT ON DISMISS. The reward has been communicated the
 * moment it is on screen; waiting for a dismissal that may never come (the user
 * closes the tab) would re-announce the same grant forever.
 */

/**
 * Floor between activity-triggered re-checks.
 *
 * Focus and visibilitychange fire in bursts — alt-tabbing through windows, a
 * devtools panel opening, a mobile browser restoring a tab — and without a floor
 * each burst would be a burst of requests. Thirty seconds keeps the response
 * immediate in human terms while making the worst case one request per half
 * minute, which is well under the five-minute timer it supplements.
 */
const ACTIVITY_MIN_INTERVAL_MS = 30_000;

/** How long one reward notice stays in the cards before the next takes its place. */
const NOTICE_MS = 5000;

export function useReferralBonusToasts(userId: string | null | undefined, refreshKey: number) {
  const [queue, setQueue] = useState<ReferralBonus[]>([]);
  /** Bumped by user activity; combined with `refreshKey` to trigger a re-read. */
  const [activityTick, setActivityTick] = useState(0);
  /**
   * Every grant id this session has already queued. Without it, a refresh that
   * races the acknowledgement round trip would enqueue the same reward twice —
   * the server has not recorded it yet, so it is still "pending".
   */
  const enqueued = useRef<Set<string>>(new Set());
  const acknowledged = useRef<Set<string>>(new Set());
  const lastActivityFetch = useRef<number>(0);

  // A user switch must not inherit the previous account's queue.
  useEffect(() => {
    enqueued.current = new Set();
    acknowledged.current = new Set();
    setQueue([]);
  }, [userId]);

  /**
   * Re-check when the user comes back to the app.
   *
   * `storage` is deliberately absent: acknowledgement is server-side, so a second
   * tab simply finds nothing pending. There is no local state to synchronise and
   * therefore no reason for a BroadcastChannel.
   */
  useEffect(() => {
    if (!userId) return;
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastActivityFetch.current < ACTIVITY_MIN_INTERVAL_MS) return;
      lastActivityFetch.current = now;
      setActivityTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchReferralBonuses().then((bonuses) => {
      if (cancelled) return;
      const fresh = bonuses.filter((b) => !enqueued.current.has(b.grantId));
      if (fresh.length === 0) return;
      for (const b of fresh) enqueued.current.add(b.grantId);
      // The server orders newest first; reversing shows rewards in the order they
      // were earned. `enqueued` already guarantees uniqueness, so no dedupe here.
      setQueue((prev) => [...prev, ...fresh.slice().reverse()]);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey, activityTick]);

  const current = queue[0] ?? null;

  // Acknowledged once, when it first reaches the screen.
  useEffect(() => {
    if (!current || acknowledged.current.has(current.grantId)) return;
    acknowledged.current.add(current.grantId);
    void acknowledgeReferralBonuses([current.grantId]);
  }, [current]);

  const dismiss = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  /**
   * The five-second lifecycle.
   *
   * It lives here rather than in the presentation because the notice is no longer
   * a toast: it renders inside the plan and referral cards, which are permanent
   * chrome and have no dismissal of their own. One timer per notice, cleared when
   * it changes or the component unmounts, so a queue of rewards advances one
   * every five seconds instead of stacking.
   */
  useEffect(() => {
    if (!current) return;
    const id = setTimeout(dismiss, NOTICE_MS);
    return () => clearTimeout(id);
  }, [current, dismiss]);

  return { current, dismiss, pending: queue.length };
}
