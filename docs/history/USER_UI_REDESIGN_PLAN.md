# User UI Complete Redesign Plan

**Status:** Approved for implementation  
**Defaults:** Romanian UI + sports EN (`xG`, `Live`, `Odds`, `CLV`) · Sidebar desktop + bottom tabs mobile · Admin shell separate

## 1. Current problems

| Problem | Impact |
|---------|--------|
| Two products under one URL (user vs admin shell) | Split mental model |
| History nav shows tracker only — no prediction rows | Trust gap |
| Today stacks overview rails + full match grid | Redundant scroll |
| Bell opens Settings; label is literal "Bell" | Confusion |
| Dead Admin entry on user TopNav | Dead navigation |
| MatchModal has 12 overlapping tabs | Cognitive load |
| RO/EN mix across surfaces | Untrustworthy polish |
| Dual tokens (`signal-*` vs `--accent`) | Inconsistent look |
| Stacked sticky chrome on mobile | Viewport tax |
| No sticky Predict on user mobile | Discoverability |

## 2. Screens affected

- `UserDashboard.tsx` — shell + sections
- `TopNav.tsx` → replaced by `AppShell` (Sidebar + MobileTabBar)
- `TodayOverview.tsx` → Home scoreboard
- `MatchCard.tsx` / `MatchModal.tsx` — hierarchy + tab regroup
- Landing / Login — glossary + tokens
- Admin `App.tsx` — functionally untouched; remove user-shell Admin entry

## 3. New IA

**Nav:** Home · Matches · History · Statistics · Notifications · Profile  
**Matches subfilters:** All · Live · Favorites  
**Predictions:** deep match detail (modal), not an empty tab  
**Admin:** separate shell when `role === admin`

**Home answers:** “Pe ce pariez azi?” — scoreboard, best pick, highest confidence, best value, upcoming, recent success, usage.

## 4. Navigation

- Desktop: left sidebar ~240px, Predict CTA, tier chip
- Mobile: bottom tabs (Home, Matches, History, Stats, Profile); notifications in top bar

## 5. Terminology

| Old | New |
|-----|-----|
| Prediction Laboratory | Model Insights |
| Feature Importance | Key Factors |
| Prediction Contributions | Why This Prediction |
| Confidence Engine | Confidence |
| Value Engine | Best Value |
| Recommended pick | Top Pick |
| Performance Counter Pro | Success Rate |
| Bell | Notifications |
| Analytics (user) | Statistics |

## 6. Design tokens

- BG `#0A0A0B` · Card `#141416` / `#1A1A1E` · Accent `#2563EB` (only one)
- Success `#22C55E` · Danger `#EF4444` · Warning `#F59E0B`
- 8pt spacing · Radius 8/12/16 · Typography: Hero / Section / CardTitle / Body / Caption / Badge

## 7. Migration phases

0. This document  
1. Tokens + AppShell  
2. Home + Matches  
3. History list + Statistics  
4. Profile + Notifications split  
5. MatchCard + MatchModal  
6. Perf / a11y / virtualize  
7. Marketing align  

## 8. Risks

- Preserve hooks (`usePredictFlow`, billing, tier masks)
- Feature parity checklist per phase
- Do not merge admin/user shells

## 9. Estimate

~12–16 engineering days total across phases.
