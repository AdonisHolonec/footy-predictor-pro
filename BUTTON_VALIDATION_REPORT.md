# BUTTON_VALIDATION_REPORT.md
## Interactive Element Audit — User UI (Static + Wiring)

**Method:** Static analysis of event handlers, props, and navigation wiring in source.  
**Status legend:**
- **PASS** — handler wired; expected action clear in code  
- **PARTIAL** — works but missing loading/disabled/a11y/touch  
- **FAIL** — dead, broken, or unreachable  
- **RUNTIME** — needs manual/device QA (cannot assert click outcome from source alone)

**Rule:** No interactive control listed as untested. RUNTIME items must be checked before V4 ship.

---

## AppShell (`src/components/ux/AppShell.tsx`)

| Component | Button / Control | Expected Action | Actual (code) | Status | Issue | Recommendation |
|-----------|------------------|-----------------|---------------|--------|-------|----------------|
| AppShell | Logo desktop | Go Home | `onNavigate("home")` | PASS | — | Keep |
| AppShell | Nav Home…Profile ×6 | Switch view | `onNavigate(id)` + aria-current | PASS | — | Keep |
| AppShell | Predict (sidebar) | Warm+Predict | `onPredict` + loading | PASS | — | Keep |
| AppShell | Ieșire | Logout | `onLogout` | PASS | — | Keep |
| AppShell | Logo mobile | Go Home | same | PASS | — | Keep |
| AppShell | ⌘K / Căutare | Open palette | `onOpenCommand` | PASS | Desktop: no visible button | Add desktop search icon |
| AppShell | Notificări icon | Open notifications | `onOpenNotifications` | PASS | — | Keep |
| AppShell | Predict mobile | Warm+Predict | loading | PASS | — | Keep |
| AppShell | Bottom tabs ×5 | Switch view | `onNavigate` | PASS | Notifications not in tabs | OK per design |

---

## UserDashboard chrome & sections

| Component | Button / Control | Expected Action | Actual (code) | Status | Issue | Recommendation |
|-----------|------------------|-----------------|---------------|--------|-------|----------------|
| UserDashboard | Matches: Toate/Live/Favorite | Filter list | `setMatchesFilter` | PARTIAL | Touch 36px | Raise to 44px |
| StickyFilterBar | Date | Change day + fetch | `onDateChange`→`fetchDays` | PASS | No visible label | Add label |
| StickyFilterBar | Search | Filter teams/leagues | session state | PARTIAL | Not persisted | Persist in uiPrefs |
| StickyFilterBar | ★ Leagues | Open league panel | `onOpenLeagues` | PASS | — | Keep |
| StickyFilterBar | Conf ≥ | Filter confidence | persisted | PASS | — | Keep |
| StickyFilterBar | EV ≥ | Filter EV | persisted | PASS | — | Keep |
| StickyFilterBar | Value only | Toggle | persisted | PASS | — | Keep |
| StickyFilterBar | Settled | Toggle derived markets | local only | PARTIAL | Not persisted | Persist |
| UserDashboard | +1 / +2 zile | Expand date window | tier-gated | PASS | — | Keep |
| LeaguePanel | Header toggle | Expand/collapse | aria-expanded | PASS | — | Keep |
| LeaguePanel | Elite select all | Select all | wired | PASS | — | Keep |
| LeaguePanel | Clear rail | Clear | wired | PASS | — | Keep |
| LeaguePanel | Search input | Filter leagues | wired + sr-only | PASS | — | Keep |
| LeaguePanel | League rows | Toggle selection | wired | PASS | — | Keep |
| HomeSection | Best pick tiles ×3 | Open MatchModal | `onOpenMatch` | PASS | Confidence tile duplicates best pick | Differentiate or merge |
| HomeSection | Continuă | Open last match | wired | PASS | — | Keep |
| HomeSection | Vezi toate | Go Matches | `onGoMatches` | PASS | — | Keep |
| HomeSection | Upcoming rows | Open match | wired | PASS | — | Keep |
| VirtualizedMatchGrid | Încarcă mai multe | Reveal +24 cards | wired | PASS | Not true virtualization | Consider windowing |
| HistorySection | History rows | (none) | display only | PARTIAL | Cannot open match | Wire open when id known |
| StatisticsSection | Track record link | `/track-record` | via TrackRecordSection | PASS | — | Keep |
| Notifications | Safe / Value / Email checkboxes | Update prefs state | wired | PASS | — | Keep |
| Notifications | Email consent | GDPR gate | wired | PASS | — | Keep |
| Notifications | Salvează preferințe | Persist prefs | loading | PASS | — | Keep |
| Profile | Subscribe Premium | Stripe checkout | busy/disabled | PASS | RUNTIME redirect | QA with test card |
| Profile | Subscribe Ultra | Stripe checkout | busy/disabled | PASS | RUNTIME | QA |
| Profile | Manage billing | Portal | busy/disabled | PASS | RUNTIME | QA |
| Profile | Trial Premium/Ultra | Activate 24h | disabled rules | PASS | RUNTIME | QA |
| Profile | Finalizează onboarding | Complete | if needed | PASS | — | Keep |
| Profile | Export JSON | Download | loading | PASS | RUNTIME download | QA |
| Profile | Schimbă tema | cycleTheme | wired | PASS | — | Keep |
| Profile | Logout | logout | wired | PASS | — | Keep |
| UserDashboard | Privacy links | `/privacy` | Link | PASS | — | Keep |
| SuccessRateTracker | Card click | Open PerformanceCounterModal | when handler passed | PASS | — | Keep |
| UserDashboard | `isNotificationsOpen` | Expand notif UI | **set only, never read** | FAIL | Dead state | Remove or wire |
| PerformanceCounterModal | Close / sync controls | Modal lifecycle | component-local | RUNTIME | — | Manual QA |
| CommandPalette | Actions + matches | Nav / predict / open | wired + Esc/⌘K | PASS | No roving tabindex | Improve keyboard list |
| CommandPalette | Backdrop close | Close | wired | PASS | — | Keep |

---

## MatchCard (`src/components/MatchCard.tsx`)

| Component | Button / Control | Expected Action | Actual (code) | Status | Issue | Recommendation |
|-----------|------------------|-----------------|---------------|--------|-------|----------------|
| MatchCard | Card body | Open detail | onClick + Enter/Space | PASS | — | Keep |
| MatchCard | Insufficient card | Open detail | same | PASS | — | Keep |
| MatchCard | ★ Favorite | Toggle watchlist | stopPropagation | PARTIAL | 36px target; aria OK | 44px |
| MatchCard | Share ↗ | Share/clipboard | stopPropagation | PARTIAL | 36px; no toast on copy | Toast “Copiat” |
| MatchCard | Special Bet 2/3 | Change legs | ultra/admin | PASS | — | Keep |

---

## MatchModal (`src/components/MatchModal.tsx`)

| Component | Button / Control | Expected Action | Actual (code) | Status | Issue | Recommendation |
|-----------|------------------|-----------------|---------------|--------|-------|----------------|
| MatchModal | Backdrop | Close | onClose | PASS | — | Keep |
| MatchModal | ✕ Close | Close | aria-label, focus restore | PASS | — | Keep |
| MatchModal | Escape | Close | listener | PASS | — | Keep |
| MatchModal | Tabs ×10 | Switch panel | role=tab, aria-selected | PARTIAL | Small hit area | Larger tabs / scroll |
| MatchModal | Special Bet 2/3 | Legs | wired | PASS | — | Keep |
| MatchModal | Model Insights details | Expand | native details | PASS | — | Keep |
| MatchModal | Close (insufficient variants) | Close | wired | PASS | — | Keep |

---

## Login (`src/pages/Login.tsx`)

| Component | Button / Control | Expected Action | Actual (code) | Status | Issue | Recommendation |
|-----------|------------------|-----------------|---------------|--------|-------|----------------|
| Login | ← Pagina de acces | `/` | Link | PASS | — | Keep |
| Login | Submit | Auth action | disabled while submitting | PASS | RUNTIME | QA each mode |
| Login | Mode toggles | Switch mode | setMode | PASS | Weak focus style | Use Button primitive |
| Login | Privacy checkbox | Gate signup | required | PASS | — | Keep |
| Login | Privacy links | `/privacy` | Link | PASS | — | Keep |
| Login | Email (reset) | Locked field | disabled in reset | PASS | — | Keep |

---

## Landing (`src/pages/LandingAccess.tsx`)

| Component | Button / Control | Expected Action | Actual (code) | Status | Issue | Recommendation |
|-----------|------------------|-----------------|---------------|--------|-------|----------------|
| Landing | Logo | `/` | Link | PASS | — | Keep |
| Landing | Autentificare / Deschide | login/workspace | Link | PASS | — | Keep |
| Landing | Start Gratuit | signup | Link | PASS | — | Keep |
| Landing | Explorează platforma | scroll `#platform-preview` | button | PASS | RUNTIME scroll | QA |
| Landing | Preview Open | `/login` | Link | PASS | — | Keep |
| Landing | Tier CTAs | signup/login+tier | Link | PASS | — | Keep |
| Landing | Kickoff CTAs | signup/login/workspace | Link | PASS | — | Keep |
| Landing | Footer Track/Privacy/Login | routes | Link | PASS | — | Keep |

---

## TrackRecord + Privacy

| Component | Button / Control | Expected Action | Actual (code) | Status | Issue | Recommendation |
|-----------|------------------|-----------------|---------------|--------|-------|----------------|
| TrackRecordPage | Home / Login / Workspace | Nav | Links | PASS | — | Keep |
| TrackRecordSection | Vezi pagina dedicată | `/track-record` | when showLinkToFull | PASS | — | Keep |
| Privacy | Home / Login | Nav | Links | PASS | — | Keep |

---

## design-system Button

| Component | Button / Control | Expected Action | Actual (code) | Status | Issue | Recommendation |
|-----------|------------------|-----------------|---------------|--------|-------|----------------|
| Button | primary/secondary/ghost/danger | click | disabled\|\|loading; focus-visible; 44px md | PASS | Not used everywhere | Adopt app-wide |

---

## Summary counts (static)

| Status | Count (approx) |
|--------|----------------|
| PASS | ~70 |
| PARTIAL | ~12 |
| FAIL | 1 (`isNotificationsOpen` dead) |
| RUNTIME | Stripe, export download, scroll, modal deep QA |

**Blockers before claiming “every button tested”:** execute RUNTIME column on production/staging checklist; fix FAIL dead state; raise PARTIAL touch targets.

---

## Mandatory runtime QA script (pre-ship)

1. Cold load `/` → all Landing CTAs  
2. Signup + Login + Forgot (staging)  
3. Predict → open 3 cards → every MatchModal tab  
4. ★ + Share on card  
5. Live / Favorites filters  
6. History list + Success Rate modal  
7. Notifications save  
8. Profile Subscribe (test mode) + Portal + Trial  
9. Theme cycle + Logout  
10. ⌘K: navigate + open match + predict  
11. Mobile: bottom tabs + Predict + Notificări  
12. Keyboard-only pass on Home → Matches → Modal
