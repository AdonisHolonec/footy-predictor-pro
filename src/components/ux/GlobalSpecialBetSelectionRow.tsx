import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import MarketFamilyIcon from "../icons/MarketFamilyIcon";
import {
  formatConfidencePercent,
  formatOdds,
  formatValueScore,
  lookupFixtureLabel,
  marketIconKey,
  marketLabelKey,
  statusLabelKey,
  statusTone,
  type FixtureLabel
} from "../../utils/globalSpecialBetView";
import type { GlobalSpecialBetSelection } from "../../types/globalSpecialBet";

type Props = {
  selection: GlobalSpecialBetSelection;
  /** fixture_id -> readable labels, from rows the app already loaded. */
  fixtureIndex?: Map<number, FixtureLabel>;
};

/**
 * One leg of a Global Special Bet.
 *
 * Every number rendered here comes straight off the snapshot. A field the API
 * did not send is shown as a dash, never as a zero — `value_score` is optional
 * and a missing one must not read as "no value".
 */
export default function GlobalSpecialBetSelectionRow({ selection, fixtureIndex }: Props) {
  const { t, locale } = useLocale();

  const label: FixtureLabel = lookupFixtureLabel(fixtureIndex, selection.fixture_id);
  const title = label.title ?? t("gsb.matchFallback", { id: selection.fixture_id });
  const league = label.league ?? t("gsb.leagueFallback", { id: selection.league_id });

  const marketKey = marketLabelKey(selection.market);
  const marketLabel = marketKey ? t(marketKey) : selection.market;

  const odds = formatOdds(selection.odds);
  const confidence = formatConfidencePercent(selection.confidence);
  const value = formatValueScore(selection.value_score);
  const dash = "—";

  const kickoff = (() => {
    const ms = Date.parse(selection.kickoff_at);
    if (!Number.isFinite(ms)) return null;
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(ms));
  })();

  return (
    <li className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-[var(--fp-text)]">{title}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
            {league}
            {kickoff ? ` · ${kickoff}` : ""}
          </p>
        </div>
        <Badge tone={statusTone(selection.status)}>{t(statusLabelKey(selection.status))}</Badge>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <MarketFamilyIcon familyKey={marketIconKey(selection.market)} className="shrink-0" />
        <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
          {marketLabel}
        </span>
        <span className="min-w-0 truncate font-display text-sm font-semibold text-[var(--fp-text)]">
          {selection.selection}
        </span>
      </div>

      {/* Three columns at 390px too: the numbers are what the user scans, so they
          stay on one readable row instead of wrapping into a list. */}
      <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-[var(--fp-border)] pt-2">
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-wide text-[var(--fp-text-muted)]">
            {t("gsb.odds")}
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[var(--fp-text)]">{odds ?? dash}</dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-wide text-[var(--fp-text-muted)]">
            {t("gsb.confidence")}
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[var(--fp-text)]">
            {confidence ?? dash}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-wide text-[var(--fp-text-muted)]">
            {t("gsb.value")}
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[var(--fp-text)]">{value ?? dash}</dd>
        </div>
      </dl>
    </li>
  );
}
