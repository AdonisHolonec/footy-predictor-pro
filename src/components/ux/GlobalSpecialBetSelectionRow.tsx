import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import MarketFamilyIcon from "../icons/MarketFamilyIcon";
import {
  formatConfidencePercent,
  formatOdds,
  formatValueScore,
  marketIconKey,
  marketLabelKey,
  resolveSelectionLabel,
  statusLabelKey,
  statusTone,
  type FixtureLabel
} from "../../utils/globalSpecialBetView";
import type { GlobalSpecialBetSelection } from "../../types/globalSpecialBet";

type Props = {
  selection: GlobalSpecialBetSelection;
  /**
   * fixture_id -> readable labels, from rows the app already loaded. Only used
   * for selections stored before migration 048, which carry no names of their
   * own; newer ones name themselves and never need the lookup.
   */
  fixtureIndex?: Map<number, FixtureLabel>;
  /**
   * This leg is one of those that ended the bet. Draws the eye straight to the
   * failure instead of making the user scan eight badges to find it.
   */
  deciding?: boolean;
};

/**
 * One leg of a Global Special Bet.
 *
 * Every number rendered here comes straight off the snapshot. A field the API
 * did not send is shown as a dash, never as a zero — `value_score` is optional
 * and a missing one must not read as "no value".
 */
export default function GlobalSpecialBetSelectionRow({ selection, fixtureIndex, deciding = false }: Props) {
  const { t, locale } = useLocale();

  const label: FixtureLabel = resolveSelectionLabel(selection, fixtureIndex);
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
    <li
      className={`rounded-[var(--fp-radius-sm)] border bg-[var(--fp-bg-card)] p-3 ${
        deciding
          ? "border-[var(--fp-danger)]/45 ring-1 ring-inset ring-[var(--fp-danger)]/20"
          : "border-[var(--fp-border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {deciding && (
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-[var(--fp-danger)]">
              {t("gsb.decidingLeg")}
            </p>
          )}
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
