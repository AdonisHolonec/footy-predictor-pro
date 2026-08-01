---
target: Landing / Access page (LandingAccess.tsx)
total_score: 23
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 3
timestamp: 2026-08-01T06-32-11Z
slug: src-pages-landingaccess-tsx
---
Method: dual-agent (A: ae7817ae21b5ac2b9 · B: a3773d679606bcc9d)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Footer reflects real session state, but the "limited time" campaign banner has no real end date and can display indefinitely. |
| 2 | Match Between System and Real World | 2/4 | Plan feature lists lean on unexplained jargon ("EV/Kelly", "Signal Lens", "Edge Compass") with zero inline definitions. |
| 3 | User Control and Freedom | 3/4 | No destructive actions; `#pricing` anchor is a nice non-committal peek, but no side-by-side tier comparison view exists. |
| 4 | Consistency and Standards | 1/4 | Every CTA routes to `Login.tsx`, a completely different design language (neon "cinematic observatory") with hardcoded untranslated Romanian strings that surface even under the EN locale. |
| 5 | Error Prevention | 4/4 | Tier selection is deep-linked via query param so the choice survives the redirect to login; no risky irreversible actions here. |
| 6 | Recognition Rather Than Recall | 3/4 | Campaign price shows both crossed-out and new price side by side; minor recall burden comparing 3 stacked cards on mobile. |
| 7 | Flexibility and Efficiency of Use | 2/4 | No monthly/annual toggle; three visually-identical CTAs (hero, Premium, final) offer no differentiated fast path. |
| 8 | Aesthetic and Minimalist Design | 2/4 | Palette is almost entirely one hue family for CTAs, badges, and the Premium "highlighted" ring — Premium barely reads distinct from Ultra; pricing eyebrow and heading render the identical string twice. |
| 9 | Error Recovery | 3/4 | `useAuth.ts` passes raw Supabase `error.message` straight into UI state untranslated — an English error can surface under the RO locale. |
| 10 | Help and Documentation | n/a | Reasonable to exempt for a ~2-minute Persuade-mode signup surface. |
| **Total** | | **23/36** | **Acceptable** (heuristic 10 n/a, renormalized) |

## Design Specificity Verdict

**LLM assessment**: Mixed, tilted generic. The hero headline and benefit bullets are boilerplate prediction-SaaS language — "live," "in-play," "momentum," or "minute-by-minute" appear nowhere, despite live match intelligence being the stated differentiator. The preview card does earn real specificity (real team/league crest URLs from the same CDN the live product uses, mirroring the actual prediction-card layout), but it's frozen pre-kickoff with a static clock — the one visual moment that could prove the differentiator instead proves the opposite: it looks like any static odds-preview widget.

**Deterministic scan**: `detect.mjs --json` returned **0 findings** on the 4 TSX source files scanned, reproducing the same regex-engine limitation seen on the two prior surfaces (contrast/spacing/text-size rules need rendered DOM). Unlike those two runs, this critique also captured full **browser-overlay evidence**: the injected detector found **27 anti-patterns (39 individual finding lines — a header/detail count mismatch reported as observed, not reconciled)** on the rendered page, concentrated in the hero and pricing sections — `low-contrast` (white-on-accent CTAs at 4.2:1, accent-on-light kickers at 3.8:1, navy-on-warning discount badges at 3.3:1, all below the 4.5:1 AA floor), `undersized-ui-text` (9-11px functional text across brand kicker, preview-card labels, stat labels, plan labels), `cramped-padding` on CTA buttons, `line-length` overruns on two paragraphs, and a duplicate `kicker-above-heading` where the eyebrow and `<h2>` render the identical string ("Planuri"/"Planuri") — independently corroborating Assessment A's own minor observation of the same duplicate string.

**Visual overlays**: Obtained on desktop (~1536px) — the overlay shows a dense cluster of orange annotation boxes over the hero CTA, brand kicker, and pricing-card labels. A true mobile-viewport (~390px) screenshot could not be captured — the browser tool's resize call did not change the tab's actual viewport in this session, so mobile evidence for this run is inferred from source only, not rendered.

## Overall Impression

The page is functionally clean (no P0, no broken flow) but undersells the product it's selling. It reads as a competent generic prediction-SaaS landing page rather than a page built around this product's actual proven edge — and the moment it hands the visitor to Login, the design language and even the locale promise both break. The biggest opportunity: put the product's one real, working trust asset (accuracy/ROI history, already built and rendering on Login.tsx) on the page whose entire job is convincing skeptics, and let the preview show a match in progress instead of a frozen pre-kickoff card.

## What's Working

1. **The preview card is honest, not decorative** — it pulls real crest imagery from the same CDN the live product uses and mirrors the actual in-app prediction-card layout, substantiating the "same look as the app" claim rather than using generic stock screenshots.
2. **Pricing/billing separation is clean and safe** — campaign copy explicitly derives from campaign price + discount percent rather than duplicating hardcoded amounts, reducing the risk of marketing copy drifting from real Stripe billing.
3. **RO/EN parity on this specific page is genuinely excellent** — every visible string routes through `t()`, with natural (not machine-feeling) translations in both directions. (This makes the break at Login.tsx more jarring, not less — see Priority Issues.)

## Priority Issues

**[P1] No visible proof/trust signal on the page meant to convert skeptics**
Why it matters: Product principle #1 is trust earned via visible accuracy/ROI history — but the landing page shows zero real performance numbers; the only pointer to proof is a small footer text link, while the identical stat block already exists and works on `Login.tsx`.
Fix: Surface a compact real stat (e.g. 30-day success rate/settled count) near the hero or directly above pricing, reusing the existing stat-block pattern already built for Login.
Suggested command: `/impeccable clarify`

**[P1] The stated differentiator (live match intelligence) is invisible on its own landing page**
Why it matters: The preview card and copy never depict or mention "live," "in-play," or momentum — the one artifact meant to prove the product's edge shows a frozen pre-kickoff snapshot with a fixed clock.
Fix: Swap or augment the static preview card with a simplified live-momentum teaser, and add explicit "stays useful after kickoff" framing to the hero/sub copy.
Suggested command: `/impeccable adapt`

**[P1] Landing → Login is a jarring design-language and locale break at the exact commitment moment**
Why it matters: `LandingAccess.tsx` is flat/minimal/restrained; `Login.tsx` is a neon-glow "cinematic observatory" with parallax and glow effects, plus hardcoded untranslated Romanian strings that appear even under the EN locale — right when the visitor is deciding whether to hand over an email/password.
Fix: Unify the two surfaces' visual language and route every literal string in `Login.tsx` through `t()`.
Suggested command: `/impeccable audit`

**[P2] Touch targets on nearly every CTA fall below the product's own accessible minimum**
Why it matters: The design system defines a 44px touch-target token, but the header login link, all three pricing-tier CTAs, and the final-CTA row override it down to 36px — undercutting the token meant to guarantee comfortable mobile tap targets.
Fix: Remove the 36px overrides or raise them to the 44px token, at minimum on mobile breakpoints.
Suggested command: `/impeccable harden`

**[P2] A cluster of contrast, undersized-text, and cramped-padding defects concentrated in the hero and pricing sections**
Why it matters: Browser-overlay evidence (not just static scan) confirmed multiple real instances: white-on-accent CTA text at 4.2:1, accent-on-light kickers at 3.8:1, and navy-on-warning discount badges at 3.3:1 — all below the 4.5:1 AA floor — plus 9-11px functional text throughout (brand kicker, preview-card labels, stat labels, plan labels), cramped vertical padding on pricing-card CTA buttons, two paragraphs overrunning the readable line-length target, and a duplicate kicker/heading string ("Planuri"/"Planuri") independently confirmed by both assessments.
Fix: Introduce a darker accent-text token for small/bold text use (reserving the brighter accent for large text and non-text UI), raise undersized labels to the 11px floor, add vertical padding to CTA buttons, and de-duplicate the pricing section's eyebrow/heading text.
Suggested command: `/impeccable typeset`

## Persona Red Flags

**Jordan (confused first-timer)**: Every pricing tier is a wall of insider shorthand with no explanation ("1X2 + O/U + Cornere," "Signal Lens + Edge Compass," "EV/Kelly + special bets"). Jordan cannot tell what she's paying for without already knowing the product, and there's no plain-language "what is this" moment before the plan grid.

**Riley (deliberate stress tester)**: Preview-card crest images hit an external CDN directly with no `onError` fallback — on a slow connection or ad/tracker blocker, the one visual meant to prove product specificity renders as broken-image icons. Switching to EN and clicking any CTA lands on `Login.tsx`, which still shows untranslated Romanian strings — the RO/EN promise this page makes is broken one click later. A failed login can also surface a raw, untranslated Supabase error message under the RO locale.

**Casey (distracted mobile user)**: The page stacks cleanly on a narrow viewport (per source inspection; a true rendered mobile screenshot wasn't obtainable this run), but the touch-target regression (36px instead of the 44px token) is exactly the kind of thing that costs mis-taps for a one-handed thumb-scrolling user arriving from an ad/share link. The page also front-loads well over a dozen similar-weight tap targets into a single scroll with no pause point.

## Minor Observations

- The pricing section's eyebrow and `<h2>` render the identical string twice ("Planuri"/"Planuri") — confirmed independently by both the design review and the browser detector's `kicker-above-heading` finding; looks like a copy-paste oversight.
- Keyboard focus is inconsistent: primary/secondary link buttons get a deliberate, visible focus-visible outline, but the RO/EN toggle buttons fall back to a faint browser-default outline.
- Footer links sit in a plain `<div>`, not a `<nav>` landmark — a minor semantic-HTML gap for screen-reader landmark navigation.
- The "limited time" campaign banner's end date is permanently unset, so the urgency messaging is designed to never actually expire — a soft misalignment with the product's own "earn trust, don't assert" principle.

## Questions to Consider

1. If "stays useful during a live match" is the real differentiator, what would the hero look like if the first thing a visitor saw was a match currently in progress, rather than a static pre-kickoff card frozen at a fixed time?
2. The product's strongest trust asset (real accuracy/ROI history) already exists and renders correctly on Login — why is it withheld from the page whose entire job is converting skeptics?
3. Landing and Login currently read as two different products (flat minimalist vs. neon cinematic) — which is the intended brand voice, and should the other be brought in line before a third surface inherits the drift?
4. With three identically-styled "primary" buttons and roughly a dozen total tap targets on one continuous scroll, what is the one action this page most wants a skeptical bettor to take — and would the design still look this way if that answer had to be visually unambiguous?
