import type { Dispatch, SetStateAction } from "react";
import Tooltip from "../../design-system/Tooltip";
import { useLocale } from "../../context/LocaleContext";
import { addIsoDay, clampTierDates } from "./helpers";

/**
 * Chips-urile +1/+2 zile din bara de date (doar premium/ultra), mutate
 * verbatim din slotul `extraDates` al ConsumerShell din UserDashboard.
 */
export default function DateRangeChips({
  date,
  userTier,
  activePredictDates,
  setSelectedDates,
  setStatus
}: {
  date: string;
  userTier: string | undefined;
  activePredictDates: string[];
  setSelectedDates: Dispatch<SetStateAction<string[]>>;
  setStatus: (message: string) => void;
}) {
  const { t } = useLocale();
  if (userTier !== "premium" && userTier !== "ultra") return null;
  const tomorrow = addIsoDay(date, 1);
  const dayAfter = addIsoDay(date, 2);
  const plus1On = activePredictDates.includes(tomorrow);
  const plus2On = activePredictDates.includes(dayAfter);
  const chipOn =
    "h-8 shrink-0 rounded-[var(--fp-radius-sm)] border border-[var(--fp-accent)] bg-[var(--fp-accent)] px-1.5 text-[10px] font-bold text-white shadow-fp-sm ring-1 ring-fp-accent/35 sm:h-9 sm:px-2 sm:text-xs sm:ring-2";
  const chipOff =
    "h-8 shrink-0 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-1.5 text-[10px] font-bold text-[var(--fp-text-muted)] sm:h-9 sm:px-2 sm:text-xs";
  return (
    <>
      <Tooltip label={`${t("shell.includeTomorrow")} · ${plus1On ? t("shell.dayRangeOn") : t("shell.dayRangeOff")}`}>
        <button
          type="button"
          title={t("shell.includeTomorrow")}
          aria-pressed={plus1On}
          onClick={() => {
            if (plus1On) {
              setSelectedDates(clampTierDates(date, userTier, [date]));
            } else {
              setSelectedDates(clampTierDates(date, userTier, [date, tomorrow]));
              setStatus(t("dash.needPredictForDates"));
            }
          }}
          className={plus1On ? chipOn : chipOff}
        >
          {t("shell.plus1Day")}
        </button>
      </Tooltip>
      {userTier === "ultra" ? (
        <Tooltip label={`${t("shell.includeNext2")} · ${plus2On ? t("shell.dayRangeOn") : t("shell.dayRangeOff")}`}>
          <button
            type="button"
            title={t("shell.includeNext2")}
            aria-pressed={plus2On}
            onClick={() => {
              if (plus2On) {
                setSelectedDates(clampTierDates(date, userTier, [date, tomorrow]));
              } else {
                setSelectedDates(clampTierDates(date, userTier, [date, tomorrow, dayAfter]));
                setStatus(t("dash.needPredictForDates"));
              }
            }}
            className={plus2On ? chipOn : chipOff}
          >
            {t("shell.plus2Days")}
          </button>
        </Tooltip>
      ) : null}
    </>
  );
}
