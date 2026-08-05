---
type: "query"
date: "2026-08-04T19:16:06.572095+00:00"
question: "why some live matches show momentum at minute 70 and others do not"
contributor: "graphify"
outcome: "useful"
source_nodes: ["buildMomentumEngine", "mergeLiveMomentum", "fetchMomentumForFixture", "handleLive"]
---

# Q: why some live matches show momentum at minute 70 and others do not

## Answer

UI requires match.momentum. Server buildMomentumEngine needs usable /fixtures/statistics on BOTH sides; empty/low-league stats or cached empty payloads return null. Client poll also wiped previous good momentum on null. Fixed: preserve last momentum while in play, map stats by team id, skip caching empty statistics.

## Outcome

- Signal: useful

## Source Nodes

- buildMomentumEngine
- mergeLiveMomentum
- fetchMomentumForFixture
- handleLive