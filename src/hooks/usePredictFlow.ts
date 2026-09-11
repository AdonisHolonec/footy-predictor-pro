import { useCallback } from "react";
import { dedupePredictionsById } from "../utils/predictFlowUtils";

type SessionLike = { access_token?: string | null } | null | undefined;

/**
 * Result of one `predict()` run. Internal state only — no HTTP/API schema change.
 * Both current callers `await runPredict(...)` and ignore it; it exists so a caller
 * can retry ONLY `failedDates` without recomputing the dates that already succeeded.
 *
 * `outcome` describes the DATES. A failure inside the consumer's own completion
 * callback is surfaced through the status line, not here: every date it received
 * was already computed server-side, so there is nothing to retry.
 */
export type PredictRunOutcome = "success" | "partial_success" | "failure";

export type PredictRunResult = {
  outcome: PredictRunOutcome;
  completedDates: string[];
  failedDates: string[];
  rowCount: number;
};

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
            usageDay,
            // Prefetch what predict will reuse from KV (avoids cold odds/teamstats).
            standings: "1",
            teamstats: "1",
            odds: "1"
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
      } catch (error) {
        const message = (error as { message?: string })?.message;
        setStatus(messages?.warmException?.(message || "Warm failed") || `Eroare: ${message || "Warm a eșuat."}`);
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

  /*
    A failed date must not discard the dates that already succeeded.

    Each date is its own recovery unit. A 429, a non-OK response and a THROW
    (network failure, abort, JSON parse) all record the failure and stop the loop
    the same way, so sequential semantics are unchanged: no later date is requested.
    Before this, a non-OK leg did `setStatus(...); return;` and a throw escaped to an
    outer catch — both skipped `onPredictCompleted`, the only path to the UI, and
    rows already durable in `predictions_history` were shown as nothing.

    Completion then runs AT MOST ONCE, after the loop:
      - on full success exactly as before (all dates, even an empty result);
      - on a partial run with the completed dates' rows only;
      - never when nothing completed, so "0 generated" cannot bury the failure.
    Consumers merge additively (`mergePredictionRows` seeds from existing rows,
    `setUserPredictionMap` is a Set union, `syncHistoryAfterPredict` is a no-op), so a
    partial batch can add rows but never shrink the store. The third argument is the
    completed dates only — `useWarm` renders `pentru ${dates.length} zi(le)`.

    Both consumers call `setStatus` INSIDE the callback, so the failure status is
    applied AFTER awaiting it; otherwise their success line would bury the failure.
  */
  const predict = useCallback(
    async (dates: string[]): Promise<PredictRunResult> => {
      const token = await resolveAccessToken();
      if (getSession && !token) return { outcome: "failure", completedDates: [], failedDates: [...dates], rowCount: 0 };
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const exceptionStatus = (error: unknown) => {
        const message = (error as { message?: string })?.message;
        return messages?.predictException?.(message || "Predict failed") || `Eroare: ${message || "Predict a eșuat."}`;
      };
      const batches: TPrediction[] = [];
      const completedDates: string[] = [];
      let failureStatus: string | null = null;

      for (const currentDate of dates) {
        try {
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
            failureStatus = backend || messages?.predictRateLimit || "Limită zilnică Predict atinsă.";
            break;
          }
          if (!response.ok) {
            const backend = await parseBackendError(response);
            failureStatus =
              messages?.predictFailed?.(response.status, backend) || `Predict a eșuat (HTTP ${response.status}).`;
            break;
          }
          const json = await response.json();
          if (Array.isArray(json)) batches.push(...json);
          completedDates.push(currentDate);
        } catch (error) {
          failureStatus = exceptionStatus(error);
          break;
        }
      }

      const deduped = dedupePredictionsById(batches as Array<{ id?: string | number }>) as TPrediction[];
      const failedDates = dates.slice(completedDates.length);
      if (failureStatus === null || completedDates.length > 0) {
        try {
          await onPredictCompleted?.(deduped, token, completedDates);
        } catch (error) {
          // The consumer failed part-way (e.g. a history reload). Whatever it merged
          // before throwing stays merged and it is not called again, so nothing is
          // duplicated. A date failure, when there is one, is the more actionable message.
          if (failureStatus === null) failureStatus = exceptionStatus(error);
        }
      }
      if (failureStatus !== null) {
        const isPartial = completedDates.length > 0 && failedDates.length > 0;
        setStatus(isPartial ? `${failureStatus} (${completedDates.length}/${dates.length})` : failureStatus);
      }

      const outcome: PredictRunOutcome =
        failedDates.length === 0 ? "success" : completedDates.length > 0 ? "partial_success" : "failure";
      return { outcome, completedDates, failedDates, rowCount: deduped.length };
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
