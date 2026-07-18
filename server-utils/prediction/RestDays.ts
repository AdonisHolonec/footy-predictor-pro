import type { ModuleScore, PredictionContext } from "./types.js";

function restFactor(fixtureDate: Date | null, lastDate: Date | null): number {
  if (!fixtureDate || !lastDate || Number.isNaN(fixtureDate.getTime()) || Number.isNaN(lastDate.getTime())) {
    return 1.0;
  }
  const days = (fixtureDate.getTime() - lastDate.getTime()) / 86400000;
  if (days < 3) return 0.94;
  if (days > 7) return 1.03;
  return 1.0 + (days - 4) * 0.01;
}

/** Rest/fatigue score from days since last match; neutral 1.0 when dates missing. */
export function computeRestDays(ctx: PredictionContext): ModuleScore {
  const fixtureDate = ctx.fixtureDate ? new Date(ctx.fixtureDate) : null;
  const homeLast = ctx.homeLastMatchDate ? new Date(ctx.homeLastMatchDate) : null;
  const awayLast = ctx.awayLastMatchDate ? new Date(ctx.awayLastMatchDate) : null;

  if (!homeLast && !awayLast) {
    return { score: 1.0, detail: { home: 1.0, away: 1.0, available: false } };
  }

  const home = restFactor(fixtureDate, homeLast);
  const away = restFactor(fixtureDate, awayLast);

  return {
    score: (home + away) / 2,
    detail: { home, away, available: true }
  };
}
