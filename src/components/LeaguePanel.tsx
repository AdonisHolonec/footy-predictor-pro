import { League } from "../types";
import { useLocale } from "../context/LocaleContext";

type LeaguePanelProps = {
  leaguesSorted: League[];
  selectedSet: Set<number>;
  selectedLeagueIds: number[];
  isLeaguesOpen: boolean;
  searchLeague: string;
  eliteLeagues: number[];
  setIsLeaguesOpen: (open: boolean) => void;
  setSearchLeague: (value: string) => void;
  setSelectedLeagueIds: (ids: number[]) => void;
  selectEliteLeagues: () => void;
  clearLeagueSelection: () => void;
};

export default function LeaguePanel({
  leaguesSorted,
  selectedSet,
  selectedLeagueIds,
  isLeaguesOpen,
  searchLeague,
  eliteLeagues,
  setIsLeaguesOpen,
  setSearchLeague,
  setSelectedLeagueIds,
  selectEliteLeagues,
  clearLeagueSelection
}: LeaguePanelProps) {
  const { t } = useLocale();

  return (
    <div className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-sm)] lg:sticky lg:top-5">
      <div className="border-b border-[var(--fp-border)] px-3 py-2.5">
        <button
          type="button"
          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--fp-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
          onClick={() => setIsLeaguesOpen(!isLeaguesOpen)}
          aria-expanded={isLeaguesOpen}
          aria-controls="league-panel-content"
        >
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-[var(--fp-text)]">{t("leagues.title")}</h2>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--fp-accent)]">{t("leagues.eyebrow")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {selectedSet.size > 0 && (
              <span className="rounded-full border border-[var(--fp-accent)]/30 bg-[var(--fp-accent-muted)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--fp-accent)]">
                {selectedSet.size}
              </span>
            )}
            <span className="text-[var(--fp-text-muted)]" aria-hidden>
              {isLeaguesOpen ? "▾" : "▸"}
            </span>
          </div>
        </button>
      </div>
      {isLeaguesOpen && (
        <div id="league-panel-content" className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              id="league-search"
              type="text"
              placeholder={t("leagues.search")}
              value={searchLeague}
              onChange={(e) => setSearchLeague(e.target.value)}
              aria-label={t("leagues.searchLabel")}
              className="h-9 min-w-[8rem] flex-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-2.5 text-sm font-medium text-[var(--fp-text)] placeholder:text-[var(--fp-text-faint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
            />
            <button
              type="button"
              title={t("leagues.eliteTitle")}
              onClick={(e) => {
                e.stopPropagation();
                selectEliteLeagues();
              }}
              className="h-9 rounded-[var(--fp-radius-sm)] border border-[var(--fp-accent)]/35 bg-[var(--fp-accent-muted)] px-2.5 text-[11px] font-bold text-[var(--fp-accent)]"
            >
              {t("leagues.eliteAll")}
            </button>
            <button
              type="button"
              title={t("leagues.clearTitle")}
              onClick={(e) => {
                e.stopPropagation();
                clearLeagueSelection();
              }}
              className="h-9 rounded-[var(--fp-radius-sm)] border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-2.5 text-[11px] font-bold text-[var(--fp-danger)]"
            >
              {t("leagues.clear")}
            </button>
          </div>
          <div className="custom-scrollbar max-h-[50vh] space-y-1 overflow-y-auto pr-0.5 sm:max-h-[60vh]">
            {leaguesSorted.map((lg) => (
              <button
                key={lg.id}
                type="button"
                onClick={() => {
                  const s = new Set(selectedLeagueIds);
                  s.has(lg.id) ? s.delete(lg.id) : s.add(lg.id);
                  setSelectedLeagueIds(Array.from(s));
                }}
                className={`flex h-9 w-full items-center justify-between gap-2 rounded-[var(--fp-radius-sm)] border px-2.5 text-left text-sm touch-manipulation ${
                  selectedSet.has(lg.id)
                    ? "border-[var(--fp-accent)]/40 bg-[var(--fp-accent-muted)]"
                    : "border-[var(--fp-border)] bg-[var(--fp-bg-card)] hover:bg-[var(--fp-bg-muted)]"
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {eliteLeagues.includes(Number(lg.id)) && (
                    <span className="shrink-0 text-[10px] text-[var(--fp-warning)]">◆</span>
                  )}
                  {lg.logo && <img src={lg.logo} className="h-4 w-4 rounded object-contain" alt="" />}
                  <span className="truncate font-semibold text-[var(--fp-text)]">{lg.name}</span>
                  <span className="truncate text-[10px] font-medium text-[var(--fp-text-muted)]">{lg.country}</span>
                </div>
                <span className="shrink-0 text-[10px] font-bold tabular-nums text-[var(--fp-text-muted)]">{lg.matches}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
