## Learned User Preferences

- Keep common betting/thematic terms in English (e.g. SAFE, not awkward calques like SIGUR); prefer simple, weighty wording over forced Romanian jargon translations.
- Do not modify PredictorV3 or core prediction/probability/confidence math unless explicitly asked; Special Bet and presentation changes must stay outside that core.
- Prefer Graphify and CodeGraph (often with claude-mem) when exploring or changing this codebase.
- Special Bet must never include two legs from the same market family; pick deterministically by highest Recommendation Score among remaining families; UI only renders the builder output (no extra filter/rank/dedupe).
- Special Bet is available only for Ultra and Admin.
- Prediction date window: Premium +1 day, Ultra +2 days (UI labels like +1zi / +2zile).
- Admin accounts must have no warm/predict quota restrictions.
- Prefer a premium, modern product UI — avoid casino/betting-site neon looks and generic admin chrome; mobile card layout and polish matter.
- Never recommend negative-EV bets; reuse cached API/football data whenever possible.
- Loading or viewing past-day predictions must not consume the daily predict quota.
- When the recommended pick is already a goals market, the Goals slot should show the next-best distinct goals pick, not a duplicate of recommended.
- Daily warm/predict limits are tier-based (latest intent: Free 5/5, Premium 20/20, Ultra 50 unique fixtures); keep marketing/Stripe copy aligned with enforced limits.

## Learned Workspace Facts

- Footy Predictor Pro deploys on Vercel (`footy-predictor-pro.vercel.app`) with Supabase Auth/DB and API-Football as the live data source.
- Vercel Hobby serverless function limits (~12) drive consolidating API endpoints rather than adding new top-level functions casually.
- User-facing leagues are the fixed elite set (`ELITE_LEAGUES` / ~10 competitions), not an open-ended all-leagues list.
- Auth tiers are Free / Premium / Ultra; admin (profile role or bootstrap admin emails) is warm/predict quota-exempt; usage is tracked per Europe/Bucharest calendar day in Supabase.
- Special Bet selection lives in `src/utils/specialBet.ts` (`pickSpecialBetLegs` / `listSpecialBetCandidates`); market-family identity comes from `resolveMarketFamilyKey` in `src/utils/formatRecommendation.ts`.
- Recommendation ranking is `selectRecommendation` + `recommendationWeights.js` (not PredictorV3). Soft `safeOuScorePenalty` dampens over-common Over 1.5 / Under 3.5 so they do not dominate typical fixtures; clear high-confidence leaders can still win.
- Prediction history, settlement, and related user fixtures persist in Supabase (not localStorage-only).
- Stripe handles Premium/Ultra subscriptions (EUR list/sale prices have been set in product copy); billing success returns users to the app to refresh tier.
- Project operating docs include `AI_WORKFLOW.md` and `PRODUCT_DNA.md`; preserve PredictorV3 and avoid duplicating prediction logic.
