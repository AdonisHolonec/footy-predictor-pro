import { useEffect, useState } from "react";
import type { LeagueCatalogEntry } from "../types";
import { fetchLeagueCatalog } from "../services/leagueCatalogService";

export type LeagueCatalogStatus = "idle" | "loading" | "ready" | "error";

/**
 * Loads the full league catalog once for the consumer dashboard. `catalog` stays null
 * until a successful load, so callers can fall back to the configured elite list and
 * must never prune a user's selection against an absent catalog.
 */
export function useLeagueCatalog(enabled: boolean) {
  const [catalog, setCatalog] = useState<LeagueCatalogEntry[] | null>(null);
  const [status, setStatus] = useState<LeagueCatalogStatus>("idle");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus("loading");
    fetchLeagueCatalog()
      .then((leagues) => {
        if (cancelled) return;
        setCatalog(leagues);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { catalog, status };
}
