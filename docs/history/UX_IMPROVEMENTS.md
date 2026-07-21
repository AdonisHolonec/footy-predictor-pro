# UX_IMPROVEMENTS.md
## Prioritized UX V4 Improvements (No Engine Changes)

Ordered by user impact × feasibility. Implementation is **blocked until audit approval**.

---

## P0 — First 30 seconds / trust

| # | Improvement | Why | Approach |
|---|-------------|-----|----------|
| 1 | Home answers “best opportunities today?” above fold | Core brief | Single hero stack: Summary → Top Pick → Highest Confidence → Best Value → Live strip |
| 2 | Unify design tokens on MatchCard + MatchModal | Dual systems hurt trust | Migrate `signal-*` → `--fp-*` only |
| 3 | Fix dead `isNotificationsOpen` | Broken wiring | Remove or connect to Notifications view |
| 4 | Touch targets 44px on ★ / Share / filter chips | Mobile usability | Use `--fp-touch` |
| 5 | Empty & error states with next action | Reduce bounce | EmptyState + ErrorState + Retry |

---

## P1 — Navigation & findability

| # | Improvement | Why | Approach |
|---|-------------|-----|----------|
| 6 | Top-level LIVE | Bettors expect Live | Nav item → `matches` + filter live |
| 7 | Top-level PREDICTIONS | Curated lens | Same preds, Top Pick / value sort |
| 8 | SETTINGS split from Profile | Cleaner IA | Theme, filter defaults, GDPR, onboarding |
| 9 | Desktop visible search | ⌘K discovery weak | Icon opens CommandPalette |
| 10 | History rows openable | Incomplete loop | Open MatchModal when fixture id available |
| 11 | Max 3 clicks to any info | Brief SLA | Flatten tabs + deep links via palette |

---

## P2 — Match card & detail

| # | Improvement | Why | Approach |
|---|-------------|-----|----------|
| 12 | Compact card fields checklist | Parity with sports apps | Competition, kickoff, logos, prediction, confidence, probability, value badge, odds, expand, ★, share, bookmark |
| 13 | Separate Favorite vs Bookmark | Conflated today | Watchlist = Favorite; Bookmark = saved for later (local) |
| 14 | Detail tabs redesign | Endless scroll → tabs | Overview · Prediction · Statistics · H2H · Form · xG · Monte Carlo · Value · Markets · Explanation · Timeline |
| 15 | Bettor terminology pass | Jargon | Apply DESIGN_SYSTEM.md glossary on all user labels |

---

## P3 — Filters, search, persistence

| # | Improvement | Why | Approach |
|---|-------------|-----|----------|
| 16 | Persist search / settled / matchesFilter | Friction | Extend `useUiPrefs` |
| 17 | Markets filter | Bettor workflow | UI filter on existing markets in pred payload |
| 18 | Broader global search | Limited to current preds | Index teams/leagues/history labels client-side first |
| 19 | Favorites filter polish | Already exists | Persist + empty state CTA |

---

## P4 — Micro-interactions & polish

| # | Improvement | Why | Approach |
|---|-------------|-----|----------|
| 20 | Share copy toast | Silent clipboard | Toast “Link copiat” |
| 21 | Skeleton for Predict / History / Stats | Perceived speed | Skeleton primitives |
| 22 | Page view transition | Continuity | Subtle fade 150ms on `navView` |
| 23 | Modal tab scroll + larger hit area | Mobile tabs cramped | Horizontal scroll + min-height |
| 24 | Focus rings consistently | A11y | Button primitive everywhere |

---

## P5 — Performance (UI-only)

| # | Improvement | Why | Approach |
|---|-------------|-----|----------|
| 25 | True list virtualization | “Virtualized” is pagination | `@tanstack/react-virtual` on match grid |
| 26 | Lazy MatchModal heavy tabs | Bundle / TTI | Lazy load Monte Carlo / charts |
| 27 | Reduce Landing weight | Marketing LCP | Defer below-fold TrackRecord charts |

---

## Explicit non-goals (V4 UI)

- No prediction formula changes  
- No API / DB / Stripe rule changes  
- No auth permission model changes  
- No admin UI redesign (except ensuring isolation)  
- No copying SofaScore/Bet365 visual skins  

---

## Suggested implementation phases

1. **Foundation:** tokens unify + Button/Empty/Error + dead state fix  
2. **IA:** nav LIVE/PREDICTIONS/SETTINGS + Home hierarchy  
3. **Match:** card + modal tabs + terminology  
4. **Filters/search:** persistence + palette + toast  
5. **Perf/a11y pass:** virtualize, lazy tabs, Lighthouse gate  

Each phase ships with regression checklist from `REGRESSION_REPORT.md`.
