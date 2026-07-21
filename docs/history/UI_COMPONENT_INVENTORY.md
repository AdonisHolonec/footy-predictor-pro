# UI_COMPONENT_INVENTORY.md
## User Product Component Inventory (UX V4 Baseline)

**Scope:** User-facing React tree. Admin/observatory listed only for isolation clarity.  
**Date:** 2026-07-19

---

## 1. Routing & shells

| Component | Path | Role | User? |
|-----------|------|------|-------|
| RootRouter | `src/RootRouter.tsx` | Routes | Yes |
| AuthGate | (in router/App) | Auth → User vs Admin | Yes |
| UserDashboard | `src/pages/UserDashboard.tsx` | Main product | Yes |
| AdminDashboard | `src/pages/AdminDashboard.tsx` | Admin only | No (isolated) |
| AppShell | `src/components/ux/AppShell.tsx` | Sidebar + mobile chrome | Yes |
| TopNav | `src/components/ux/TopNav.tsx` | Re-export AppShell | Yes |
| AdminShell | `src/components/ux/AdminShell.tsx` | Admin nav | No |
| appNav | `src/components/ux/appNav.ts` | Nav IDs/labels | Yes |

---

## 2. Public pages

| Component | Path | Role |
|-----------|------|------|
| LandingAccess | `src/pages/LandingAccess.tsx` | Marketing |
| Login | `src/pages/Login.tsx` | Auth modes |
| Privacy | `src/pages/Privacy.tsx` | GDPR |
| TrackRecordPage | `src/pages/TrackRecordPage.tsx` | Public proof |
| BrandArtboard | `src/components/BrandArtboard.tsx` | Brand visual |
| TrackRecordSection | `src/components/TrackRecordSection.tsx` | Metrics block |

---

## 3. UX sections (workspace)

| Component | Path | Role |
|-----------|------|------|
| HomeSection | `src/components/ux/HomeSection.tsx` | Today’s opportunities |
| TodayOverview | `src/components/ux/TodayOverview.tsx` | Legacy/alt overview |
| HistorySection | `src/components/ux/HistorySection.tsx` | Settled history |
| StatisticsSection | `src/components/ux/StatisticsSection.tsx` | Personal + public stats |
| VirtualizedMatchGrid | `src/components/ux/VirtualizedMatchGrid.tsx` | Paginated match list |
| StickyFilterBar | `src/components/ux/StickyFilterBar.tsx` | Date/search/filters |
| CommandPalette | `src/components/ux/CommandPalette.tsx` | ⌘K global actions |

---

## 4. Match surfaces

| Component | Path | Role |
|-----------|------|------|
| MatchCard | `src/components/MatchCard.tsx` | Compact prediction card |
| MatchModal | `src/components/MatchModal.tsx` | Detail tabs |
| LeaguePanel | `src/components/LeaguePanel.tsx` | League multi-select |
| ValueCard | `src/components/ValueCard.tsx` | Value presentation |
| ExplanationCard | `src/components/ExplanationCard.tsx` | Narrative explanation |
| LuckBadge | `src/components/LuckBadge.tsx` | Luck indicator |
| XGPerformanceBar | `src/components/XGPerformanceBar.tsx` | xG bar |

---

## 5. Intelligence panels (modal / labs)

| Component | Path | User label (target) |
|-----------|------|---------------------|
| PredictionLaboratory | `src/components/PredictionLaboratory.tsx` | Prediction Analysis |
| FeatureImportanceChart | `src/components/FeatureImportanceChart.tsx` | Key Factors |
| PredictionContributionsChart | `src/components/PredictionContributionsChart.tsx` | Why This Prediction |
| ConfidenceEnginePanel | `src/components/ConfidenceEnginePanel.tsx` | Confidence |
| MonteCarloPanel | `src/components/MonteCarloPanel.tsx` | Monte Carlo |
| SignalLab | `src/components/SignalLab.tsx` | Signals (if shown) |
| ModelLabPanel | `src/components/modelLab/ModelLabPanel.tsx` | Admin / Prediction Models |

---

## 6. Performance & billing UI

| Component | Path | Role |
|-----------|------|------|
| SuccessRateTracker | `src/components/SuccessRateTracker.tsx` | Win-rate card |
| PerformanceCounterModal | `src/components/PerformanceCounterModal.tsx` | Deep performance |
| CallsCounter | `src/components/cards/CallsCounter.tsx` | Usage (also admin paths) |

---

## 7. Design system primitives

| Component | Path |
|-----------|------|
| Button | `src/design-system/Button.tsx` |
| Card | `src/design-system/Card.tsx` |
| Badge | `src/design-system/Badge.tsx` |
| Skeleton | `src/design-system/Skeleton.tsx` |
| tokens.css | `src/design-system/tokens.css` |
| index | `src/design-system/index.ts` |

---

## 8. Legacy / admin-adjacent (do not mix into user shell)

| Component | Notes |
|-----------|-------|
| ObservatoryBody, GuestBody, Header, Footer, Sidebar | Older layout stack |
| PredictionList, PredictionCard, DatePicker | Card variants |
| LeagueSelector, StatisticsPanel, BacktestPanel | Admin/analytics |
| AnalyticsDashboard, EnterpriseDashboard, HealthDashboard | Ops |
| AdminUsersPanel/Table, AdminObservatory, ApiStatus | Admin |
| Auth.tsx | Legacy auth UI (Login page is primary) |

---

## 9. Hooks (user-relevant)

| Hook | Purpose |
|------|---------|
| `useAuth` | Session, tier, prefs, trials |
| `usePredictFlow` / `useWarm` | Warm + predict |
| `usePredictions` | Pred list, filters, selected match |
| `useLiveFixtureScorePoll` | Live scores |
| `useLeagues` / `useLeaguePanelState` | League selection |
| `useHistorySync` | History load/sync |
| `useDateRollover` | Day rollover |
| `useUiPrefs` | Theme, watchlist, filter prefs |
| `usePerformanceTracker` | Success Rate animations |
| `useCallsCounter` | Usage snapshot |
| `useLocalStorageState` | Persist UI state |
| `useAppController` | Admin/app orchestration (not UserDashboard primary) |

---

## 10. Services touched by UI (read-only for V4)

`fixturesService` · `historyService` · `billingService` · `trackRecordService` · `performanceService` · `usageService` · `alertsService` · `healthService` · `backtestService`

V4 must not change service contracts — only presentation/consumption.

---

## 11. Coverage vs V4 brief

| Needed UI | Exists? | Gap |
|-----------|---------|-----|
| Home opportunities hierarchy | Partial (HomeSection) | Reorder + above-fold |
| Match card full feature set | Partial | Odds/value/bookmark split |
| Tabbed detail (incl. H2H, Markets) | Partial (10 tabs) | Add/rename tabs |
| Persistent filters | Partial | Persist search/live/settled |
| Global search | Partial (palette + bar) | Broader entities |
| Empty/Error states | Weak | Dedicated components |
| Settings top-level | Missing | Split from Profile |
| LIVE / PREDICTIONS nav | Missing | Promote from subfilter |
