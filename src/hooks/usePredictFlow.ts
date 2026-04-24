import { useCallback } from "react";
import { dedupePredictionsById } from "../utils/predictFlowUtils";

type SessionLike = { access_token?: string | null } | null | undefined;

type UsePredictFlowOptions<TPrediction> = {
  accessToken?: string | null;
  getSession?: () => Promise<SessionLike>;
  selectedLeagueIds: number[];
  inferSeason: (dateIso: string) => number;
  usageDay: string;
  setStatus: (message: string) => void;
  predictLimit?: string;
  messages?: {
    reauthFailed?: string;
    warmRateLimit?: string;
    predictRateLimit?: string;
    warmFailed?: (status: number, backendMessage: string) => string;
    predictFailed?: (status: number, backendMessage: string) => string;
    warmException?: (message: string) => string;
    predictException?: (message: string) => string;
  };
  onPredictCompleted?: (rows: TPrediction[], accessToken: string | null, dates: string[]) => Promise<void> | void;
  onWarmCompleted?: (okCount: number, totalDates: number, accessToken: string | null) => Promise<void> | void;
};

async function parseBackendError(response: Response) {
  try {
    const json = await response.json();
    if (typeof json?.error === "string") return json.error;
  } catch {
    // fallback to caller message
  }
  return "";
}

export function usePredictFlow<TPrediction>(options: UsePredictFlowOptions<TPrediction>) {
  const {
    accessToken,
    getSession,
    selectedLeagueIds,
    inferSeason,
    usageDay,
    setStatus,
    predictLimit = "50",
    messages,
    onPredictCompleted,
    onWarmCompleted
  } = options;

  const resolveAccessToken = useCallback(async () => {
    let nextToken = accessToken ?? null;
    if (!getSession) return nextToken;
    try {
      const fresh = await getSession();
      if (fresh?.access_token) nextToken = fresh.access_token;
      return nextToken;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Nu am putut reincarca sesiunea.";
      setStatus(messages?.reauthFailed || `${msg} Încearcă din nou sau autentifică-te din nou.`);
      return null;
    }
  }, [accessToken, getSession, messages?.reauthFailed, setStatus]);

  const warm = useCallback(
    async (dates: string[]) => {
      const token = await resolveAccessToken();
      if (getSession && !token) return;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      let okCount = 0;

      try {
        for (const currentDate of dates) {
          const qs = new URLSearchParams({
            date: currentDate,
            leagueIds: selectedLeagueIds.join(","),
            season: String(inferSeason(currentDate)),
            usageDay
          });
          const response = await fetch(`/api/warm?${qs.toString()}`, { headers });
          if (response.status === 429) {
            const backend = await parseBackendError(response);
            setStatus(backend || messages?.warmRateLimit || "Limită zilnică Warm atinsă.");
            return;
          }
          if (!response.ok) {
            const backend = await parseBackendError(response);
            const fallback = messages?.warmFailed?.(response.status, backend) || `Warm a eșuat (HTTP ${response.status}).`;
            setStatus(fallback);
            return;
          }
          const json = await response.json();
          if (json?.ok) okCount += 1;
        }
        await onWarmCompleted?.(okCount, dates.length, token);
      } catch (error: any) {
        setStatus(messages?.warmException?.(error?.message || "Warm failed") || `Eroare: ${error?.message || "Warm a eșuat."}`);
      }
    },
    [
      getSession,
      inferSeason,
      messages,
      onWarmCompleted,
      resolveAccessToken,
      selectedLeagueIds,
      setStatus,
      usageDay
    ]
  );

  const predict = useCallback(
    async (dates: string[]) => {
      const token = await resolveAccessToken();
      if (getSession && !token) return;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const batches: TPrediction[] = [];

      try {
        for (const currentDate of dates) {
          const qs = new URLSearchParams({
            date: currentDate,
            leagueIds: selectedLeagueIds.join(","),
            season: String(inferSeason(currentDate)),
            limit: predictLimit,
            usageDay
          });
          const response = await fetch(`/api/predict?${qs.toString()}`, { headers });
          if (response.status === 429) {
            const backend = await parseBackendError(response);
            setStatus(backend || messages?.predictRateLimit || "Limită zilnică Predict atinsă.");
            return;
          }
          if (!response.ok) {
            const backend = await parseBackendError(response);
            const fallback = messages?.predictFailed?.(response.status, backend) || `Predict a eșuat (HTTP ${response.status}).`;
            setStatus(fallback);
            return;
          }
          const json = await response.json();
          if (Array.isArray(json)) batches.push(...json);
        }
        const deduped = dedupePredictionsById(batches as any[]) as TPrediction[];
        await onPredictCompleted?.(deduped, token, dates);
      } catch (error: any) {
        setStatus(messages?.predictException?.(error?.message || "Predict failed") || `Eroare: ${error?.message || "Predict a eșuat."}`);
      }
    },
    [
      getSession,
      inferSeason,
      messages,
      onPredictCompleted,
      predictLimit,
      resolveAccessToken,
      selectedLeagueIds,
      setStatus,
      usageDay
    ]
  );

  return { warm, predict };
}
