# API-Football `/predictions` — Field Research (Benchmark Source)

Status: research doc for the `PredictionBenchmarkProvider` integration. This endpoint is used strictly as
an **external, read-only benchmark** against our own recommendation — see `server-utils/PredictionEngine/`
for PredictorV3 itself, which this document does not affect.

Fields below are documented from the published API-Football v3 `/predictions` contract. Anything not
already exercised against a live response in this repo is marked **[VERIFY]** — the implementation step
that builds `normalizeApiFootballPrediction()` fetches one real response for a known fixture and confirms
these before the normalizer ships.

## Endpoint

```
GET /predictions?fixture={fixtureId}
```

Single-fixture endpoint, one `predictions[0]` item in `response[]` (or empty array if the fixture/league
isn't covered). Goes through the repo's existing `server-utils/fetcher.js#getWithCache` — no new HTTP
client, no new caching mechanism.

## Fields available

### `predictions.winner`
| Field | Type | Notes |
|---|---|---|
| `winner.id` | number \| null | Team id API-Football favors. `null` when the model considers it too close to call. **[VERIFY]** null-vs-omitted behavior. |
| `winner.name` | string \| null | Team name, redundant with `id`. |
| `winner.comment` | string \| null | Short qualitative label (e.g. "Winner", "Draw"). Free text — grammar/vocabulary **[VERIFY]** across leagues before relying on exact string matches. |

### `predictions.win_or_draw`
| Field | Type | Notes |
|---|---|---|
| `win_or_draw` | boolean | Whether API-Football considers Double-Chance (favored team or draw) the safer bet. Useful secondary signal for the `dc` (Double Chance) family. |

### `predictions.percent`
| Field | Type | Notes |
|---|---|---|
| `percent.home` / `.draw` / `.away` | string, e.g. `"45%"` | The three implied-probability-shaped percentages, always provided, always sum to ~100. **[VERIFY]** exact string format (percent sign, rounding) before parsing to number. This is the closest thing to a "confidence" API-Football exposes — see "Missing fields" below. |

### `predictions.advice`
| Field | Type | Notes |
|---|---|---|
| `advice` | string \| null | Free-text natural-language sentence, e.g. `"Combo Double chance : X or Team A and -3.5 goals"`. **Not structured** — no separate pick/market/line fields. Treated as a low-confidence secondary signal only (regex-matched for known substrings), never as the primary comparison input, because its exact grammar is not contractually stable. **[VERIFY]** current phrasing/format. |

### `predictions.goals` / `predictions.under_over`
| Field | Type | Notes |
|---|---|---|
| `goals.home` / `.away` | string, e.g. `"-2.5"` / `"+2.5"` | An approximate goals-total lean per side, not a single match total line. Semantics are approximate/derived, not a clean Over/Under pick. **[VERIFY]** interpretation. |
| `under_over` | string \| null | Sometimes present as a single suggested O/U line (e.g. `"+2.5"`); frequently `null` for lower-tier leagues or when lineups aren't final. **[VERIFY]** presence rate. |

### `comparison` block (per-team percentage strings)
| Field | Type | Notes |
|---|---|---|
| `comparison.form.{home,away}` | string, e.g. `"56%"` | Recent-form comparison. |
| `comparison.att.{home,away}` | string | Attack-strength comparison. |
| `comparison.def.{home,away}` | string | Defense-strength comparison. |
| `comparison.poisson_distribution.{home,away}` | string | API-Football's own Poisson-based win-share comparison — analogous in spirit to our `PoissonEngine.js`, but a fully independent computation. |
| `comparison.h2h.{home,away}` | string | Head-to-head historical comparison. |
| `comparison.goals.{home,away}` | string | Goals-scored comparison. |
| `comparison.total.{home,away}` | string | Aggregate/composite comparison score across the above. |

All `comparison.*` values are percentage strings per team (not a single delta) — **[VERIFY]** exact key set, as API-Football has added/renamed comparison sub-keys across versions.

### `teams.{home,away}.last_5`
| Field | Type | Notes |
|---|---|---|
| `teams.home.last_5.form` / `.att` / `.def` | string / number | Rolling last-5-matches summary. |
| `teams.home.last_5.goals.for.{average,total}` | number | Goals scored, avg + total over last 5. |
| `teams.home.last_5.goals.against.{average,total}` | number | Goals conceded, avg + total over last 5. |
| (same shape under `teams.away.last_5`) | | **[VERIFY]** exact nested field names — this block has had minor shape changes historically. |

### `h2h[]`
| Field | Type | Notes |
|---|---|---|
| `h2h[]` | array of fixture summaries | Past meetings between the two teams: fixture id/date, goals, winner. Used only as supplementary context, not part of the pick comparison. **[VERIFY]** per-item field names (`fixture.date` vs `date`, `teams`/`goals` nesting). |

## Missing fields (explicitly not provided)

- **No numeric confidence score.** `percent.{home,draw,away}` is the closest proxy, but it is API-Football's
  own model output, not a calibrated confidence figure comparable to our `ConfidenceEngine.js` output. Do not
  present it to users as "confidence" without labeling it as an external estimate.
- **No implied odds / no EV field.** API-Football's `/predictions` payload carries no pricing information —
  odds context, if ever needed alongside this, must keep coming from our own `marketOdds.js` pipeline.
- **No timestamp of when API-Football computed the prediction.** Only our own fetch time is knowable; store
  `fetchedAt` for that reason, and don't imply the two predictions were "generated at the same instant."
  Both are independently timestamped: ours at kickoff-relative prediction time, API-Football's at whatever
  moment they last recomputed the fixture (unknown, possibly re-computed on every request — **[VERIFY]**).
- **`goals`/`under_over` are frequently `null`** for lower-tier leagues, fixtures far from kickoff, or when
  lineups aren't confirmed — the normalizer must treat every field as optional and never assume a value exists.
- **No structured market/line breakdown for `advice`.** It's prose; any market/line extracted from it is
  a best-effort regex, not a guaranteed-correct parse.

## Why this shapes the normalization strategy

Because the only two *structured, reliably present* signals are `winner` (a 1X2-shaped pick) and `percent`
(a 1X2-shaped probability triple), the comparison model (`BenchmarkConsensus.js`) treats **1X2 as the
primary comparable family**, and treats `goals`/`under_over`/`advice`-derived Over/Under or BTTS signals as
**secondary, lower-confidence family classifications** — each carrying its own `source` tag (`"winner"` |
`"percent"` | `"goals"` | `"advice"`) so a consumer can see how firm the inferred pick actually is. See
`server-utils/predictionBenchmark/normalizeApiFootballPrediction.js` for the mapping implementation and
`server-utils/predictionBenchmark/BenchmarkConsensus.js` for how family-comparability is decided.
