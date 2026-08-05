---
type: "query"
date: "2026-08-04T18:52:57.219193+00:00"
question: "API-Football Total ShotOnGoal and Total Shots odds display"
contributor: "graphify"
outcome: "useful"
source_nodes: ["SHOTS_SOT_MARKET_NAMES", "SHOTS_TOTAL_MARKET_NAMES", "resolveShotsOnTargetMarketQuote", "shotsDisplayOdd"]
---

# Q: API-Football Total ShotOnGoal and Total Shots odds display

## Answer

Root cause: normalizeMarketName did not split camelCase so Total ShotOnGoal failed shots_on_target gate. Fixed normalize + market name lists (bet 87/211), preferred bookmakers Betano/Superbet, buildOuQuotePayload over/under, and UI odds on FocusCard/MatchCard/MatchModal.

## Outcome

- Signal: useful

## Source Nodes

- SHOTS_SOT_MARKET_NAMES
- SHOTS_TOTAL_MARKET_NAMES
- resolveShotsOnTargetMarketQuote
- shotsDisplayOdd