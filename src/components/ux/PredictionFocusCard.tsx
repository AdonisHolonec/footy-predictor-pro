import type { PredictionRow } from "../../types";
import { isFixtureInPlay } from "../../utils/appUtils";
import { useLocale } from "../../context/LocaleContext";

type Props = {
  row: PredictionRow;
  watched?: boolean;
  onToggleWatch?: () => void;
  onOpen: () => void;
};

function deriveOdd(row: PredictionRow): string {
  const explicit = Number(row.recommended?.odd);
  if (Number.isFinite(explicit) && explicit > 1) return explicit.toFixed(2);
  const pick = (row.recommended?.pick || "").trim().toLowerCase();
  if (pick === "1" && Number.isFinite(Number(row.odds?.home))) return Number(row.odds?.home).toFixed(2);
  if (pick === "x" && Number.isFinite(Number(row.odds?.draw))) return Number(row.odds?.draw).toFixed(2);
  if (pick === "2" && Number.isFinite(Number(row.odds?.away))) return Number(row.odds?.away).toFixed(2);
  return "—";
}

/** Compact consumer prediction card — whole card opens analysis. */
export default function PredictionFocusCard({ row, watched, onToggleWatch, onOpen }: Props) {
  const { t } = useLocale();
  const conf = Number(row.recommended?.confidence);
  const confLabel = Number.isFinite(conf) ? `${Math.round(conf)}%` : row.recommended?.confidenceCategory || "—";
  const ev = Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue);
  const hasValue = row.valueBet?.detected || (Number.isFinite(ev) && ev > 0);
  const live = isFixtureInPlay(row.status);
  const kickoff = new Date(row.kickoff);
  const time = Number.isFinite(kickoff.getTime())
    ? kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  if (row.insufficientData) {
    return (
      <article
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="cursor-pointer rounded-[var(--fp-radius)] border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)]"
      >
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-warning)]">{t("card.limitedData")}</p>
        <p className="mt-1 font-display text-base font-semibold text-[var(--fp-text)]">
          {row.teams.home} {t("common.vs")} {row.teams.away}
        </p>
        <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("card.openForDetails")}</p>
      </article>
    );
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)] transition-[box-shadow,transform] duration-[var(--fp-ease)] hover:-translate-y-0.5 hover:shadow-[var(--fp-shadow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {row.logos?.league ? <img src={row.logos.league} alt="" className="h-4 w-4 object-contain" /> : null}
            <p className="truncate text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
              {row.league}
            </p>
            {live && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--fp-danger)]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--fp-danger)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-danger)] motion-reduce:animate-none" />
                {t("card.live")}
              </span>
            )}
            {hasValue && (
              <span className="rounded-full bg-[var(--fp-warning)]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--fp-warning)]">
                {t("card.value")}
              </span>
            )}
            <span className="font-mono text-[11px] tabular-nums text-[var(--fp-text-faint)]">{time}</span>
          </div>
        </div>
        {onToggleWatch && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatch();
            }}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--fp-radius-sm)] border text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
              watched
                ? "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]"
                : "border-[var(--fp-border)] text-[var(--fp-text-muted)]"
            }`}
            title={watched ? t("card.removeFavorite") : t("card.addFavorite")}
            aria-label={watched ? t("card.removeFavorite") : t("card.addFavorite")}
            aria-pressed={watched}
          >
            ★
          </button>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 flex-col items-center gap-1">
          <img src={row.logos?.home} alt="" className="h-10 w-10 object-contain sm:h-11 sm:w-11" />
          <span className="line-clamp-2 text-center text-xs font-semibold text-[var(--fp-text)] sm:text-sm">
            {row.teams.home}
          </span>
        </div>
        <span className="text-[10px] font-bold uppercase text-[var(--fp-text-faint)]">{t("common.vs")}</span>
        <div className="flex min-w-0 flex-col items-center gap-1">
          <img src={row.logos?.away} alt="" className="h-10 w-10 object-contain sm:h-11 sm:w-11" />
          <span className="line-clamp-2 text-center text-xs font-semibold text-[var(--fp-text)] sm:text-sm">
            {row.teams.away}
          </span>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-1 border-t border-[var(--fp-border)] pt-2">
        {[
          { label: t("card.prediction"), value: row.recommended?.pick || "—", accent: true },
          { label: t("card.confidence"), value: confLabel },
          { label: t("card.odds"), value: deriveOdd(row) },
          {
            label: t("card.value"),
            value: Number.isFinite(ev) && ev !== 0 ? `${ev > 0 ? "+" : ""}${ev.toFixed(1)}%` : hasValue ? t("common.yes") : "—"
          }
        ].map((m) => (
          <div key={m.label} className="min-w-0 px-0.5 text-center">
            <p className="truncate text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{m.label}</p>
            <p
              className={`mt-0.5 truncate font-display text-sm font-bold tabular-nums ${
                m.accent ? "text-[var(--fp-accent)]" : "text-[var(--fp-text)]"
              }`}
            >
              {m.value}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}
