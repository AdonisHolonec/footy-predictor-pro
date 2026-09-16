import { useEffect, useState } from "react";
import { fetchAdminActivity, type AdminActivityStats } from "../services/presenceService";

/**
 * The admin view of activity: both counts plus the nominal online list.
 *
 * SEPARATE FROM usePresence ON PURPOSE. Not because the client needs the split
 * — the browser cannot authorise anything — but because it keeps the two
 * response shapes from ever meeting. The aggregate hook has no field that could
 * hold a name or an email, so a refactor cannot accidentally render one on a
 * normal user's screen.
 *
 * AUTHORISATION IS NOT HERE. `scope=admin` is checked by `assertAdmin` inside
 * server-utils/presenceApi.js before any identity is assembled, and
 * `user_presence` has RLS on with no policies so PostgREST cannot serve it to an
 * authenticated JWT at all. A non-admin calling this gets 403 and an error body
 * with no identity in it. `enabled` below is a rendering convenience, never the
 * control.
 */

/** Matches the hook cadence in usePresence so the two panels agree. */
const REFRESH_MS = 45_000;

export type UseAdminPresenceResult = {
  data: AdminActivityStats | null;
  /** Set when the last attempt failed; the previous reading is kept. */
  failed: boolean;
};

export function useAdminPresence(enabled: boolean): UseAdminPresenceResult {
  const [data, setData] = useState<AdminActivityStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setFailed(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const next = await fetchAdminActivity();
        if (cancelled) return;
        setData(next);
        setFailed(false);
      } catch {
        // Keep the last good list rather than blanking the panel: a dropped
        // request is not evidence that everybody left.
        if (!cancelled) setFailed(true);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return { data, failed };
}
