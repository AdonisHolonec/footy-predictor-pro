---
target: Admin Dashboard (AdminDashboard.tsx)
total_score: 26
max_score: 36
na_heuristics: 10
p0_count: 1
p1_count: 0
timestamp: 2026-08-01T07-15-39Z
slug: src-pages-admindashboard-tsx
---
Method: dual-agent (A: a8d4367965af32e53 · B: a5becc43bb11eaaf8)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 4/4 | Loading/disabled states, sync health tones, and inline row feedback are thorough. |
| 2 | Match Between System and Real World | 3/4 | Romanian consequence copy in confirm dialogs is domain-accurate; ML jargon assumes admin literacy (acceptable for this persona). |
| 3 | User Control and Freedom | 3/4 | Confirm gates and a "Șterge" clear-expiry control exist; no explicit "discard draft" control for tier/expiry edits. |
| 4 | Consistency and Standards | 3/4 | Strong token/tone consistency; AdminShell tabs, AdminFilterDeck, and the Auth modal remain English — documented as out of the fix's scope, not a regression. |
| 5 | Error Prevention | 2/4 | The new confirm-message helper crashes on a specific real path (cleared expiry + paid tier) — a genuine regression in the code meant to add safety. |
| 6 | Recognition Rather Than Recall | 3/4 | Current-vs-draft tier badge and per-row identity remove recall burden. |
| 7 | Flexibility and Efficiency of Use | 3/4 | Multi-day picker, alert snooze, failures-only filter; no bulk row actions, a reasonable scope limit. |
| 8 | Aesthetic and Minimalist Design | 3/4 | Dashboard tab is genuinely less dense now; Model Metrics stays information-rich once expanded, appropriately. |
| 9 | Error Recovery | 2/4 | Row feedback shows ✓/✗ but not why; the new crash path produces zero feedback at all. |
| 10 | Help and Documentation | n/a | Internal daily-use tool for staff who already know the domain — same justification as before. |
| **Total** | | **26/36** | **Good** (up from 17/36; heuristic 10 n/a, renormalized) |

## Design Specificity Verdict

**LLM assessment**: Still reads as a purpose-built ops tool, not generic admin boilerplate — the confirm-dialog copy is domain-specific, the ML vocabulary (Brier, ECE, calibration buckets, stacker weights) is real, and the sync-reliability monitor is clearly modeled on this product's actual pipeline. The fixes reinforce this rather than generify it.

**Deterministic scan**: `detect.mjs --json` returned **0 findings** across a *wider* file set than the prior run (this time explicitly including `AdminUsersPanel.tsx`, `AdminUsersTable.tsx`, `PerformancePanel.tsx`, which the previous CLI pass had omitted — a known coverage gap now closed). Assessment B verified this wasn't rule-suppression (`--no-config` produced the identical empty result) and confirmed the wider coverage still surfaces nothing — consistent with, not contradicting, the prior run. The real defect this cycle (a runtime crash) is exactly the kind of issue this static regex-based scanner structurally cannot catch — it requires tracing actual data flow through a specific interaction sequence, not a source-pattern match.

**Visual overlays**: Not obtained — `/workspace` redirected to `/login` in both assessments; no admin credentials available.

## Overall Impression

Real progress: role change and block/unblock are now genuinely safer, feedback is closer to the action, and the Dashboard tab is less cluttered. But the fix for the third mutating action — tier/plan save — shipped with an unverified crash in exactly the workflow it was meant to protect (clearing an expired date and granting paid access), and unlike the pre-fix behavior, this one fails **silently with no dialog and no feedback at all**. That's the one thing to fix before calling this pass done.

## What's Working

1. **Role change and block/unblock are now fully trustworthy** — `runRowAction` requires an explicit confirm naming the user and consequence, awaits the real handler, and only shows failure when the handler actually returns `false`. Verified directly against `useAppAuthActions.ts`'s `handleAdminRoleChange`/`handleAdminToggleBlock`, which correctly return `Promise<boolean>`.
2. **Model Metrics is genuine progressive disclosure now** — `CollapsiblePanel`'s `defaultOpen={false}` is not overridden in `PerformancePanel.tsx`, so the Dashboard tab verifiably chunks to 4 default-visible blocks instead of 5 always-expanded ones.
3. **The Romanian-standardization fix landed cleanly** — `AdminUsersTable`/`AdminUsersPanel`/`AdminToolbarStrip` are consistently Romanian now (aside from "Warm"/"Predict," which read as deliberate technical operation names, not leftover drift). The fake "v4.2 · latency ~12ms" string and the dead "DATA LEAD" branch are both confirmed gone via grep.

## Priority Issues

**[P0] `describeMonetizationChange` crashes on cleared-expiry + paid-tier save — a regression in this session's own fix**
Why it matters: This is the exact "grant unlimited access" workflow the UI's own red "Expirat" banner prompts the admin to perform. `expiryDraft` after clicking "Șterge" is `""` (not `undefined`), so `new Date("").toISOString()` throws `RangeError: Invalid time value` (independently reproduced). The crash happens *before* `window.confirm` ever fires — no dialog, no error, no row feedback, just a dead click. Worse than the pre-fix state for this specific path, since previously there was no confirm gate to crash on.
Fix: Guard the date parse the same way `localDatetimeInputToIso` in `useAppAuthActions.ts` already does — treat a falsy/empty `expiryDraft` as "no draft override" (fall through to `fallbackExpiry`) instead of feeding it straight to `new Date(...).toISOString()`.
Suggested command: direct fix to `describeMonetizationChange` in `src/components/panels/AdminUsersTable.tsx`.

**[P2] Row feedback shows outcome but not cause**
Why it matters: On failure, the row shows a generic "✗ ... — eșuat" with no reason; the actual error message only surfaces in the global status banner elsewhere on the page, decoupled from the row that failed.
Fix: Carry an optional error-detail string through the row-feedback state and surface it in the row chip/tooltip, not just ok/fail.
Suggested command: `/impeccable clarify`

**[P3] `isAdminWorking` is a single global flag shared across all rows**
Why it matters: While one row's action is in flight, every other row's buttons also disable — can read as "broken" on a busy table rather than "busy elsewhere." Cosmetic under normal single-admin usage.
Fix: Scope the in-flight flag per user id instead of one shared boolean.
Suggested command: `/impeccable polish`

## Persona Red Flags

**Ops/monitoring (daily health checks)**: All previously-found red flags resolved — fake telemetry gone, dead role-label branch gone, Dashboard tab genuinely less noisy on first glance. Health/Diagnostics tab distinction confirmed as a real difference (different files, different service call windows), not unaddressed duplication. No new red flags for this persona.

**Support/billing (one user issue at a time)**: Role change and block/unblock red flags resolved — real confirm + real feedback, verified in code. **New red flag**: the tier/monetization save path — the action this persona performs most for billing overrides — can now silently fail before the confirm dialog even appears, in precisely the "clear expiry, grant unlimited paid access" scenario. This is a regression introduced by this session's fix, not a residual old issue.

## Minor Observations

- Language isn't perfectly uniform across the whole admin surface yet — `AdminShell` tab labels and `AdminFilterDeck` remain English, and the shared `Auth` modal mixes English headings with Romanian helper text. Outside the stated fix scope (only the Users table/panel/toolbar were targeted), so not a regression — worth an explicit call if full RO consistency is wanted later.
- `observatoryShell = Boolean(user)` still derives the admin shell from "any logged-in user," not an explicit `isAdmin` check — confirmed safe today only because `RootRouter`'s `AuthGate` routes non-admins to `UserDashboard` first. Same minor observation flagged and deliberately left alone last time.

## Questions to Consider

1. The tier/expiry crash shipped inside the same commit that added confirmation dialogs — was the "clear expiry then save premium/ultra" path manually clicked through before calling that fix done, or only role/block?
2. Now that Model Metrics is collapsed by default, is there any signal on the collapsed header when there's an active sync-reliability alert underneath it — or does collapsing it also hide the one thing an ops person most needs to notice at a glance?
3. Is "Warm"/"Predict" staying English inside an otherwise fully-Romanian table a deliberate convention (technical operation names) worth documenting, or should it be revisited if full RO consistency becomes a goal?
