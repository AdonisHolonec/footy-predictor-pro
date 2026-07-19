# ENTERPRISE UI V2 REPORT
## Complete User Experience Redesign

**Date:** 2026-07-19  
**Scope:** User Dashboard only (consumer product)  
**Constraint:** No backend / engine / API / business-logic changes

---

## 1. Components redesigned

| Component | Change |
|-----------|--------|
| `tokens.css` | Light-first palette (#F8FAFC / #FFFFFF / #2563EB) |
| `ConsumerShell` | New simplified header chrome |
| `PredictionFocusCard` | New airy prediction cards (hero of the app) |
| `CollapsiblePanel` | Progressive disclosure with lazy mount |
| `MatchModal` | Focus Mode: right drawer (desktop) / bottom sheet (mobile) |
| `Card` / `Button` / body CSS | Soft shadows, light surfaces |
| `useUiPrefs` | Default theme `light`; prefs key `v5` |

---

## 2. Components moved / restructured

| Before | After |
|--------|--------|
| Multi-view AppShell (Home / Matches / Live / …) | Predictions-first single board |
| StickyFilterBar + LeaguePanel sidebar | Header controls + League drawer |
| MatchModal centered overlay | Match Focus Mode drawer/sheet |
| Home opportunities stack | Prediction cards dominate viewport |
| Success Rate in AdminPerformanceObservatory | Plain SuccessRateTracker (no observatory chrome) |
| Advanced panels always visible in engineering console | Collapsed: Advanced analysis · History · Prediction analysis · Insights |

---

## 3. Buttons / handlers repaired

| Control | Status |
|---------|--------|
| Header Refresh | Wired → `warmAndPredict` + loading |
| Header Leagues | Opens league drawer (not dead) |
| Header Search | Filters cards + can open ⌘K palette |
| Header Favorites | Toggles favorites filter |
| Header Notifications / Profile / Settings | Navigate to existing full sections |
| Prediction card Open / Expand | Opens Focus Mode |
| Favorite ★ on card | Watchlist toggle |
| Collapsible chevrons | Expand/collapse + lazy load |
| Value checkbox | Persisted `valueOnly` filter |
| League drawer Close | Closes overlay |
| Dead `AdminPerformanceObservatory` wrap | Removed from user dashboard |

---

## 4. Broken handlers fixed

- Removed unused notifications dead-state pattern (already fixed in V4)
- Removed Admin observatory wrapper that made Success Rate feel like ops tooling
- Focus Mode presentation always attached (`presentation="focus"`)

---

## 5. Hidden admin components (user dashboard)

Removed / never imported on user path:

- `AdminPerformanceObservatory` (Performance observatory chrome)
- Health / Operations / Backtest / Calibration / Enterprise / Logs / Pipeline / Diagnostics  
  → remain only on Admin Dashboard routes/components

User still has: Predictions, Focus Mode (full MatchModal content), History, Statistics, Track Record (collapsed Insights), Notifications, Profile/billing, Settings.

---

## 6. Remaining UX issues

1. MatchModal inner panels still use some legacy `signal-*` dark card styles inside Focus Mode — visual polish pass recommended  
2. PredictionFocusCard does not yet show probability as a separate field from confidence when only one is available  
3. Landing / Login pages not fully migrated to V2 light language (out of dashboard scope)  
4. Runtime Lighthouse / full manual click matrix should be re-run on production  

---

## 7. Performance improvements

- Collapsed panels lazy-mount children (`CollapsiblePanel` + `lazy`)
- Heavy panels (Monte Carlo, Laboratory, Track Record) loaded via `Suspense` / dynamic import when expanded
- Main grid uses lightweight `PredictionFocusCard` instead of dense MatchCard for the primary list

---

## 8. Accessibility improvements

- Header controls: 44px targets, aria-labels, aria-pressed on filters  
- Focus Mode: dialog, escape, focus restore (existing MatchModal trap)  
- Collapsible: `aria-expanded` / `aria-controls`  
- Light theme contrast: slate text on #F8FAFC / white cards (AA target)  

---

## 9. Responsive improvements

- Prediction cards: 1 / 2 / 3 columns  
- Focus Mode: bottom sheet &lt;sm, right drawer ≥sm  
- Header wraps on narrow viewports  
- League filter as full-height drawer on all sizes  

---

## 10. Confirmation checklist

| Requirement | Confirmed |
|-------------|-----------|
| No backend modified | Yes |
| No prediction logic changed | Yes |
| No API changed | Yes |
| No business logic changed | Yes |
| No feature removed (only relocated / collapsed) | Yes |
| All existing functionality remains available | Yes — Focus Mode + collapsed sections + Profile/Settings/Notifications |
| Buttons verified (static wiring + build) | Yes — runtime smoke still recommended |
| Menus / drawers open | League drawer + Focus Mode + collapsibles |
| Routes unchanged (`/workspace`, public routes) | Yes |

---

## Page structure (shipped)

1. Header (Date · Leagues · Search · Refresh · Favorites · Notifications · Profile · Settings)  
2. Prediction cards  
3. Today’s summary (4 KPIs)  
4. Advanced analysis (collapsed)  
5. Historical performance (collapsed)  
6. Prediction analysis (collapsed)  
7. Insights (collapsed)  
