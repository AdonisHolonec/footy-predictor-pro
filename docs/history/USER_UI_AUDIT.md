# USER_UI_AUDIT.md
## Footy Predictor Pro — User Experience V4 Baseline Audit

**Date:** 2026-07-19  
**Scope:** User product only (`LandingAccess`, `Login`, `Privacy`, `TrackRecordPage`, `UserDashboard`)  
**Out of scope:** Admin observatory (`App.tsx` / `AdminDashboard`) — isolated by AuthGate  
**Constraint:** Prediction engine, API, DB, auth, ML, calibration, Monte Carlo, caching, business rules — **not modified** in V4 UI work  
**Method:** Static code audit of `src/` (routes, components, hooks, interactive controls). Runtime click QA is recommended before ship (see `BUTTON_VALIDATION_REPORT.md`).

---

## 1. Routes

| Route | Page | Auth | Purpose |
|-------|------|------|---------|
| `/` | `LandingAccess` | Public | Marketing, pricing, track-record teaser |
| `/track-record` | `TrackRecordPage` | Public | Full verified track record |
| `/privacy` | `Privacy` | Public | GDPR policy |
| `/login` | `Login` | Public | login / signup / forgot / reset (`?mode=`) |
| `/workspace` | `AuthGate` → `UserDashboard` or Admin | Required | Product shell |
| `*` | Redirect `/` | — | Catch-all |

**In-app views (state, not URL):** `home` · `matches` · `history` · `statistics` · `notifications` · `profile`  
**Matches subfilters:** `all` · `live` · `favorites`

---

## 2. Pages & sections

### Public
- **Landing:** hero, mock card, KPIs, TrackRecord compact, pricing, CTAs, footer
- **Login:** credentials + 30d stats + Success Rate; modes login/signup/forgot/reset
- **Privacy:** static legal + BrandArtboard
- **Track Record:** full public metrics + CTAs

### User workspace (`UserDashboard`)
| View | Contents |
|------|----------|
| Home | Scoreboard, best pick, confidence, best value, continue, upcoming, usage |
| Matches | Subfilters, StickyFilterBar, LeaguePanel, VirtualizedMatchGrid → MatchCard |
| History | Success Rate + real history rows (win/loss/pending) |
| Statistics | Personal KPIs + lazy public TrackRecord |
| Notifications | Safe / Value / Email prefs |
| Profile | Stripe, trials, onboarding, GDPR export, theme, logout |

**Overlays:** `MatchModal`, `PerformanceCounterModal`, `CommandPalette` (⌘K)

---

## 3. Component inventory (user)

| Layer | Components |
|-------|------------|
| Shell | `AppShell`, `appNav`, `StickyFilterBar`, `CommandPalette` |
| Sections | `HomeSection`, `HistorySection`, `StatisticsSection`, `VirtualizedMatchGrid` |
| Match | `MatchCard`, `MatchModal`, `LeaguePanel` |
| Intelligence (modal) | Model Insights, Key Factors, Why This Prediction, Confidence, Monte Carlo, Value, xG, Form, Odds |
| Performance | `SuccessRateTracker`, `PerformanceCounterModal`, `TrackRecordSection` |
| Design system | `Button`, `Card`, `Badge`, `Skeleton`, `tokens.css` |
| Deprecated | `TopNav` → re-export of AppShell |

---

## 4. Modals / dialogs / drawers

| UI | Type | Opened by |
|----|------|-----------|
| MatchModal | Modal dialog | Match card / Home tiles / Command Palette |
| PerformanceCounterModal | Modal | Success Rate click |
| CommandPalette | Dialog overlay | ⌘K / mobile search |
| LeaguePanel | Collapsible panel | ★ Leagues / accordion header |
| Model Insights `<details>` | Expand | MatchModal prediction tab |

---

## 5. Match detail tabs (current)

1. Overview  
2. AI Prediction  
3. Why  
4. Statistics  
5. Form  
6. Odds  
7. Best Value  
8. Monte Carlo  
9. xG  
10. Timeline  

**Missing vs V4 brief:** dedicated Head-to-head, Markets, Explanation as first-class tabs (content partly exists under other tabs).

---

## 6. Hooks (UserDashboard)

`useAuth` · `usePredictFlow` · `useHistorySync` · `useLiveFixtureScorePoll` · `useDateRollover` · `useUiPrefs` · `useLeaguePanelState` · `useLocalStorageState`

---

## 7. Primary user flows

1. Landing → Signup/Login → `/workspace`  
2. Select leagues → Predict → Match cards  
3. Open MatchModal → browse tabs  
4. History / Statistics review  
5. Profile → Subscribe / Trial / Portal  
6. Notifications prefs save  
7. Public Track Record (unauthenticated)

---

## 8. Dual design systems (risk)

- **New:** `--fp-*` in `src/design-system/tokens.css` (AppShell, sections)
- **Legacy:** Tailwind `signal-*` (MatchCard, MatchModal, Landing, Login)

V4 must unify without touching engine code.

---

## 9. Known product gaps (for V4 implementation phase)

| Gap | Severity |
|-----|----------|
| No top-level LIVE / PREDICTIONS / SETTINGS nav | High (IA) |
| Global search limited to current predictions | High |
| Filters partially persisted (search/live/settled not) | Medium |
| Favorite vs Bookmark conflated with watchlist | Medium |
| No H2H tab | Medium |
| Touch targets &lt; 44px on card ★/share | Medium |
| Empty/error states text-only | Medium |
| `isNotificationsOpen` dead state | Low |
| Desktop ⌘K has no visible control | Low |

---

## 10. Audit completeness statement

This document enumerates **all user routes, pages, major components, overlays, tabs, hooks, and flows** found in source as of 2026-07-19. Button-level validation matrix is in `BUTTON_VALIDATION_REPORT.md`.
