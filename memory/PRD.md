# Footy Predictor Pro — Analiză & Corecții Flux Login/User/Admin

## Problem Statement (original)
> analizeaza proiectul si fluxul pentru a identifica erori si propune corectiile necesare

## Alegeri utilizator
- Analiză completă (backend + frontend + integrări)
- Aplică corecțiile automat
- Focus pe login/user/admin
- Rulare testare automată

## Codebase analizat
- Repo: https://github.com/AdonisHolonec/footy-predictor-pro.git
- Stack: Vite + React 18 + TypeScript + Supabase + Vercel serverless functions (Node 18+)
- Auth: Supabase (email+parolă + recovery), roluri user/admin via `profiles` + RLS, bootstrap admin via `ADMIN_EMAILS`
- Locație locală: `/app/footy-predictor-pro/` (cod sursă; nu rulează nativ în Emergent pentru că necesită Supabase + Vercel)

## Ce a fost validat (OK)
- ✅ 48/48 teste unitare (math, ELO, Poisson, Shin, izotonic, stacker, market rolling)
- ✅ TypeScript compilează curat (0 erori)
- ✅ Vite build reușit (`dist/` 642KB JS / 78KB CSS)
- ✅ Arhitectură auth corectă: RLS `auth.uid() = user_id`, trigger `handle_new_user_profile` SECURITY DEFINER, service-role pentru operații admin
- ✅ Self-lockout protection în `/api/admin` (admin nu se poate bloca/demota singur, minim un admin activ garantat)

## Bug-uri identificate și corectate

### 🔴 1. `src/hooks/useAuth.ts` (signup) — upsert `profiles` redundant și RLS-unsafe
- **Problemă**: După `supabase.auth.signUp()`, codul făcea `supabase.from("profiles").upsert(...)` — redundant (trigger DB `handle_new_user_profile` din migration 004 creează deja profilul cu SECURITY DEFINER, idempotent) și eșua silențios sub RLS când confirmarea email era ON (fără sesiune → `auth.uid()` nul → RLS respinge INSERT).
- **Fix**: Eliminat upsert-ul client-side. Trigger-ul DB face toată treaba.

### 🟠 2. `src/pages/Login.tsx` — hash `#type=recovery` nu era curățat
- **Problemă**: După detectarea recovery-ului și setarea `mode="reset"`, hash-ul rămânea în URL → la re-randare sau back-navigation, modul se re-seta la „reset" confuz.
- **Fix**: `window.history.replaceState` imediat după consumul hash-ului (consistent cu branch-ul `signup`).

### 🟠 3. `src/pages/Login.tsx` + `src/components/Auth.tsx` — forțare re-login după `updatePassword`
- **Problemă**: După reset de parolă, Supabase stabilește deja o sesiune activă, dar UI-ul forța `setMode("login")` → user-ul era cerut să se autentifice din nou.
- **Fix**: `Login.tsx` redirect direct la `/workspace`; `Auth.tsx` închide modalul (user e deja logged-in).

### 🟡 4. `api/fixtures.js` (handleDay catch) — lipsă logging
- **Problemă**: `catch (error) { ... "Eroare internă." }` fără `console.error` → imposibil de debug-uit în Vercel logs.
- **Fix**: Adăugat `console.error("[api/fixtures handleDay]", error?.message || error)`.

### 🟡 5. `src/pages/LandingAccess.tsx` — flash „Sign In" în timp ce auth loading
- **Problemă**: Header-ul arăta „Sign In" scurt timp înainte să devină „Open App" pentru user deja autentificat.
- **Fix**: Label „Checking..." în timpul `loading=true`, + `pointer-events-none opacity-60`.

### 🟢 6. `src/hooks/useAuth.ts` (`updateNotificationPreferences`) — stale closure + re-create
- **Problemă**: `user` în dep array-ul `useCallback`, folosit doar ca fallback în return → callback recreat la fiecare schimbare a user-ului (perf minor).
- **Fix**: Scos `user` din dep array; return `null` când nu sunt schimbări.

## Bug-uri minore observate (neaplicate, dar raportate)
- Typo intenționat `STORAGEE_KV_REST_API_URL` (dublu E) în `.env.example` și `anonymousRateLimit.js` — folosit de Vercel KV pe naming custom, lăsat nemodificat pentru compat.
- `useEffect` dep array cu `selectedDates` (array) în `App.tsx:525-533` — `useLocalStorageState` returnează referință stabilă, fără loop efectiv. OK.
- `window.innerWidth` în `useState` initial (SPA pur, nu SSR) — funcțional, fără hydration mismatch.
- `session.user` stale în `onAuthStateChange` async IIFE — posibil `setState on unmounted` warning, minor.

## Testare automatizată
- **Nu am putut rula end-to-end testing** prin Emergent testing_agent pentru că aplicația necesită:
  - Credențiale Supabase reale (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
  - Cheie API-Football (`APISPORTS_KEY` sau `X_RAPIDAPI_KEY`)
  - Vercel KV (opțional pentru rate limiting + tier counters)
  - `CRON_SECRET`, `ADMIN_EMAILS`, `RESEND_API_KEY` (opțional)
- **Ce am rulat cu succes local** în `/tmp/footy-predictor-pro/`:
  - `npm test` → 48/48 tests pass (inclusiv după fix-uri)
  - `npx tsc --noEmit` → 0 erori
  - `npx vite build` → 103 module transformed, build OK

## Next Action Items
- Pentru testare e2e completă: furnizează credențialele de mai sus (cel puțin Supabase + un cont admin test + un cont user test) și rulez testing_agent pentru validare flows login → signup → password reset → admin CRUD pe profiles → user predict/warm cu cote.
- Consideră să adaugi `--fix` la ESLint și să activezi `strict: true` în `tsconfig.json` pentru detecție mai agresivă a bug-urilor de tipare.
- Cache localStorage vechi la user: după fix-urile din tier-masking, ar putea fi util să adaugi un versioning key (`footy.cacheVersion`) care invalidează predictionsByUser când se schimbă forma datelor.
