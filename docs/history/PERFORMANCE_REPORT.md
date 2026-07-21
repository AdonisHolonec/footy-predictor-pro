# PERFORMANCE_REPORT.md
## Frontend Performance Audit — User UI (Baseline)

**Scope:** Client bundle, render cost, perceived loading.  
**Out of scope:** API latency, ML, Monte Carlo server compute (must remain unchanged).  
**Target gates:** Lighthouse Performance ≥95 (mobile + desktop, prod).

---

## 1. Current architecture signals

| Pattern | Status | Notes |
|---------|--------|-------|
| Vite SPA | Yes | Code-split via dynamic import where used |
| Design system tokens CSS | Light | Good |
| MatchModal charts | Eager risk | Heavy panels may load with modal |
| VirtualizedMatchGrid | Misnamed | Loads +24 via “Încarcă mai multe”, not windowing |
| Predictions in localStorage | Yes | Fast reopen; large JSON may slow hydrate |
| Live score poll | Yes | Necessary; keep UI updates minimal |
| Landing TrackRecord | Can be heavy | Charts below fold |

---

## 2. Risks

| Risk | Impact | Mitigation (UI-only) |
|------|--------|----------------------|
| Large MatchModal tree | Slow open / jank | Lazy-load tabs (Monte Carlo, charts) |
| Re-render of UserDashboard on filter keystroke | Input lag | Isolate search state; memo MatchCard |
| Unmemoized lists | Scroll jank | Stable keys; memo card; virtualizer |
| Dual CSS systems | Larger CSS | Consolidate to `--fp-*` |
| Skeleton absence | Perceived slow | Skeletons on Predict/History |
| CLS from logos / late odds | Layout shift | Fixed logo boxes; reserved badge slots |
| CommandPalette mount | Idle cost | Keep closed unmounted |

---

## 3. Memoization / virtualization plan

1. `React.memo(MatchCard)` if not already  
2. `@tanstack/react-virtual` for match grids >40  
3. `startTransition` for filter updates (if React 19 patterns already in repo)  
4. Defer non-critical Home sections below fold  

**Do not** add useMemo/useCallback blindly — follow existing project patterns.

---

## 4. Bundle notes

| Chunk candidates | Action |
|------------------|--------|
| Recharts / chart libs | Lazy with modal tab |
| TrackRecord charts | Lazy on Statistics / Landing |
| Admin-only panels | Ensure not imported from UserDashboard |

---

## 5. Loading UX map

| Action | Loading today | V4 target |
|--------|---------------|-----------|
| Predict | Button loading | + skeleton grid |
| History sync | Status text | Skeleton rows |
| Match modal tab | Instant empty | Tab skeleton |
| Stripe | busy/disabled | Keep + aria-busy |
| Prefs save | loading | Keep |

---

## 6. Measurement plan (pre-ship)

1. Production Lighthouse (mobile) on `/`, `/login`, `/workspace` (auth)  
2. React Profiler: filter typing + open 20 cards  
3. Network: no accidental admin chunk on user path  
4. CLS check on MatchCard logo load  

**Gate:** Performance ≥95 · Best Practices ≥95 (paired with a11y report).

---

## 7. Verdict

UX V3 shell improved structure; **list virtualization and modal code-splitting are the biggest remaining wins**. No engine/caching changes required for these UI optimizations.
