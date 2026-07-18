# Feature Roadmap UI — Placeholders & Integration (No Backend Changes)

**Rule:** Design and wire **UI + local state** only. Do not invent API contracts that mutate prediction math. When backend is ready later, swap adapters.

---

## 1. Feature inventory

| Feature | UI surface | Storage v1 | Backend later |
|---------|------------|------------|---------------|
| Watchlist (matches) | Nav · card ★ | `localStorage` | user table |
| Favorite teams | Filters · Settings | localStorage | profiles |
| Favorite leagues | Existing + Pins | existing + local | existing |
| Recently viewed | Continue strip | session/local | optional |
| Compare two matches | Detail action | session | — |
| Compare two models | Admin Models / upgrade gate | existing Model Lab | — |
| Confidence explanation | Overview → Confidence tab | existing engine | — |
| Match difficulty | Badge on card/detail | derived client | — |
| Betting risk meter | Detail Overview | derived client | — |
| Smart search | Search field | client filter | search API |
| Command palette ⌘K | Global | client | — |
| Quick actions | Palette + FABs | client | — |
| Notifications center | Bell drawer | local stubs + prefs | push |
| Daily digest | Drawer section | stub | email cron |
| Saved filters | Sticky bar | localStorage | — |
| Personal dashboard | Today Overview | composition | — |
| AI Insights panel | Detail tab / side | copy from explanation + FI | — |
| Explain prediction | Button → Prediction tab | existing | — |
| Historical timeline | Timeline tab | evaluation/meta if any | history API |
| Prediction changes over time | Timeline sparkline | stub / meta | snapshots |
| Upcoming alerts | Notifications | stub | — |
| Theme selector | Settings + Nav | localStorage | — |
| Custom dashboard widgets | Today customize | localStorage layout | — |
| Drag & drop widgets | Edit mode Today | localStorage | — |

---

## 2. Derived UI metrics (client-only, honest)

Document formulas so we never claim new model outputs:

### Match difficulty (1–5)
```
difficulty ∝ competitiveness + ouCloseness
from monteCarlo.adaptive.components OR
from 1 - max(p1,pX,p2)/100 normalized
```
Show as dots; tooltip explains “closeness of match odds / model”.

### Risk meter (1–5)
```
higher risk if lower confidence OR negative EV OR high difficulty
```
Display only; not stake advice engine.

### AI Insights
Bullet list assembled from:

- `explanation` top lines  
- top 3 `predictionContributions`  
- `confidenceEngine` weakest dimension  

Button **Explain prediction** scrolls/opens Prediction tab.

---

## 3. Phased delivery

### Phase UI-0 — Foundation (1 week)
- Design tokens (`DESIGN_SYSTEM.md`)  
- Theme toggle (dark/light)  
- TopNav skeleton  
- Sticky filters shell  

### Phase UI-1 — Match surfaces (1–2 weeks)
- MatchCard declutter  
- Match Detail tabs (all existing panels remounted)  
- Contribution horizontal bars restyle  
- Monte Carlo charts-first layout  

### Phase UI-2 — Today Overview (1 week)
- KPI strip  
- Recommended / Value rails  
- Continue + recently viewed  
- Personal dashboard default layout  

### Phase UI-3 — Productivity (1 week)
- ⌘K command palette  
- Smart search (client)  
- Saved filters  
- Watchlist ★ + favorite teams  
- Notifications drawer stubs  
- Quick actions (Predict, Warm, History)  

### Phase UI-4 — Admin IA (1–2 weeks)
- AdminShell nav  
- Move labs to sections (`ADMIN_DASHBOARD_V3.md`)  
- KPI dashboard composition  

### Phase UI-5 — Delight (ongoing)
- Drag & drop widget layout  
- Compare matches  
- Timeline tab polish  
- High contrast theme  
- Daily digest UI  
- Custom widgets catalog  

---

## 4. Component / state sketch

```ts
// client-only stores (illustrative)
type UiPrefsV3 = {
  theme: "dark" | "light" | "contrast";
  watchlistFixtureIds: number[];
  favoriteTeamIds: number[];
  pinnedLeagueIds: number[];
  savedFilters: SavedFilter[];
  recentFixtureIds: number[];
  dashboardLayout: WidgetId[];
};
```

Persist key: `footy:ui:v3:${userId}`.

---

## 5. Wireframes — new features

### Command palette

```
┌─────────────────────────────────────┐
│ Search actions & matches…           │
├─────────────────────────────────────┤
│ → Predict today                     │
│ → Warm cache                        │
│ → Match: Arsenal vs Chelsea         │
│ → League: La Liga                   │
│ → Admin: Monitoring          (admin)│
└─────────────────────────────────────┘
```

### Watchlist

```
Watchlist
★ ARS-CHE  20:45  Pick O2.5  Conf 72
★ RMA-BAR  22:00  Pick 1     Conf 61
Empty: “Star matches from Today.”
```

### Compare matches

```
┌─────────────┬─────────────┐
│ Match A     │ Match B     │
│ Pick / Conf │ Pick / Conf │
│ 1X2 bars    │ 1X2 bars    │
│ EV          │ EV          │
└─────────────┴─────────────┘
```

### Widget editor (Today)

```
[ Edit dashboard ]
┌ KPI ⋮⋮ ┐  ┌ KPI ⋮⋮ ┐  ┌ Recommended ⋮⋮ ────┐
│        │  │        │  │                      │
└────────┘  └────────┘  └──────────────────────┘
(+ Add widget)
```

---

## 6. Zero-regression gates per phase

| Gate | Check |
|------|-------|
| G1 | `npm test` green |
| G2 | Warm → Predict → cards render |
| G3 | All former MatchModal sections exist as tabs |
| G4 | Admin can open Enterprise, Health, Model Lab, Backtest, Users |
| G5 | Tier locks behave identically on sample free/premium/ultra payloads |
| G6 | History / live poll / GDPR export reachable |
| G7 | Feature flag off → legacy shell still works |

---

## 7. Out of scope (explicit)

- Stripe checkout UI beyond placeholder Revenue KPI  
- Live in-play model  
- Changing calibration / MC / engine  
- New serverless routes (unless later product asks)  
- Copying SofaScore/Flashscore visual assets  

---

## 8. Success criteria (product)

| Metric | Target |
|--------|--------|
| Premium feel (internal review) | Pass design critique |
| Time to pick detail | ≤ 2 clicks |
| Widget customization adoption | Optional; default layout excellent alone |
| Support tickets “where is X lab?” | ↓ after Admin IA |
| Regression bugs from UX | 0 P0 |

---

## 9. Doc index

| Doc | Purpose |
|-----|---------|
| `UI_UX_MASTERPLAN.md` | Vision, IA, migration |
| `DESIGN_SYSTEM.md` | Tokens, a11y, themes |
| `COMPONENT_LIBRARY.md` | Building blocks |
| `USER_EXPERIENCE_V3.md` | User flows |
| `ADMIN_DASHBOARD_V3.md` | Admin SaaS IA |
| `FEATURE_ROADMAP_UI.md` | This file — phased UI features |

---

## 10. Recommended first implementation PR (when coding starts)

1. Tokens + theme toggle  
2. `MatchDetailShell` tabs wrapping existing modal body sections  
3. `MatchCard` content reduction (CSS/structure)  
4. Feature flag `VITE_UX_V3`

No business logic changes in that PR.
