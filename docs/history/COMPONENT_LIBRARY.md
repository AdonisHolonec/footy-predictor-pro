# Component Library V3

**Maps to:** existing React components (wrap/refactor UI only).  
**Rule:** Presentational components receive the same props/types (`PredictionRow`, etc.). No new backend.

---

## 1. Hierarchy

```
AppShell
├── TopNav
├── CommandPalette
├── NotificationsDrawer
├── StickyFilterBar
├── PageContainer
│   ├── TodayOverview
│   ├── MatchFeed
│   ├── MatchDetailShell (tabs)
│   ├── HistoryView
│   ├── LiveView (placeholder)
│   └── WatchlistView
└── AdminShell (role=admin)
    └── AdminNav + AdminPage slots
```

**Atoms → Molecules → Organisms** below.

---

## 2. Atoms

| Component | Spec | Replaces / wraps |
|-----------|------|------------------|
| `Button` | variants: primary, secondary, ghost, danger; sizes sm/md/lg; loading | ad-hoc buttons |
| `IconButton` | 44px hit; aria-label required | header icons |
| `Badge` | LIVE, WIN, LOSE, VALUE, SAFE, LOCKED, OPEN, CONF | card chips |
| `ConfidenceBadge` | exact % **or** category **or** Locked | MatchCard confidence |
| `ValueBadge` | +EV / Fair / No edge | valueBet.detected |
| `RiskMeter` | 5-segment; derived client-side from conf+EV (display only) | new UI |
| `AvatarTeam` | logo + fallback initials | logos |
| `ProgressBar` | 1X2 / contribution | prob bars |
| `Sparkline` | 24–48px width | new (from probs or MC) |
| `Skeleton` | card / row / chart | loading |
| `Input`, `Select`, `Slider` | filter controls | DatePicker evolution |
| `Tooltip`, `Kbd` | ⌘K hints | — |
| `EmptyState` | illustration + CTA | — |
| `LockChip` | tier lock | 🔒 chips |

---

## 3. Molecules

| Component | Contents | Data |
|-----------|----------|------|
| `MatchIdentity` | logos · names · kickoff · league | teams, logos, kickoff, league |
| `PickRow` | pick · odd · conf · value | recommended, odds |
| `ProbTripleBars` | p1/pX/p2 | probs |
| `KpiCard` | label · value · delta · spark | analytics |
| `FilterChip` | removable | filters |
| `ContributionBar` | label · bar · % | featureImportance / contributions |
| `ThemeToggle` | dark/light/contrast | localStorage |
| `SearchField` | debounce | client search |

### Contribution bars (Feature Importance)

```
Attack      ████████████░░░░  24%
Defense     ██████████░░░░░░  18%
Form        ████████░░░░░░░░  14%
Injuries    ████░░░░░░░░░░░░   8%
Weather     ██░░░░░░░░░░░░░░   3%
```

Horizontal, shared max scale, mono %; use `PredictionContributionsChart` / `FeatureImportanceChart` data — restyle only.

---

## 4. Organisms

### 4.1 `MatchCardV3`

**Props:** `match: PredictionRow` + tier flags (existing heuristics).

**Slots:** Identity · PickRow · ProbTripleBars · Sparkline · Badge row · Expand.

**Must not render on card:** full Explanation, Lab radar, full MC, long FI (those → detail tabs).

**Maps from:** `src/components/MatchCard.tsx`.

### 4.2 `MatchDetailShell`

Tabs (see masterplan). Each tab mounts **existing** panels:

| Tab | Existing component |
|-----|-------------------|
| Overview | header excerpt + ProbTripleBars + teamContext |
| Prediction | `PredictionLaboratory`, `ExplanationCard`, `PredictionContributionsChart` |
| Statistics | market tiers / predictions block |
| Team Form | standings + SignalLab form ribbons |
| H2H | placeholder until data |
| Odds | odds grids |
| xG | `LuckBadge`, `XGPerformanceBar` |
| Confidence | `ConfidenceEnginePanel` |
| Feature Importance | restyled FI + contributions |
| Monte Carlo | `MonteCarloPanel` (charts-first) |
| Value | `ValueCard` |
| Timeline | placeholder / evaluation history if present |
| Live | placeholder |

**Maps from:** `src/components/MatchModal.tsx` (reorder into tabs; preserve all sections).

### 4.3 `StickyFilterBar`

Date · Leagues · Teams · Market · Confidence · EV · Prob · Bookmarks · Saved.

**Maps from:** date controls + `LeaguePanel` selection (promote to sticky).

### 4.4 `TodayOverview`

KPI strip (≤4) · Continue · Recommended rail · Value rail · Interesting rail.

### 4.5 `CommandPalette`

Ctrl/Cmd+K → navigate matches, leagues, admin pages, actions (Warm, Predict).

### 4.6 Admin organisms

See `ADMIN_DASHBOARD_V3.md` — wrap `EnterpriseDashboard`, `HealthDashboard`, `ModelLabPanel`, `BacktestAnalyticsPanel`, `AdminUsersPanel`, `ApiStatus`.

---

## 5. Buttons system

| Variant | When |
|---------|------|
| Primary | Predict, Save, Activate trial |
| Secondary | Warm, Export |
| Ghost | Cancel, tertiary |
| Danger | Block user, destructive |

States: default / hover / active / disabled / loading (spinner replaces label).

---

## 6. Cards system

| Type | Use |
|------|-----|
| `SurfaceCard` | Default content |
| `InteractiveCard` | Match card (hover e1→e2, cursor) |
| `KpiCard` | Dashboard metrics |
| `StatCard` | Single metric + caption |
| `LockCard` | Tier-gated preview |

---

## 7. Tables

Admin users, backtest bets, API logs:

- Sticky header  
- Mono numerics  
- Row hover  
- Pagination  
- Empty + error rows  

Wrap `AdminUsersTable`, backtest bet lists.

---

## 8. Charts

| Chart | Library | Use |
|-------|---------|-----|
| Area / Line | Recharts (existing) | ROI, latency, monthly |
| Bar horizontal | Recharts | Contributions |
| Histogram | Recharts | MC goals |
| Donut (sparingly) | Recharts | 1X2 share in overview only |

**Monte Carlo viz package:**
1. Total goals histogram  
2. Score probability top-N bars  
3. CI range plot (home/away/total)  
4. Disclosure `<details>` for numeric table  

---

## 9. Feedback

| Component | Use |
|-----------|-----|
| `Alert` | Predict errors, budget DB-only |
| `Toast` | Warm done, trial activated |
| `Dialog` | Confirm block user, GDPR |
| `Drawer` | Filters mobile, notifications |

---

## 10. Skeleton loading

| Skeleton | Trigger |
|----------|---------|
| `MatchCardSkeleton` ×6 | Predict in flight |
| `ChartSkeleton` | Analytics fetch |
| `KpiSkeleton` | Overview |

Preserve current status text in live region for a11y.

---

## 11. File mapping (implementation)

| New / evolved | Current file |
|---------------|--------------|
| `MatchCardV3` | `MatchCard.tsx` |
| `MatchDetailShell` | `MatchModal.tsx` |
| `StickyFilterBar` | `LeaguePanel` + date bits |
| `ContributionBars` | `FeatureImportanceChart` / `PredictionContributionsChart` |
| `McDistribution` | `MonteCarloPanel.tsx` |
| `TodayOverview` | new composition in `UserDashboard` |
| `AdminShell` | `App.tsx` / `ObservatoryBody` |
| `CommandPalette` | new (client) |
| `ThemeToggle` | new |

---

## 12. Regression checklist per component

- [ ] Same `PredictionRow` fields rendered somewhere (card or tab)  
- [ ] Tier lock heuristics unchanged  
- [ ] Special bet still ultra/admin only  
- [ ] Insufficient-data card still clear  
- [ ] Admin panels still call same services  
