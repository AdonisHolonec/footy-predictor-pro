# Admin Dashboard V3 — Professional SaaS Console

**Audience:** `role === "admin"`  
**Constraint:** Reorganize existing observatory panels — **do not** remove Enterprise, Health, Model Lab, Backtest, Users, or API tools.  
**Current problem:** Vertical kitchen-sink in `PerformancePanel` + `ObservatoryBody`.

---

## 1. Goals

Feel like Stripe / Vercel / Linear admin: **nav → section → focused page**.  
One job per screen. KPI cards at top. Charts breathe.

---

## 2. Information architecture

```
/admin
  /dashboard          KPI overview
  /engine             Prediction Engine status & weights (read-only UI)
  /models             Model Lab + Auto Selection
  /backtesting        Backtest analytics
  /calibration        Calibration maps / method summary (from existing meta)
  /feature-importance Aggregate FI views (from stored rows when available)
  /users              AdminUsersPanel
  /subscriptions      Tier / trial / expiry management (subset of users panel)
  /monitoring         HealthDashboard
  /cache              Cache stats (from ApiStatus / health)
  /api-usage          Usage snapshot
  /logs               Structured ops / alerts (auth’d — product note)
  /security           Checklist UI + links to audit docs (no fake scanners)
  /settings           Admin preferences
```

**Implementation note:** Client routes under `/workspace/admin/*` or query `?admin=dashboard` until React Router expansion — **same components**, different mount points.

---

## 3. Before → After

### Before
```
App
 └─ ObservatoryBody
     ├─ PerformancePanel
     │   ├─ EnterpriseDashboard   ⎫
     │   ├─ HealthDashboard       ⎪ stacked
     │   ├─ ModelLabPanel         ⎪ forever
     │   └─ BacktestAnalytics     ⎭
     ├─ BacktestPanel
     ├─ Sidebar + PredictionList
     └─ AdminUsersPanel (header area)
```

### After
```
AdminShell
 ├─ AdminNav (left rail desktop / top tabs tablet)
 └─ Outlet
      Dashboard | Engine | Models | Backtest | …
 User match tools remain available via “Workspace” link
```

---

## 4. Section specs

### 4.1 Dashboard (KPIs)

**Max 8 cards in 2 rows:**

| KPI | Source (existing) |
|-----|-------------------|
| API Usage | `ApiStatus` / usage snapshot |
| Prediction Accuracy | Enterprise / tracker |
| Today’s Requests | health / metrics |
| Cache Hit Rate | health / fetcher stats |
| Users | AdminUsers count |
| Prediction Success | SuccessRateTracker / history |
| System Health | HealthDashboard summary |
| Revenue | Placeholder “—” until Stripe (UI only) |

Below: 2 charts max (accuracy trend · API calls). Link cards → deep sections.

### 4.2 Prediction Engine

- Active model id, modularBlend, expectedGoals (from predict payload / env display if exposed).  
- Pipeline stage legend (`modelMeta.pipeline` sample).  
- **Read-only** — no weight editing unless already supported.

### 4.3 AI Models

Mount `ModelLabPanel` + selection status. Full width, no other labs.

### 4.4 Backtesting

Mount `BacktestAnalyticsPanel` + charts:

ROI · Yield · Profit · Drawdown · Sharpe · CLV · Monthly evolution  

Interactive filters retained.

### 4.5 Calibration

UI summarizing `calibrationApplied`, method when present in history/meta; link to docs. Placeholder table for maps until admin API exists — **no fake data**.

### 4.6 Feature Importance

Admin aggregate view: top modules across recent fixtures (client aggregate from loaded preds or existing persist endpoint if used). Horizontal bars.

### 4.7 Users

Full `AdminUsersPanel` / table: roles, block, tier drafts, usage.

### 4.8 Subscriptions

Focused view: tier distribution, trials, expiry — extract from users panel UI.

### 4.9 Monitoring

Full `HealthDashboard`: latency, errors, warm jobs, deps. Beautiful charts; same `healthService`.

### 4.10 Cache / API Usage

Split `ApiStatus` + `AdminUsageSnapshot` into clear pages.

### 4.11 Logs / Security / Settings

- **Logs:** ops alerts list UI (must respect future auth — note dependency on locking `/api/alerts`).  
- **Security:** static checklist from `FINAL_ENTERPRISE_AUDIT_2026.md` P0s (status toggles local).  
- **Settings:** theme default, density, cron schedule reference.

---

## 5. Wireframe — Admin Dashboard

```
┌────────┬────────────────────────────────────────────────────┐
│ Logo   │ Dashboard                                          │
│ ----   │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                       │
│ Dash   │ │KPI │ │KPI │ │KPI │ │KPI │                       │
│ Engine │ └────┘ └────┘ └────┘ └────┘                       │
│ Models │ ┌─────────────────┐ ┌─────────────────┐           │
│ Backtest│ │ Accuracy trend  │ │ API calls       │           │
│ Calib  │ └─────────────────┘ └─────────────────┘           │
│ FI     │                                                    │
│ Users  │                                                    │
│ Subs   │                                                    │
│ Monitor│                                                    │
│ Cache  │                                                    │
│ API    │                                                    │
│ Logs   │                                                    │
│ Sec    │                                                    │
│ Sett   │                                                    │
│ ----   │                                                    │
│ ← App  │                                                    │
└────────┴────────────────────────────────────────────────────┘
```

---

## 6. Monitoring charts (visual)

| Chart | Metrics |
|-------|---------|
| Latency line | p50/p95 from health bundle |
| Errors bar | failure counts |
| Cache area | hit rate |
| API calls | upstream vs cache |
| Warm jobs | cron success markers |
| Memory/CPU | when exposed by health (else hide) |

Empty states if metric missing — never invent.

---

## 7. Component mapping

| Admin page | Existing component |
|------------|-------------------|
| Dashboard | Compose Enterprise summary + Health summary + ApiStatus |
| Models | `ModelLabPanel` |
| Backtesting | `BacktestAnalyticsPanel`, `BacktestCharts`, `BacktestPanel` |
| Monitoring | `HealthDashboard` |
| Users | `AdminUsersPanel`, `AdminUsersTable` |
| API Usage | `AdminUsageSnapshot`, `CallsCounter` |
| Engine | New thin presentational from `modelMeta` samples |

---

## 8. Migration phases

| Phase | Work |
|-------|------|
| A | `AdminShell` + nav; mount **one** panel per route (move stack into routes) |
| B | Dashboard KPI composition |
| C | Split Users / Subscriptions visually |
| D | Calibration / Security / Logs shells |
| E | Chart restyle pass |

**Acceptance:** Every current admin capability reachable in ≤2 clicks; no loss of Model Lab run/read, backtest filters, user tier edits, health refresh.

---

## 9. Dual mode for admins

Admins need both:

1. **Ops console** (`/admin/*`)  
2. **Match workspace** (Today feed + predict) — link “Open workspace”

Do not force labs onto the match feed again.

---

## 10. ASCII — Models page

```
AI Models
─────────────────────────────────────────
[ Window 30d ] [ 90d ] [ 365d ]   [ Refresh ]

┌─ Active: E (Everything) ──────────────┐
│ Auto-selection status · last promote   │
└────────────────────────────────────────┘

┌─ Comparison table / charts ────────────┐
│  ModelLabPanel (unchanged data)        │
└────────────────────────────────────────┘
```
