# USER_NAVIGATION_MAP.md
## Current vs Target Navigation (UX V4)

---

## 1. Current navigation (shipped)

### URL layer
```
/ → Landing
/login → Auth
/workspace → UserDashboard (state views) OR AdminDashboard
/track-record → Public proof
/privacy → Legal
```

### In-app (UserDashboard `navView`)

```
Desktop sidebar:  Home | Meciuri | Istoric | Statistici | Notificări | Profil
Mobile tabs:      Home | Meciuri | Istoric | Stats | Profil
Mobile top:       Search (⌘K) | Notifications | Predict
```

**Matches subfilters (not top-level):** Toate · Live · Favorite

**Max depth today (typical):**
- Best pick: Home → tile (1–2 clicks)
- Live match: Matches → Live chip → card → modal (3 clicks)
- Subscribe: Profile → Subscribe (2 clicks)
- History row: History (1 click) — rows not openable to modal

---

## 2. Target navigation (V4 brief)

```
HOME
MATCHES
PREDICTIONS
LIVE
HISTORY
STATISTICS
NOTIFICATIONS
PROFILE
SETTINGS
```

Admin remains **isolated** (AuthGate → AdminDashboard). Never mixed into user bottom tabs.

### Proposed mapping (zero engine change)

| Target | Maps from today | Implementation note |
|--------|-----------------|---------------------|
| HOME | `home` | Enrich above-the-fold opportunities |
| MATCHES | `matches` + filter `all` | Calendar + leagues |
| PREDICTIONS | Filtered matches with Top Pick | Same data, curated lens |
| LIVE | `matches` + filter `live` | Promote to top-level nav |
| HISTORY | `history` | Make rows open MatchModal when fixture known |
| STATISTICS | `statistics` | Keep |
| NOTIFICATIONS | `notifications` | Keep |
| PROFILE | `profile` minus settings chrome | Identity + billing |
| SETTINGS | Split from Profile | Theme, filters defaults, GDPR, onboarding |

### Mobile tab budget (recommended)
Bottom 5: **Home · Matches · Live · History · Profile**  
Overflow: Predictions, Statistics, Notifications, Settings via Profile or “More”.

### Desktop
Left sidebar with full 9 items; Predict pinned; Settings at bottom.

---

## 3. Click-budget goals (V4)

| Goal | Max clicks |
|------|------------|
| See today's best pick | 0–1 (Home above fold) |
| Open any match detail | ≤2 from Matches/Live |
| Reach Live board | 1 |
| Change notification prefs | ≤2 |
| Manage subscription | ≤2 |
| Search any team in today's set | 1 (⌘K or global search) |

---

## 4. Navigation path catalog (current)

| From | Action | To |
|------|--------|-----|
| Landing CTA | Start Gratuit | `/login?mode=signup` |
| Landing CTA | Autentificare | `/login` |
| Login success | — | `/workspace` |
| AppShell logo | click | Home |
| AppShell nav | click | view |
| Predict | warm+predict | Matches data refresh |
| Home “Vezi toate” | click | Matches |
| Home pick tile | click | MatchModal |
| Match card | click | MatchModal |
| ★ on card | toggle | watchlist (Favorites) |
| Success Rate | click | PerformanceCounterModal |
| ⌘K | open | CommandPalette → nav/match/predict |
| Profile Subscribe | Stripe | external checkout |
| Any “politica” | link | `/privacy` |

---

## 5. Dead / confusing paths

| Path | Issue |
|------|-------|
| User Admin entry | Removed in last redesign — good |
| Notifications icon sets unused `isNotificationsOpen` | Dead flag |
| History rows | Display-only; cannot reopen prediction |
| Desktop search | Keyboard-only; no visible button |

---

## 6. Approval note

This map is the **IA contract** for V4 implementation. Coding should not start until navigation target is approved against product priorities (especially whether LIVE and PREDICTIONS deserve primary tabs vs subfilters).
