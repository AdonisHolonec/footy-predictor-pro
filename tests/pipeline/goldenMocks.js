/**
 * Mutable mock targets for golden vitest suite / record script.
 * Stage modules import oddsPrefetch + teamElo; tests replace those exports.
 */

export let goldenOddsPayload = null;
export let goldenEloPair = null;

export function setGoldenMocks(mocks = {}) {
  goldenOddsPayload = mocks.odds ?? null;
  goldenEloPair = mocks.elo
    ? {
        eloHome: Number(mocks.elo.eloHome),
        eloAway: Number(mocks.elo.eloAway),
        thin: Boolean(mocks.elo.thin)
      }
    : null;
}

/** Minimal API-Football odds shape accepted by consensusMatchWinnerOdds. */
export function buildDefaultOddsPayload({ home = 2.1, draw = 3.4, away = 3.5 } = {}) {
  return {
    response: [
      {
        bookmakers: [
          {
            name: "GoldenBookA",
            bets: [
              {
                name: "Match Winner",
                values: [
                  { value: "Home", odd: String(home) },
                  { value: "Draw", odd: String(draw) },
                  { value: "Away", odd: String(away) }
                ]
              },
              {
                name: "Goals Over/Under",
                values: [
                  { value: "Over 1.5", odd: "1.35" },
                  { value: "Under 1.5", odd: "3.20" },
                  { value: "Over 2.5", odd: "1.95" },
                  { value: "Under 2.5", odd: "1.90" },
                  { value: "Over 3.5", odd: "3.10" },
                  { value: "Under 3.5", odd: "1.38" }
                ]
              },
              {
                name: "Both Teams Score",
                values: [
                  { value: "Yes", odd: "1.85" },
                  { value: "No", odd: "1.95" }
                ]
              },
              {
                name: "Double Chance",
                values: [
                  { value: "Home/Draw", odd: "1.30" },
                  { value: "Home/Away", odd: "1.35" },
                  { value: "Draw/Away", odd: "1.70" }
                ]
              }
            ]
          },
          {
            name: "GoldenBookB",
            bets: [
              {
                name: "Match Winner",
                values: [
                  { value: "Home", odd: String(home + 0.05) },
                  { value: "Draw", odd: String(draw) },
                  { value: "Away", odd: String(away - 0.05) }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

export const DEFAULT_ELO = { eloHome: 1620, eloAway: 1540, thin: false };
