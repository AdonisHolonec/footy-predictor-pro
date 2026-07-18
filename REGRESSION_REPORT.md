# REGRESSION_REPORT.md
## Zero-Regression Contract — UX V4

**Hard rule:** Prediction engine, API, database, permissions, authentication, calibration, ML, Monte Carlo, caching, and business rules **must not change**. Only user experience presentation may change.

---

## 1. Protected surfaces (do not touch)

| Area | Paths / systems |
|------|-----------------|
| Prediction engine | `server-utils/pipeline/**`, prediction modules |
| API routes | `api/**` (unless pure response shaping already client-side) |
| DB / migrations | `supabase/**`, SQL |
| Auth / roles | Supabase auth flows, role checks |
| Billing rules | Stripe price IDs, tier limits logic |
| Caching / cron | Vercel crons, cache keys |
| Settlement / CLV / backtest math | Existing services |

**Allowed:** `src/pages/*` user UI, `src/components/**` presentation, `src/design-system/**`, copy/labels, CSS tokens, client-only prefs UX.

---

## 2. Functional regression matrix

| Capability | Must still work | How to verify |
|------------|-----------------|---------------|
| Login / signup / reset | AuthGate → workspace | Manual + existing tests |
| Tier limits | Free/Premium/Ultra predict quotas | Profile + predict CTA |
| Trials 24h | Activate + expiry | Profile |
| Stripe checkout / portal | Redirects | Staging Stripe |
| League selection persist | Selected leagues after reload | LeaguePanel |
| Predict warm+run | Cards populate | Predict button |
| Live scores | Poll updates | Live filter |
| Match detail data | All tabs show same payloads | Open known fixture |
| Favorites / watchlist | ★ persists | Reload |
| History win/loss | Rows + Success Rate | History view |
| Notifications prefs | Save + reload | Notifications |
| Theme cycle | dark/light/contrast | Profile |
| GDPR export | JSON download | Profile |
| Public track record | Metrics load | `/track-record` |
| Privacy links | Reachable | Footer / Login |
| Admin isolation | Admin never in user tabs | Admin account |

---

## 3. Permission / tier regression

| Gate | Expected |
|------|----------|
| Date +1 / +2 | Tier-gated as today |
| Special Bet legs | Ultra/admin only |
| Settled markets filter | Same eligibility |
| Value-only / EV / confidence | Client filter only — same math |
| Email notifications | Consent required |

---

## 4. UI change safety checks

After each V4 PR:

- [ ] `npm test` / vitest unit suite green  
- [ ] Production build succeeds  
- [ ] No new imports from admin-only heavy panels into UserDashboard  
- [ ] Network tab: same predict/history/billing endpoints  
- [ ] Response payloads unchanged (diff JSON keys on sample fixture)  
- [ ] Console: no new errors/warnings on happy path  

---

## 5. Known baseline defects (not regressions if unchanged)

Documented in audit; fixing is allowed in V4 UI:

- Dead `isNotificationsOpen`  
- Touch targets &lt;44px  
- Partial filter persistence  
- VirtualizedMatchGrid not true virtualization  

---

## 6. Rollback plan

1. Revert UI-only commit(s)  
2. Confirm `/workspace` predict still returns prior payload shape  
3. No DB migrate rollback needed if V4 stayed UI-only  

---

## 7. Sign-off template

| Role | Sign-off |
|------|----------|
| Product | IA + Home hierarchy approved |
| Eng | Engine/API untouched (diff review) |
| QA | BUTTON_VALIDATION runtime script pass |
| A11y/Perf | Lighthouse gates met |
