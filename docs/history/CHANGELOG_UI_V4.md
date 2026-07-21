# CHANGELOG_UI_V4.md
## User Experience V4 — Changelog

---

## [Implemented] 2026-07-19 — UX V4 foundation + IA + Home

**Status:** First implementation wave shipped in source (UI-only). Engine / API / auth untouched.

### Design system
- Tokens: dark-first Almost black / Graphite, Deep Navy + Electric Blue (`--fp-navy`, `--fp-accent`)
- New primitives: `EmptyState`, `ErrorState`, `Toast`
- 8pt spacing + `--fp-touch` (44px) reinforced on filters / card actions

### Navigation
- Top-level: Home · Matches · Predictions · Live · History · Statistics · Notifications · Profile · Settings
- Mobile tabs: Home · Matches · Live · History · Profile
- Desktop: full sidebar + visible Search ⌘K
- Admin remains isolated

### Home
- Hierarchy: Today’s Summary → Top Pick → Highest Confidence → Best Value → Live → Upcoming → Trending → Recent performance
- Guided empty state with Predict CTA

### Matches / Predictions / Live
- Shared match board with curated Predictions sort (by confidence)
- Persistent filters via `useUiPrefs` v4 (`matchSearch`, `matchesFilter`, `settledOnly`, bookmarks)
- Empty states with next actions

### Match surfaces
- MatchCard: 44px Favorite / Bookmark / Share; share toast
- MatchModal tabs: Overview · Prediction · Statistics · Head-to-head · Form · Expected Goals · Monte Carlo · Value Analysis · Markets · Explanation · Timeline
- Terminology: Prediction Analysis (was Model Insights)

### Docs (audit package, still valid)
`USER_UI_AUDIT.md` · `USER_NAVIGATION_MAP.md` · `BUTTON_VALIDATION_REPORT.md` · `DESIGN_SYSTEM.md` · `UI_COMPONENT_INVENTORY.md` · `UX_IMPROVEMENTS.md` · responsive / a11y / perf / regression reports

### Explicitly not changed
- Prediction engine, API, DB, permissions, auth, ML, Monte Carlo, caching, business rules

---

## [Audit] 2026-07-19 — Documentation only

Initial audit package created before coding.

---

## Next waves (optional)
1. Deeper MatchCard visual migration off `signal-*`
2. True list virtualization + lazy modal chart tabs
3. Runtime button QA + Lighthouse ≥95 gates
4. History rows open MatchModal when fixture known
