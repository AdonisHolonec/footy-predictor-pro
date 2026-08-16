import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import type { MarketPref } from "../../hooks/useUiPrefs";

type LeagueOption = { id: number; name: string; country: string };

type Props = {
  leagueOptions: LeagueOption[];
  initialLeagueIds: number[];
  onComplete: (result: { leagueIds: number[]; markets: MarketPref[] }) => void;
};

const MARKET_OPTIONS: { id: MarketPref; labelKey: string }[] = [
  { id: "oneXTwo", labelKey: "dash.marketOneXTwo" },
  { id: "overUnder", labelKey: "dash.marketOverUnder" },
  { id: "btts", labelKey: "dash.marketBtts" }
];

export default function OnboardingCarousel({ leagueOptions, initialLeagueIds, onComplete }: Props) {
  const { t } = useLocale();
  const [step, setStep] = useState(0);
  const [leagueIds, setLeagueIds] = useState<number[]>(initialLeagueIds);
  const [markets, setMarkets] = useState<MarketPref[]>([]);
  const isLast = step === 1;

  const toggleLeague = (id: number) => {
    setLeagueIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  const toggleMarket = (id: MarketPref) => {
    setMarkets((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  const finish = () => onComplete({ leagueIds, markets });
  // Skipping declines the questions — it must not wipe an existing league selection
  // (the parent overwrites favorites with whatever we send back).
  const skip = () => onComplete({ leagueIds: initialLeagueIds, markets: [] });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fp-navy/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-6 shadow-fp sm:p-8">
        <button
          type="button"
          onClick={skip}
          className="self-end text-xs font-semibold text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
        >
          {t("flow.onboardingSkip")}
        </button>

        {step === 0 ? (
          <div className="mt-2">
            <h1 className="font-display text-xl font-semibold text-[var(--fp-text)]">
              {t("flow.onboardingLeaguesTitle")}
            </h1>
            <p className="mt-2 text-sm text-[var(--fp-text-muted)]">{t("flow.onboardingLeaguesBody")}</p>

            <div className="mt-4 flex items-center justify-between text-xs font-semibold text-[var(--fp-accent)]">
              <button type="button" onClick={() => setLeagueIds(leagueOptions.map((l) => l.id))} className="hover:underline">
                {t("flow.onboardingLeaguesSelectAll")}
              </button>
              <span className="text-[var(--fp-text-muted)]">{t("flow.onboardingLeaguesCount", { n: leagueIds.length })}</span>
              <button type="button" onClick={() => setLeagueIds([])} className="hover:underline">
                {t("flow.onboardingLeaguesClear")}
              </button>
            </div>

            <div className="mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {leagueOptions.map((league) => {
                const active = leagueIds.includes(league.id);
                return (
                  <button
                    key={league.id}
                    type="button"
                    onClick={() => toggleLeague(league.id)}
                    aria-pressed={active}
                    className={`rounded-[var(--fp-radius-sm)] border px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                      active
                        ? "border-[var(--fp-accent)] bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                        : "border-[var(--fp-border)] text-[var(--fp-text)] hover:border-[var(--fp-border-strong)]"
                    }`}
                  >
                    <span className="line-clamp-2">{league.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <h1 className="font-display text-xl font-semibold text-[var(--fp-text)]">
              {t("flow.onboardingMarketsTitle")}
            </h1>
            <p className="mt-2 text-sm text-[var(--fp-text-muted)]">{t("flow.onboardingMarketsBody")}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {MARKET_OPTIONS.map((market) => {
                const active = markets.includes(market.id);
                return (
                  <button
                    key={market.id}
                    type="button"
                    onClick={() => toggleMarket(market.id)}
                    aria-pressed={active}
                    className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
                      active
                        ? "border-[var(--fp-accent)] bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                        : "border-[var(--fp-border)] text-[var(--fp-text)] hover:border-[var(--fp-border-strong)]"
                    }`}
                  >
                    {t(market.labelKey)}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-[var(--fp-text-faint)]">{t("flow.onboardingMarketsSkipNote")}</p>
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-1.5">
          {[0, 1].map((idx) => (
            <span
              key={idx}
              className={`h-1.5 rounded-full transition-all ${
                idx === step ? "w-6 bg-[var(--fp-accent)]" : "w-1.5 bg-[var(--fp-border-strong)]"
              }`}
            />
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          {isLast && (
            <Button variant="ghost" className="shrink-0" onClick={() => setStep(0)}>
              {t("flow.onboardingBack")}
            </Button>
          )}
          <Button className="w-full" onClick={() => (isLast ? finish() : setStep(1))}>
            {isLast ? t("flow.onboardingGetStarted") : t("flow.onboardingNext")}
          </Button>
        </div>
      </div>
    </div>
  );
}
