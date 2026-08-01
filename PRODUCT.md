# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Serious football bettors and tipsters who place real bets and need trustworthy, well-calibrated match probabilities — not casual fans browsing scores for fun. They are evaluating the product on whether its picks actually hold up over time, and whether they can act on them while a match is live.

## Product Purpose

Footy Predictor Pro (internal name "Footy Predictor UI") generates match outcome predictions from a statistical/ML pipeline (league profiles, market validation, walk-forward calibration) and layers live match intelligence on top — live minute/event tracking and momentum timelines — so a bettor can follow and act on a prediction as the match unfolds, not just before kickoff. Success means users trust the picks enough to act on them and keep coming back to check accuracy/ROI history.

## Positioning

The differentiator is live match intelligence: real-time momentum timelines and live event/minute tracking fused with the prediction, so the product stays useful *during* the match rather than going stale at kickoff like a static odds/prediction page. A competitor could copy a prediction model; they can't as easily copy the live-tracking layer bettors actually watch mid-match.

## Operating Context

- Nav surfaces: Home, Matches, Predictions, Live, History, Statistics, Notifications, Profile, Settings (`src/components/ux/appNav.ts`).
- Automated daily pipeline: a Vercel cron (`/api/cron/warm-predict`, scheduled for early morning Europe/Bucharest) warms data and runs Predict, then syncs match history/results.
- Data provider: API-Football (api-sports.io), dual-mode direct or via upstream base URL.
- Auth/data: Supabase (users, roles, usage limits); Redis/Upstash + Vercel KV for caching and anonymous rate limiting.
- Notifications sent via Resend (email alerts).
- Admin role: promoted via `ADMIN_EMAILS`, with an internal Admin Dashboard (`src/pages/AdminDashboard.tsx`) separate from the consumer app shell.
- Bilingual: English and Romanian (`src/i18n/en.ts`, `src/i18n/ro.ts`) — team is Romania-based; Romanian is a first-class locale, not an afterthought.

## Capabilities and Constraints

- Freemium subscription via Stripe: a free tier plus paid **Premium** and **Ultra** tiers (`STRIPE_PRICE_PREMIUM`, `STRIPE_PRICE_ULTRA`) gating usage limits/features. Exact tier feature boundaries beyond usage limits are undecided/unrecorded here — treat as open unless the user specifies.
- Anonymous (unauthenticated) users get separate, lower IP-based rate limits on Warm/Predict; authenticated users get Supabase-tracked usage limits instead.
- Cron/internal endpoints require `CRON_SECRET` bearer auth in production; local dev allows unauthenticated calls when unset.
- Live/mobile-first consumer shell exists alongside a distinct Admin Dashboard — design work for one should not assume it applies to the other.

## Brand Commitments

Name: Footy Predictor Pro (repo/package name: "footy-predictor-ui"). No other binding visual or voice commitments recorded yet.

## Evidence on Hand

Recent shipped work (from commit history) establishes real product surfaces to treat as incumbent, not hypothetical: a "Good Morning" dashboard, an Accuracy/ROI history and trust tracker, a Match Momentum timeline driven by real match events, and a redesigned prediction card showing live match minute. No fabricated testimonials, pricing copy, or customer logos should be introduced — none exist yet.

## Product Principles

1. Trust is earned by showing the model's track record (accuracy/ROI/trust tracker), not by asserting confidence.
2. The product must stay useful *during* a live match, not just pre-kickoff — live intelligence is core, not a bonus feature.
3. Bettors are the design target: prioritize scanability of probabilities/stats and fast in-match updates over decorative polish.
4. Romanian and English are both first-class; UI text and copy changes must consider both locales.
5. Free, Premium, and Ultra tiers coexist — features and limits should be designed with tier-gating in mind, not as an afterthought bolted on later.
