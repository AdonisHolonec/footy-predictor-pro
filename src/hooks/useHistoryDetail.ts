import { useEffect, useRef, useState } from "react";
import type { PredictionRow } from "../types";

/**
 * One history row, fetched by fixture id.
 *
 * The history LIST currently ships `raw_payload` for every row — ~261 KB each,
 * measured — purely so the match modal can render without a fetch. That is what
 * makes /api/history hit its statement timeout. This hook is the detail source
 * that lets the list stop doing so; the list is deliberately untouched until it
 * is proven.
 *
 * Cached at module scope, not in state: a settled history row does not change,
 * and reopening the same match must not re-request it. Follows the pattern
 * already used by useKickoffWeather.
 */
const detailCache = new Map<number, PredictionRow>();

/** Exposed for tests — nothing in the app should need to clear this. */
export function __clearHistoryDetailCache() {
  detailCache.clear();
}

export type HistoryDetailState = {
  detail: PredictionRow | null;
  loading: boolean;
  error: string | null;
};

export function useHistoryDetail(fixtureId: number | null | undefined): HistoryDetailState {
  const id = Number.isFinite(Number(fixtureId)) && Number(fixtureId) > 0 ? Number(fixtureId) : null;
  const [detail, setDetail] = useState<PredictionRow | null>(id ? (detailCache.get(id) ?? null) : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The fixture this hook currently cares about. A response is applied only if
   * it still matches — otherwise opening B while A is in flight would let A's
   * slower answer overwrite B.
   */
  const wantedRef = useRef<number | null>(id);

  useEffect(() => {
    wantedRef.current = id;
    if (!id) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }

    const cached = detailCache.get(id);
    if (cached) {
      setDetail(cached);
      setError(null);
      setLoading(false);
      return;
    }

    // `alive` guards the unmount case; `wantedRef` guards the switched-fixture
    // case. They are different failures and both produce wrong state.
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/history?fixtureId=${id}`, { signal: controller.signal });
        const json = (await response.json()) as { ok?: boolean; item?: PredictionRow; error?: string };
        if (!alive || wantedRef.current !== id) return;
        if (!response.ok || !json?.ok || !json.item) {
          setError(json?.error || `Nu am putut încărca detaliile (${response.status}).`);
          setLoading(false);
          return;
        }
        detailCache.set(id, json.item);
        setDetail(json.item);
        setLoading(false);
      } catch (err: unknown) {
        if (!alive || wantedRef.current !== id) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Nu am putut încărca detaliile.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [id]);

  return { detail, loading, error };
}
