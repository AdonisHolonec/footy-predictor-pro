import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import MarketFamilyIcon from "../icons/MarketFamilyIcon";
import {
  formatConfidencePercent,
  formatDateTime,
  formatOdds,
  formatProbabilityPercent,
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
  /**
   * This leg has kicked off and is not graded yet. The status badge cannot say
   * it: "În desfășurare" is what every pending leg reads, kicked off or not.
   */
  underway?: boolean;
};

/**
 * One leg of a Global Special Bet.
 *
 * Every number rendered here comes straight off the snapshot. A field the API
 * did not send is shown as a dash, never as a zero — `value_score` is optional
 * and a missing one must not read as "no value".
 */
export default function GlobalSpecialBetSelectionRow({
  selection,
  fixtureIndex,
  deciding = false,
  underway = false
}: Props) {
  const { t, locale } = useLocale();

  const label: FixtureLabel = resolveSelectionLabel(selection, fixtureIndex);
  const title = label.title ?? t("gsb.matchFallback", { id: selection.fixture_id });
  const league = label.league ?? t("gsb.leagueFallback", { id: selection.league_id });

  const marketKey = marketLabelKey(selection.market);
  const marketLabel = marketKey ? t(marketKey) : selection.market;

  const odds = formatOdds(selection.odds);
  const confidence = formatConfidencePercent(selection.confidence);
  const value = formatValueScore(selection.value_score);
  // The leg's own P(full win) — the number the ranking used (migration 050).
  // Null for pre-050 snapshots: a dash, never a fake 0%.
  const probability = formatProbabilityPercent(selection.probability);
  const dash = "—";

  const kickoff = formatDateTime(selection.kickoff_at, locale);

  /* A leg cannot be both: `deciding` only ever applies to a lost bet, and a lost
     leg is settled. Danger keeps precedence anyway — the failure outranks the
     clock.
     A running leg gets the accent border alone, no ring: the ring is reserved
     for the failure, so the two states stay ranked, and DESIGN.md's One Accent
     Rule keeps the accent off informational fills. */
  const emphasis = deciding
    ? "border-[var(--fp-danger)]/45 ring-1 ring-inset ring-[var(--fp-danger)]/20"
    : underway
      ? "border-[var(--fp-accent)]/45"
      : "border-[var(--fp-border)]";

  return (
    <li className={`rounded-[var(--fp-radius-sm)] border bg-[var(--fp-bg-card)] p-3 ${emphasis}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {deciding && (
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-[var(--fp-danger)]">
              {t("gsb.decidingLeg")}
            </p>
          )}
          {/* Muted ink, not accent: the accent reads at ~4.2:1 on a white card,
              under AA for text this small. The dot carries the colour signal and
              clears the 3:1 a graphical element needs. */}
          {!deciding && underway && (
            <p className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-[var(--fp-text-muted)]">
              {/* Same pulsing dot the Home "Live now" section uses for an in-play
                  match, motion-reduce guard included: one visual language for
                  "this is happening now". Accent, not danger — the card's own
                  colour identity, and danger here would read as a failure. */}
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-accent)] motion-reduce:animate-none" />
              {t("gsb.legUnderway")}
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

      {/* One readable row at 390px too: the numbers are what the user scans, so
          they stay on one line instead of wrapping into a list. Probability
          leads — it is the metric the probability-first engine ranked this leg
          on; odds, confidence and value score are context, not the headline. */}
      <dl className="mt-2.5 grid grid-cols-4 gap-1.5 border-t border-[var(--fp-border)] pt-2 sm:gap-2">
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-wide text-[var(--fp-text-muted)]">
            {t("gsb.probability")}
          </dt>
          <dd
            className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[var(--fp-text)]"
            aria-label={
              probability
                ? t("gsb.legProbabilityAria", { value: probability.replace("%", "") })
                : undefined
            }
          >
            {probability ?? dash}
          </dd>
        </div>
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
