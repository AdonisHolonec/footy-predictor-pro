import { result, neutral } from "./helpers.js";

function restFactor(fixtureDate, lastDate) {
  if (!fixtureDate || !lastDate || Number.isNaN(fixtureDate.getTime()) || Number.isNaN(lastDate.getTime())) {
    return 1.0;
  }
  const days = (fixtureDate.getTime() - lastDate.getTime()) / 86400000;
  if (days < 3) return 0.94;
  if (days > 7) return 1.03;
  return 1.0 + (days - 4) * 0.01;
}

export function calculate(ctx) {
  const fixtureDate = ctx.fixtureDate ? new Date(ctx.fixtureDate) : null;
  const homeLast = ctx.homeLastMatchDate ? new Date(ctx.homeLastMatchDate) : null;
  const awayLast = ctx.awayLastMatchDate ? new Date(ctx.awayLastMatchDate) : null;

  if (!homeLast && !awayLast) return neutral({ reason: "no_rest_dates" });

  const home = restFactor(fixtureDate, homeLast);
  const away = restFactor(fixtureDate, awayLast);
  return result((home + away) / 2, 0.55, { home, away, available: true });
}

export const RestDaysEngine = { calculate, name: "restDays" };
