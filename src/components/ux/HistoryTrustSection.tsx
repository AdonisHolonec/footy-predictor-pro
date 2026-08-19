import { useMemo } from "react";
import type { HistoryEntry, MarketBreakdownRow, PerformanceLeagueBreakdown } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import StatTile from "../../design-system/StatTile";
import {
  computeLastNDaysAccuracy,
  computeMarketBreakdown,
  computeSimpleRoi,
  historyStatsFromRows
} from "../../utils/historyStats";

type Props = {
  history: HistoryEntry[];
  leagueBreakdown: PerformanceLeagueBreakdown[];
  /**
   * Offers the first-use note a next step. Supplied only by the Statistics
   * destination, which is the caller that actually owns the user's history —
   * so the note can never claim "no results yet" on a surface that was simply
   * never handed any data to show.
   */
  onStartPredicting?: () => void;
};

const MARKET_LABEL_KEY: Record<MarketBreakdownRow["market"], string> = {
  oneXTwo: "dash.marketOneXTwo",
  overUnder: "dash.marketOverUnder",
  btts: "dash.marketBtts"
};

const th = "px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]";
const td = "border-t border-[var(--fp-border)] px-2 py-1.5 text-[11px]";
const tableWrap = "overflow-x-auto rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)]";
/** No observation to report: the em dash the accuracy column has always used. */
const noValue = "text-right font-mono text-[var(--fp-text-muted)]";

export default function HistoryTrustSection({ history, leagueBreakdown, onStartPredicting }: Props) {
  const { t, locale } = useLocale();

  const last7Days = useMemo(() => computeLastNDaysAccuracy(history, 7), [history]);
  const marketBreakdown = useMemo(() => computeMarketBreakdown(history), [history]);
  const roi = useMemo(() => computeSimpleRoi(history), [history]);
  const topLeagues = useMemo(() => leagueBreakdown.slice(0, 6), [leagueBreakdown]);

  /**
   * Whether ANY full result has ever settled — not whether the last 7 days did.
   * A user whose only results are older than the window still has statistics,
   * and must not be told they have none.
   */
  const settledEver = useMemo(() => historyStatsFromRows(history).settled > 0, [history]);
  const showFirstUseNote = Boolean(onStartPredicting) && !settledEver;

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

      {/* Kept ABOVE the tables rather than replacing them: the empty columns are
          the clearest statement of what this page will track, and a new user
          who cannot see them has no idea what they are working toward. */}
      {showFirstUseNote && (
        <div className="mt-4 rounded-[var(--fp-radius-sm)] border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-3">
          <p className="text-sm font-semibold text-[var(--fp-text)]">{t("dash.trustEmptyTitle")}</p>
          <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("dash.trustEmptyDesc")}</p>
          {/* Default size on purpose: `sm` is min-h-9, and this is a primary
              next step on a phone. `md` carries the --fp-touch token. */}
          <Button className="mt-3" onClick={onStartPredicting}>
            {t("dash.trustEmptyCta")}
          </Button>
        </div>
      )}

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
                  {/* A day with nothing settled produced no wins and no losses
                      to count — it did not produce zero of them. The accuracy
                      column has always said so; these two now agree with it. */}
                  <td className={`${td} ${day.settled ? "text-right font-mono text-[var(--fp-success)]" : noValue}`}>
                    {day.settled ? day.wins : "—"}
                  </td>
                  <td className={`${td} ${day.settled ? "text-right font-mono text-[var(--fp-danger)]" : noValue}`}>
                    {day.settled ? day.losses : "—"}
                  </td>
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
                      <td className={`${td} ${row.settled ? "text-right font-mono text-[var(--fp-success)]" : noValue}`}>
                        {row.settled ? row.wins : "—"}
                      </td>
                      <td className={`${td} ${row.settled ? "text-right font-mono text-[var(--fp-danger)]" : noValue}`}>
                        {row.settled ? row.losses : "—"}
                      </td>
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
                    <td className={`${td} ${row.settled ? "text-right font-mono text-[var(--fp-success)]" : noValue}`}>
                      {row.settled ? row.wins : "—"}
                    </td>
                    <td className={`${td} ${row.settled ? "text-right font-mono text-[var(--fp-danger)]" : noValue}`}>
                      {row.settled ? row.losses : "—"}
                    </td>
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
