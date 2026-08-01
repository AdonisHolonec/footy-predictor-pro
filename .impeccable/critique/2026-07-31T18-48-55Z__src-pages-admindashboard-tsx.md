---
target: Admin Dashboard (AdminDashboard.tsx)
total_score: 17
max_score: 36
na_heuristics: 10
p0_count: 1
p1_count: 2
timestamp: 2026-07-31T18-48-55Z
slug: src-pages-admindashboard-tsx
---
Method: dual-agent (A: ae74a763e694e2f40 · B: ad73d45fa9d0f167d)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | Real telemetry (calibration, sync health) sits next to a hardcoded fake `v4.2 · latency ~12ms` string not wired to any real metric. |
| 2 | Match Between System and Real World | 3/4 | ML jargon (Brier, ECE, stacker) fits the technical ops audience; undercut by inconsistent EN/RO mixing (see #4). |
| 3 | User Control and Freedom | 1/4 | Role change, block/unblock, and tier/expiry save are all single-click, no confirm, no undo. |
| 4 | Consistency and Standards | 2/4 | English and Romanian strings mixed within the same component tree with zero `t()`/i18n usage anywhere in this admin path. |
| 5 | Error Prevention | 1/4 | No confirmation before destructive actions; an auto-clear-expiry rule can silently grant/revoke open-ended paid access. |
| 6 | Recognition Rather Than Recall | 2/4 | No "unsaved change" indicator on tier/expiry drafts — admins must remember whether they already clicked Save. |
| 7 | Flexibility and Efficiency of Use | 2/4 | Alert snooze/reset is a nice accelerator, but the Users table has no search/filter/sort. |
| 8 | Aesthetic and Minimalist Design | 2/4 | The Dashboard tab stacks tracker + an 8-chart dashboard + the full model-metrics panel in one continuous scroll. |
| 9 | Error Recovery | 2/4 | Modal-level errors are well styled, but the shared top-level status banner uses identical success-green styling for both success and failure text. |
| 10 | Help and Documentation | n/a | Internal tool for staff who operate the system daily — no in-app docs gap that matters here. |
| **Total** | | **17/36** | **Poor** (heuristic 10 n/a, renormalized) |

## Design Specificity Verdict

**LLM assessment**: Not generic admin-panel boilerplate — genuinely built for this product's ops needs. The model-metrics panel surfaces real Brier/LogLoss/ECE calibration, a history-sync reliability monitor with a calls-budget guard, snoozable alerts, and manual Train/Refresh/Sync triggers. The users table directly encodes the actual Stripe tier/expiry/block operational model, not a generic user-edit form. Where it reads generic is the surrounding "Observatory"/lab chrome (icon rail, branding) that adds flavor without function. Overall: deep on ML telemetry, shallow on the safety rails around the routine user-management actions ops staff will use most often.

**Deterministic scan**: `detect.mjs --json` returned **0 findings** (exit 0) across the files explicitly scanned (`App.tsx`, `AdminObservatory.tsx`, layout shell files, `MatchModal.tsx`, `PerformanceCounterModal.tsx`, `Auth.tsx`). Assessment B confirmed this isn't rule suppression (no `.impeccable/config.json`/`config.local.json`, no `DESIGN.md`) and matches the documented regex-fallback engine behavior for `.tsx` files. **Coverage gap worth flagging**: Assessment A's code reading (following imports) reached several files Assessment B's scan command didn't explicitly include — `AdminUsersTable.tsx`, `AdminUsersPanel.tsx`, `AdminShell.tsx`, `PerformancePanel.tsx`, `useAppAuthActions.ts`, `ApiStatus.tsx` — which is exactly where A found its P0/P1 issues (no-confirm actions, outcome-blind status banner). So the detector's 0-finding result is over a narrower surface than the design review covered, on top of the already-known limitation that contrast/spacing/layout rules need rendered DOM. Treat "0 findings" as "no source-pattern hits in the files scanned," not "this surface is clean."

**Visual overlays**: Not obtained. `/workspace` redirected to the Romanian-language Supabase login gate; no admin credentials were available, so no live screenshot of the actual admin UI exists for this run (only the pre-auth login/landing page was seen).

## Overall Impression

The admin surface has real, deep, product-specific engineering behind it (ML calibration monitoring, sync-health tracking), but the actions ops staff will use constantly — changing a user's role, blocking an account, overriding a paid tier — have none of the safety rails that engineering effort elsewhere in the same file suggests the team knows how to build. The biggest opportunity: every irreversible, money- or access-affecting action here fires on a single click with no confirmation and reports its result through a banner an admin has usually already scrolled away from.

## What's Working

1. **The model-metrics panel is a genuinely deep, product-specific ML-ops instrument** — calibration buckets, stacker/Elo status, a history-sync reliability monitor with call-budget thresholds and persisted alert snoozing. Real engineering for this pipeline, not boilerplate.
2. **Modal accessibility is consistently well executed** across MatchModal, Auth, and PerformanceCounterModal — focus-trap, Escape-to-close, focus restoration, and correct ARIA wiring in every one of the three.
3. **The users table encodes the actual Stripe operational model** — tier draft + expiry draft + explicit Save Plan, with an inline hint that saving clears an expired date for paid tiers — rather than a generic edit-user form.

## Priority Issues

**[P0] No confirmation on destructive admin actions**
Why it matters: A misclick on "Make admin," "Block," or "Save Plan" immediately changes a user's access or paid tier with no undo — an irreversible action with zero confirmation step.
Fix: Add an inline confirm step (at minimum a native confirm, ideally a two-step affordance) before role-change and block/unblock, and a review step before tier/monetization save.
Suggested command: `/impeccable harden`

**[P1] Status feedback is a single, outcome-blind banner far from the action**
Why it matters: The shared status banner renders identical success-green styling for both success and failure text, and sits above the fold while the Users tab is scrolled deep below — an admin can't tell at a glance whether an action succeeded, and may re-click a destructive action believing it failed.
Fix: Color-code by outcome and/or add per-row inline feedback near the clicked button.
Suggested command: `/impeccable clarify`

**[P1] Inconsistent EN/RO mixing with no i18n layer**
Why it matters: Table headers are English while the wrapping panel is Romanian, and the toolbar mixes English buttons with Romanian tooltips/warnings, with zero `t()`/locale-hook usage anywhere in this admin path — reads as unreviewed drift, not a deliberate scope decision.
Fix: Standardize this internal surface on one language throughout (Romanian matches the team; a full i18n system isn't needed here, just consistency).
Suggested command: `/impeccable polish`

**[P2] IA bloat: 7 top-level tabs, two appearing to duplicate data**
Why it matters: Health and Diagnostics both source the same underlying service call, leaving it unclear to a time-pressed ops person which to check first.
Fix: Audit whether Health and Diagnostics can merge; collapse the ML-metrics block on the Dashboard tab behind a details/summary so it reads as scannable first.
Suggested command: `/impeccable distill`

**[P2] Decorative fake telemetry undermines trust in real telemetry**
Why it matters: The header hardcodes a static "v4.2 · latency ~12ms" string next to genuinely live metrics elsewhere on the same page — an ops tool's core value proposition is that its numbers are real.
Fix: Wire it to an actual measured value or remove it.
Suggested command: `/impeccable harden`

## Persona Red Flags

**Dana (ops/monitoring, daily health check)**: Her most important daily question — "is history sync healthy" — requires navigating several clicks deep into the Users tab's metrics panel; Health and Diagnostics tabs both draw from the same service with no signal which is authoritative; Warm/Predict actions give no per-action progress beyond the same outcome-blind status string; sync-alert snoozes persist to `localStorage` per-browser, not per-account, so they silently diverge across machines or shared logins.

**Marius (support/billing, one ticket at a time)**: No search/filter in the Users table — he scrolls a small, dense list to find one email. The auto-clear-expiry rule (blank/past expiry on premium/ultra silently becomes open-ended) is invisible outside a narrow inline hint — he could grant indefinite premium without realizing it. "Save Plan" fires immediately with no confirm or preview for a paying customer's subscription. Success text appears only in the header banner, easily missed once scrolled into the Users tab — risking an accidental double-save.

## Minor Observations

- The admin-view gate (`observatoryShell = Boolean(user)`) isn't itself role-checked — it only stays safe today because the router restricts the route to admin role before this component mounts. Fragile double-gating if this component is ever reused elsewhere.
- The "email missing" data-quality badge in the Users table is a nice small touch.
- The 3-day cap on multi-date selection is a sensible, well-messaged guardrail.
- A "DATA LEAD" role-label branch for non-admin logged-in users appears to be dead code given router-level gating already restricts this surface to admins.

## Questions to Consider

1. Given Health and Diagnostics both call the same service, do they serve genuinely distinct needs, or could merging them cut real tab count without losing anything?
2. Since role/tier changes affect a paying customer's billing state, should these actions write to a lightweight audit trail (who/when/what) instead of relying solely on an ephemeral status string?
3. Would support staff be better served by a "look up user first" flow (search by email → single-user detail view → act) than a flat, unfiltered table?
4. Is the Romanian/English mixing accumulated accident across contributors, or should this internal-only tool just standardize on Romanian outright?
