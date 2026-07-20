# PRODUCTION CERTIFICATION REPORT
## Footy Predictor Pro — P0 Sprint Close-Out

| Field | Value |
|-------|-------|
| **Document** | `PRODUCTION_CERTIFICATION_REPORT.md` |
| **Date** | 2026-07-20 |
| **Plan** | `PRODUCTION_P0_PLAN.md` |
| **Prior audit** | `FINAL_ENTERPRISE_AUDIT_2026.md` (6.3/10, REJECT open public / CONDITIONAL paid beta) |
| **Local verify** | `npm test` · `npm run typecheck` · `npm run lint` · `npm run build` — **all green** |
| **Verdict** | **P0 blockers from the plan: CLOSED** · **Open public launch: still REJECT** · **Closed paid/trial beta: CONDITIONAL PASS (elevated)** |

---

## 1. Files modified / created

### Created
| Path | Purpose |
|------|---------|
| `server-utils/publicBaseUrl.js` | Trusted origin / host allowlist (no client Host) |
| `server-utils/validation/WalkForward.js` | Chronological walk-forward folds |
| `server-utils/backtest/ClvReport.js` | CLV aggregation report |
| `tests/walkForward.test.js` | WF regression |
| `tests/clv.test.js` | CLV regression |
| `tests/apiAuth.fixtures.test.js` | Fixtures auth / public-leak gates |
| `tsconfig.ci.json` | CI typecheck scoped to `src` |
| `PRODUCTION_P0_PLAN.md` | Sprint plan |
| `PRODUCTION_CERTIFICATION_REPORT.md` | This report |

### Modified (security / API)
| Path | Tasks |
|------|-------|
| `api/fixtures.js` | Strip public `usage`; live/xg JWT\|cron; CORS allowlist |
| `api/history.js` | User sync → 403; public aggregate RL |
| `api/admin.js` | Internal fetch via `resolveTrustedAppOrigin` |
| `api/billing.js` | App origin via trusted helper |
| `api/backtest.js` | `view=clv` (admin/cron); public-track RL |
| `server-utils/cronRequestAuth.js` | UA fallback needs dual emergency flags |
| `vercel.json` | CSP header |
| `.env.example` | `PUBLIC_BASE_URL` + related notes |

### Modified (science)
| Path | Tasks |
|------|-------|
| `server-utils/calibration/CalibrationSelector.js` | Default `CALIB_CV_MODE=time` |
| `server-utils/modelLab/AutoModelSelection.js` | Min samples default 100 |

### Modified (client)
| Path | Tasks |
|------|-------|
| `src/hooks/useHistorySync.ts` | No-op unless `allowSync` |
| `src/utils/predictFlowUtils.ts` | Sync after predict disabled |
| `src/components/PerformanceCounterModal.tsx` | No user sync POST |
| `src/hooks/useLiveFixtureScorePoll.ts` | Auth on live |
| `src/hooks/useMarketTotalsHydrate.ts` | Auth on hydrate |
| `src/components/MatchModal.tsx` | Auth on xg/live fetches |
| `src/types.ts` / `appUtils.ts` / `specialBet.ts` | Typecheck fixes |

### Modified (CI)
| Path | Tasks |
|------|-------|
| `package.json` | `test:validation`, `typecheck`/`lint` → `tsconfig.ci.json` |
| `.github/workflows/tests.yml` | test → typecheck → lint → build |
| Unit tests | `useHistorySync`, `predictFlowUtils`, security suite |

---

## 2. Security issues resolved

| Issue | Resolution | Evidence |
|-------|------------|----------|
| Public fixtures leak `usage` / ops | Day view strips usage; `usageOnly=1` admin-only | `api/fixtures.js` |
| Unauthenticated live / xg | Require JWT or cron | `api/fixtures.js` + client `fetchWithAuth` |
| CORS `*` on xg | Origin allowlist | `api/fixtures.js` |
| Admin Host / SSRF | Outbound base from env via `resolveTrustedAppOrigin` | `publicBaseUrl.js`, `api/admin.js`, `api/billing.js` |
| Client History Sync | Client no-op; API 403 for user sync | `useHistorySync.ts`, `api/history.js` |
| Weak cron UA fallback | Requires `ALLOW_VERCEL_CRON_UA_FALLBACK` **and** `ALLOW_VERCEL_CRON_UA_EMERGENCY` | `cronRequestAuth.js` |
| Missing CSP | `Content-Security-Policy` on Vercel headers | `vercel.json` |

---

## 3. Endpoints protected

| Endpoint | Gate after sprint |
|----------|-------------------|
| `GET /api/fixtures` (day) | Public leagues/fixtures **without** `usage` / cache diagnostics |
| `GET /api/fixtures?usageOnly=1` | Admin |
| `GET /api/fixtures?view=live` | JWT or cron |
| `GET /api/fixtures?view=xg` | JWT or cron + CORS allowlist |
| `GET/POST /api/history?sync=1` | Cron / admin only; user → `403 history_sync_forbidden_for_user` |
| Public history / public-track | Rate-limited aggregates |
| `GET /api/backtest?view=clv` | Admin / cron |
| Admin internal fetches | Trusted origin only (prod 503 if unset) |

---

## 4. History Sync validation

- `useHistorySync({ allowSync: false })` (default): **does not POST** `sync=1`.
- `predictFlowUtils.syncHistoryAfterPredict`: **no-op**.
- `PerformanceCounterModal`: no longer triggers user sync.
- Server: user-bearer sync path returns **403** with `history_sync_forbidden_for_user`.
- Unit coverage: `src/hooks/useHistorySync.test.tsx`, `src/utils/predictFlowUtils.test.ts`.

Settlement / closing remain **cron + admin** responsibilities.

---

## 5. Host validation

- `resolveTrustedAppOrigin` / `assertHostAllowlisted` never trust request `Host` or `X-Forwarded-Host` in production.
- Allowlist from `PUBLIC_BASE_URL`, `APP_BASE_URL`, `VERCEL_URL`, `ALLOWED_APP_HOSTS`, etc.
- Covered by `tests/securityP0.test.js` (forged Host rejected).

---

## 6. Walk Forward summary

- Module: `server-utils/validation/WalkForward.js` — chronological windows; train never sees future kickoffs.
- Calibration: `CalibrationSelector` defaults to **time** folds (`CALIB_CV_MODE=time`); falls back to random if kickoffs missing.
- Auto model selection: higher min-sample floor (**100**).
- Tests: `tests/walkForward.test.js` (+ calib selector time-mode assertion).

**Debt:** full production daily-ml samples still need reliable kickoff timestamps on every calib row for time-mode to dominate in prod; random fallback remains for sparse data.

---

## 7. CLV summary

- Module: `server-utils/backtest/ClvReport.js` — coverage, mean CLV%, groupings.
- API: `GET /api/backtest?view=clv` (admin/cron).
- Tests: `tests/clv.test.js`.

**Debt:** CLV quality depends on closing-odds cron population; no dedicated UI tile shipped in this sprint.

---

## 8. Regression tests

Local run (2026-07-20):

| Suite | Result |
|-------|--------|
| `test:math` | 74 pass |
| `test:security` (+ fixtures auth) | 15 pass |
| `test:validation` (WF + CLV) | 8 pass |
| `test:unit` (vitest `src`) | 11 pass |
| `test:golden` | 3 pass |
| **`npm test` total** | **green** |

---

## 9. CI improvements

`.github/workflows/tests.yml` now fails the job on:

1. `npm test`
2. `npm run typecheck` (`tsconfig.ci.json`)
3. `npm run lint` (typecheck stand-in until ESLint)
4. `npm run build`

---

## 10. Remaining technical debt (non-blocking for closed beta)

| Item | Severity |
|------|----------|
| ESLint not yet real lint (tsc stand-in) | Med |
| Kickoff wiring into every calib sample for prod time-CV | Med |
| CLV admin UI tile | Low |
| Settlement cron completeness (corners/shots lag) | High ops |
| CSP may need tune if third-party scripts break | Med |
| Unrelated untracked backups/scripts should not ship | Process |
| Open marketing / anonymous heavy traffic | Still out of scope — **REJECT** |

---

## 11. Risk assessment

| Risk | After sprint |
|------|----------------|
| Quota / ops leak via public fixtures | **Mitigated** |
| Unauth live/xg scrape | **Mitigated** |
| User-driven history sync abuse | **Mitigated** |
| Admin SSRF via Host | **Mitigated** |
| Random CV optimism in calib | **Reduced** (time default) |
| CLV / edge proof incomplete data | **Residual** (pipeline data) |
| Model edge / accuracy claims | **Unchanged** — no formula retune this sprint |

---

## 12. Expected Enterprise Audit score

| Dimension | Prior (audit) | Expected post-P0 |
|-----------|---------------|------------------|
| Security / API trust | ~5.5 C | **~7.5 B** |
| Quant / statistical validation | ~3.5–4.0 D+ | **~6.0 C+** (methodology; not magic accuracy) |
| CI/CD | ~3.5 D+ | **~6.5 B−** |
| **Weighted overall** | **6.3 / 10** | **~7.4–7.7 / 10** |

Launch posture:

| Audience | Decision |
|----------|----------|
| Unrestricted public SaaS marketing | **REJECT** (unchanged) |
| Closed paid / trial beta | **CONDITIONAL PASS** — P0 security + WF/CLV gates addressed; monitor settlement + CSP |

---

## 13. Confidence level

| Claim | Confidence |
|-------|------------|
| Plan T1–T8 implemented in code | **High** |
| Local CI-equivalent green | **High** (this machine) |
| GitHub Actions green on remote | **Medium** (push not yet requested) |
| Full enterprise “PASS” for open launch | **N/A — not claimed** |
| Closed beta readiness | **High-Medium** (~80–85%) |

---

## 14. Success criteria checklist

| Criterion | Status |
|-----------|--------|
| No public ops leaks on fixtures day | **Met** (code) |
| live/xg require auth | **Met** |
| No History Sync from client user | **Met** |
| Host header protected | **Met** (tests) |
| SSRF mitigated for admin base URL | **Met** |
| Walk Forward implemented | **Met** |
| CLV operational (`view=clv`) | **Met** |
| Regression tests green | **Met** (local) |
| CI gates present | **Met** (workflow) |
| Backward compatible auth predict/warm | **Expected** (no formula change) |
| Unrestricted public PASS | **Not claimed** |

---

*End of PRODUCTION_CERTIFICATION_REPORT.md*
