import { usePredictFlow } from "./usePredictFlow";
import { ADMIN_PREDICT_FLOW_MESSAGES } from "../constants/predictFlowMessages";
import { PredictionRow } from "../types";
import { inferSeason, localCalendarDateKey, normalizeSelectedDates } from "../utils/appUtils";
import { syncHistoryAfterPredict } from "../utils/predictFlowUtils";
import { isDesktopViewport } from "./useLeaguePanelState";

export type UseWarmOptions = {
  accessToken?: string | null;
  getSession: () => Promise<{ access_token?: string | null } | null | undefined>;
  selectedLeagueIds: number[];
  selectedDates: string[];
  date: string;
  requireAuth: (message?: string) => boolean;
  setStatus: (message: string) => void;
  setPreds: (rows: PredictionRow[]) => void;
  setIsLeaguesOpen: (open: boolean) => void;
  loadHistory: (days?: number) => Promise<void>;
  loadKpi: (days?: number) => Promise<void>;
  loadAlerts: (days?: number) => Promise<void>;
  prefetchColors: (rows: PredictionRow[]) => void;
  onAdminPredictCompleted?: () => void;
};

export function useWarm({
  accessToken,
  getSession,
  selectedLeagueIds,
  selectedDates,
  date,
  requireAuth,
  setStatus,
  setPreds,
  setIsLeaguesOpen,
  loadHistory,
  loadKpi,
  loadAlerts,
  prefetchColors,
  onAdminPredictCompleted
}: UseWarmOptions) {
  const { warm: runWarm, predict: runPredict } = usePredictFlow<PredictionRow>({
    accessToken,
    getSession,
    selectedLeagueIds,
    inferSeason,
    usageDay: localCalendarDateKey(),
    setStatus,
    predictLimit: "50",
    messages: ADMIN_PREDICT_FLOW_MESSAGES,
    onWarmCompleted: async (okCount, totalDates) => {
      setStatus(
        okCount === totalDates
          ? `Date pregătite cu succes pentru ${totalDates} zi(le).`
          : `Warm finalizat parțial (${okCount}/${totalDates}).`
      );
    },
    onPredictCompleted: async (deduped, token, dates) => {
      setPreds(deduped);
      await syncHistoryAfterPredict(token, 7);
      await loadHistory(7);
      await loadKpi(45);
      await loadAlerts(7);
      setStatus(`Gata! ${deduped.length} predicții generate pentru ${dates.length} zi(le).`);
      void prefetchColors(deduped);
      if (!isDesktopViewport()) setIsLeaguesOpen(false);
      onAdminPredictCompleted?.();
    }
  });

  async function warm() {
    if (!requireAuth()) return;
    if (!selectedLeagueIds.length) return setStatus("Selectează o ligă.");
    setStatus("Se procesează datele (Warm)...");
    const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
    await runWarm(dates);
  }

  async function predict() {
    if (!requireAuth()) return;
    if (!selectedLeagueIds.length) return setStatus("Selectează o ligă.");
    setStatus("Generez predicțiile Premium...");
    const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
    await runPredict(dates);
  }

  return { warm, predict };
}
