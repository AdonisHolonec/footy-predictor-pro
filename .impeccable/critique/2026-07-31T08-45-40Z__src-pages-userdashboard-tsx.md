---
target: Consumer Dashboard (UserDashboard.tsx)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-07-31T08-45-40Z
slug: src-pages-userdashboard-tsx
---
Method: dual-agent (A: a880dd1cbe64301c3 · B: a3fda02228666d409)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | Live poll failures are swallowed silently — no "last updated"/stale indicator despite live polling being the core promise. |
| 2 | Match Between System and Real World | 3/4 | Correct football/betting vocabulary and RO-first defaults fit the audience; some quant jargon (EV%, Kelly, λ) unexplained. |
| 3 | User Control and Freedom | 3/4 | Real focus trap, Escape-to-close, focus restoration in MatchModal; explicit "Reset filters" in Settings. |
| 4 | Consistency and Standards | 2/4 | "Predictions" nav label resolves to two different views on desktop vs. mobile; hardcoded RO/EN literals bypass `t()`. |
| 5 | Error Prevention | 2/4 | Predict silently consumes a hard daily quota with no warning near the button; notification opt-in correctly gated on consent. |
| 6 | Recognition Rather Than Recall | 2/4 | MatchModal's `DETAIL_TABS` has 11 entries users must recall across sessions. |
| 7 | Flexibility and Efficiency of Use | 1/4 | Only one accelerator (⌘K Command Palette); no bulk actions, no in-modal tab shortcuts, no saved filter presets. |
| 8 | Aesthetic and Minimalist Design | 2/4 | A single 2137-line MatchModal.tsx stacks momentum, standings, advanced signals, Monte Carlo, xG, value tables, special bets. |
| 9 | Error Recovery | 2/4 | Success and error text render through the same generic status-banner styling — no visual severity distinction. |
| 10 | Help and Documentation | 1/4 | No persistent legend for the 5-value tier taxonomy; onboarding is one-shot with no re-entry from Settings. |
| **Total** | | **20/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment**: The domain logic is genuinely bespoke — `MatchMomentumTimeline.tsx`'s `buildMatchStory()` generates a deterministic, rule-based live narrative (red-card shifts, substitution clusters, shot-gap, dominance thresholds), and `MatchModal.tsx` carries real betting-market machinery (Poisson corners/shots tables, a 5-value `MarketTier` taxonomy, Kelly stake plans, xG luck badges). That's real product-specific engineering, not template filler. Where it reads generic is the visual chrome — KPI tiles, tab bar, sidebar, badge pills are shapes any fintech/analytics SaaS would use. The differentiator is real in the data model but under-expressed in the visual hierarchy: the live "Match Story" panel that should be the headline moment is visually just another bordered card among a dozen others in a very long modal.

**Deterministic scan**: `detect.mjs --json` returned **0 findings** (exit 0) across 25 scanned files (`UserDashboard.tsx`, `MatchModal.tsx`, and 23 files under `src/components/ux/`). Assessment B validated the detector wasn't silently no-op'ing by running it against synthetic files with known violations (correctly caught `gradient-text`, `gray-on-color`, `side-tab`, `ai-color-palette`), confirming the tool works and the `0` on the real dashboard is genuine — for the rule subset the TSX regex-fallback engine can actually reach. That subset excludes contrast, computed spacing/sizing, and layout-density rules, which only run against rendered DOM. So the 0-finding result means "no source-level Tailwind/inline-style anti-patterns," not "the rendered UI is clean" — and indeed Assessment A independently found a real contrast issue (`--fp-text-faint: #7d7979` on white ≈ 4.3:1, below AA) that this scan mode structurally cannot catch.

**Visual overlays**: Not obtained. Browser inspection of `/workspace` was blocked by the Supabase auth gate (redirected to `/login`); no test credentials were available, so no live screenshot or injected-detector console evidence exists for this run.

## Overall Impression

The underlying prediction/live-intelligence engineering is legitimately sophisticated and specific to this product — that's the foundation a competitor can't easily copy. But the interface hasn't kept pace with feature accretion: an 11-tab, 2000+ line modal buries the "glance during a live match" use case under Monte Carlo tables and correct-score grids, the one feature that should carry the most emotional weight (live match narrative) reads as visually equal-weight to everything else, and the live-data pipeline that is the whole point of the product fails silently when the network hiccups. The single biggest opportunity: make "is this data live and fresh right now" and "what's the one-line story of this match" the two most visually dominant things on screen, and demote the deep analytics behind an explicit expansion.

## What's Working

1. **`buildMatchStory()` in `MatchMomentumTimeline.tsx`** — a genuinely bespoke, deterministic narrative generator over live match events. This is exactly the live-intelligence positioning from PRODUCT.md, implemented as real product logic, not decoration. Recent commits show continued, targeted investment here.
2. **Accessibility plumbing in `MatchModal.tsx` is above average for a hand-rolled modal** — a real focus trap (Tab/Shift+Tab cycling), Escape-to-close, focus restoration on close, and correctly wired `aria-modal`/`aria-labelledby`/`aria-describedby`.
3. **Tier-gating correctness, not just tier-gating visuals** — `UserDashboard.tsx`'s tier-promotion effect actively detects and clears under-masked cached predictions when a user's effective tier changes, rather than trusting stale localStorage. Real engineering care for the freemium model in PRODUCT.md.

## Priority Issues

**[P0] Live-poll failures are invisible to the user**
Why it matters: The product's stated differentiator is staying useful *during* a live match, but `useLiveFixtureScorePoll.ts:179-180` swallows every poll error (bare `catch { /* ignore transient network errors */ }`) with zero UI consequence. A bettor watching a live match on a flaky connection sees a frozen feed indistinguishable from "nothing has happened yet."
Fix: Track `lastSuccessfulPollAt`; render a small "live · updated Xs ago" indicator that shifts to amber/red past ~2x the poll interval, with a manual retry affordance.
Suggested command: `/impeccable harden`

**[P1] RO/EN locale parity is broken in code, not just hypothetically**
Why it matters: At least a dozen `setStatus(...)` calls and JSX literals in `UserDashboard.tsx` hardcode Romanian text outside the `t()` system, while one hardcodes English instead — firing during Stripe checkout, GDPR export, trial activation, and notification saves, exactly the high-stakes billing/consent moments where language consistency matters most.
Fix: Move every literal into `en.ts`/`ro.ts` and route through `t()`.
Suggested command: `/impeccable clarify`

**[P1] `MatchModal` bundles 11 tabs and over-shows on the default view**
Why it matters: `DETAIL_TABS` (overview/prediction/statistics/h2h/form/xg/montecarlo/value/odds/why/timeline) is ~3x the "≤4 visible options" cognitive-load target, and the default "overview" tab itself still renders the xG/odds/value grid plus explanation panels simultaneously. This fights PRODUCT.md's own "scanability over decorative polish" principle for a bettor making a fast in-play read.
Fix: Split into a "glance" default (score, momentum, top pick) with deep analytics (H2H/xG/Monte Carlo/correct-score) behind an explicit "Full analysis" expansion; cut default-visible tabs to ≤4.
Suggested command: `/impeccable distill`

**[P1] "Predict" quota consumption is invisible next to the action that spends it**
Why it matters: `ConsumerShell.tsx` places "Predict" (quota-consuming) and "Refresh" (free) as adjacent, similarly weighted buttons; remaining quota is only visible deep in the Profile tab. An impatient user can burn a limited daily allotment with no warning at the point of action — the code's own inline comment flags this distinction as non-obvious.
Fix: Surface remaining quota as a live badge on/beside the Predict button; differentiate its visual weight from Refresh.
Suggested command: `/impeccable clarify`

**[P2] The "Predictions" nav label points to two different destinations by device**
Why it matters: `appNav.ts` gives the "matches" item a `mobileShortKey` of `nav.predictions`, so mobile's "Predictions" tab renders `MatchesSection`, while desktop's separate "predictions" sidebar item renders the full analytics board. A user who learns the app on one platform gets a different mental model on the other — a concrete Consistency (#4) break.
Fix: Unify the label→view mapping across breakpoints, or give the two destinations distinct names.
Suggested command: `/impeccable clarify`

## Persona Red Flags

**Alex (impatient power user)**: Only one efficiency accelerator exists (⌘K Command Palette); the 11-tab MatchModal has no keyboard shortcuts for switching tabs. No bulk actions — predicting requires opening the league drawer as a separate modal hop. Quota burn is invisible at the point of action (see P1).

**Sam (accessibility-dependent)**: `--fp-text-faint: #7d7979` on `--fp-bg-card:#ffffff` computes to ~4.3:1, below the 4.5:1 AA baseline — and it's used at 8-10px sizes exactly where more contrast is needed (sample-size footnotes, referee name, momentum minute-tick labels). Momentum event markers are small (h-7 w-7) icon-only buttons relying on hover tooltip as the primary sighted-user affordance, easy to miss on touch. On the positive side: the real focus trap and visible focus-visible outlines throughout are solid compliance work.

**Riley (deliberate stress tester)**: Confirmed — the live-score poll's silent `catch` means a refresh or reconnect mid-live-match produces no distinguishable error state from "quiet match, no new data." Positive counter-finding: the tier-promotion effect explicitly handles the "user upgrades mid-session" edge case by clearing under-masked cached predictions.

## Minor Observations

- `AppShell.tsx` appears to be a second, largely unused shell (not imported by `UserDashboard.tsx`, which uses `ConsumerShell` instead) yet still hardcodes "Log out" in English — sign of drift between two parallel shell implementations.
- The `status` banner renders both success and error messages through the identical accent-colored box with no severity differentiation (color/icon).
- `OnboardingCarousel` only ever appears once, with no way to manually reopen it from Settings.
- Lazy-loaded analytical panels in `MatchModal` fall back to plain-text "Loading…", while `MatchesSection` uses a proper skeleton-card grid — inconsistent loading-state fidelity on the same page.

## Questions to Consider

1. If live intelligence is the differentiator, what would change if data staleness were a first-class, always-visible signal (like a stock ticker's "delayed" badge) instead of a silently-swallowed poll error?
2. Did feature accretion (Monte Carlo, xG, correct-score value tables, special-bet legs) outpace the original "quick glance during a live match" use case — would a two-layer "glance vs. dive" split serve bettors better than 11 tabs?
3. Should the Predict button itself carry the remaining daily-quota affordance, rather than requiring a trip to the Profile tab?
4. Was routing "Predictions" to two different views on desktop vs. mobile a deliberate decision — and if so, should the labels diverge to match that reality?
