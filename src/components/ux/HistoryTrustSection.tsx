import { useMemo } from "react";
import type { HistoryEntry, MarketBreakdownRow, PerformanceLeagueBreakdown } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Card from "../../design-system/Card";
import StatTile from "../../design-system/StatTile";
import { computeLastNDaysAccuracy, computeMarketBreakdown, computeSimpleRoi } from "../../utils/historyStats";

type Props = {
  history: HistoryEntry[];
  leagueBreakdown: PerformanceLeagueBreakdown[];
};

const MARKET_LABEL_KEY: Record<MarketBreakdownRow["market"], string> = {
  oneXTwo: "dash.marketOneXTwo",
  overUnder: "dash.marketOverUnder",
  btts: "dash.marketBtts"
};

const th = "px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]";
const td = "border-t border-[var(--fp-border)] px-2 py-1.5 text-[11px]";
const tableWrap = "overflow-x-auto rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)]";

export default function HistoryTrustSection({ history, leagueBreakdown }: Props) {
  const { t, locale } = useLocale();

  const last7Days = useMemo(() => computeLastNDaysAccuracy(history, 7), [history]);
  const marketBreakdown = useMemo(() => computeMarketBreakdown(history), [history]);
  const roi = useMemo(() => computeSimpleRoi(history), [history]);
  const topLeagues = useMemo(() => leagueBreakdown.slice(0, 6), [leagueBreakdown]);

  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-US", {
        weekday: "short",
        day: "numeric",
        month: "short"
      }),
    [locale]
  );

  return (
    <Card>
      <h2 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
        {t("dash.historyTrustTitle")}
      </h2>
      <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("dash.historyTrustSub")}</p>

      <div className="mt-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
          {t("dash.last7DaysTitle")}
        </h3>
        <div className={tableWrap}>
          <table className="min-w-full text-left">
            <thead className="bg-[var(--fp-bg-muted)]">
              <tr>
                <th className={th}>{t("dash.dayColDate")}</th>
                <th className={`${th} text-right`}>{t("dash.dayColCorrect")}</th>
                <th className={`${th} text-right`}>{t("dash.dayColWrong")}</th>
                <th className={`${th} text-right`}>{t("dash.dayColAccuracy")}</th>
              </tr>
            </thead>
            <tbody>
              {last7Days.map((day) => (
                <tr key={day.date}>
                  <td className={`${td} font-semibold text-[var(--fp-text)]`}>
                    {dayFormatter.format(new Date(`${day.date}T12:00:00`))}
                  </td>
                  <td className={`${td} text-right font-mono text-[var(--fp-success)]`}>{day.wins}</td>
                  <td className={`${td} text-right font-mono text-[var(--fp-danger)]`}>{day.losses}</td>
                  <td className={`${td} text-right font-mono text-[var(--fp-text)]`}>
                    {day.settled ? `${day.winRate.toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4">
        <StatTile
          label={t("dash.yieldRoiTitle")}
          value={roi != null ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "—"}
          hint={t("dash.yieldRoiHint")}
          tone={roi == null ? "neutral" : roi >= 0 ? "success" : "danger"}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
            {t("dash.leagueBreakdownTitle")}
          </h3>
          {topLeagues.length === 0 ? (
            <p className="text-xs text-[var(--fp-text-muted)]">{t("dash.noLeagueData")}</p>
          ) : (
            <div className={tableWrap}>
              <table className="min-w-full text-left">
                <thead className="bg-[var(--fp-bg-muted)]">
                  <tr>
                    <th className={th}>{t("dash.tableLeague")}</th>
                    <th className={`${th} text-right`}>{t("stats.wins")}</th>
                    <th className={`${th} text-right`}>{t("stats.losses")}</th>
                    <th className={`${th} text-right`}>{t("stats.successRate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topLeagues.map((row) => (
                    <tr key={row.leagueId}>
                      <td className={`${td} max-w-[160px] truncate font-semibold text-[var(--fp-text)]`} title={row.leagueName}>
                        {row.leagueName || row.leagueId}
                      </td>
                      <td className={`${td} text-right font-mono text-[var(--fp-success)]`}>{row.wins}</td>
                      <td className={`${td} text-right font-mono text-[var(--fp-danger)]`}>{row.losses}</td>
                      <td className={`${td} text-right font-mono text-[var(--fp-text)]`}>
                        {row.settled ? `${row.winRate.toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
            {t("dash.marketBreakdownTitle")}
          </h3>
          <div className={tableWrap}>
            <table className="min-w-full text-left">
              <thead className="bg-[var(--fp-bg-muted)]">
                <tr>
                  <th className={th}>{t("dash.tableMarket")}</th>
                  <th className={`${th} text-right`}>{t("stats.wins")}</th>
                  <th className={`${th} text-right`}>{t("stats.losses")}</th>
                  <th className={`${th} text-right`}>{t("stats.successRate")}</th>
                </tr>
              </thead>
              <tbody>
                {marketBreakdown.map((row) => (
                  <tr key={row.market}>
                    <td className={`${td} font-semibold text-[var(--fp-text)]`}>{t(MARKET_LABEL_KEY[row.market])}</td>
                    <td className={`${td} text-right font-mono text-[var(--fp-success)]`}>{row.wins}</td>
                    <td className={`${td} text-right font-mono text-[var(--fp-danger)]`}>{row.losses}</td>
                    <td className={`${td} text-right font-mono text-[var(--fp-text)]`}>
                      {row.settled ? `${row.winRate.toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}
