# RESPONSIVE_REPORT.md
## Responsive Audit — User UI (Baseline)

**Method:** Static layout analysis of AppShell, filters, MatchCard, MatchModal, Landing.  
**Targets:** Mobile · Tablet · Laptop · Desktop · Large monitor.  
**Rule:** No horizontal scroll; touch ≥44px.

---

## 1. Breakpoint model (current)

| Band | Approx | Behavior |
|------|--------|----------|
| Mobile | &lt;768px | Bottom tabs (5), top: search / notif / predict |
| Tablet | 768–1023 | Sidebar may appear; dense filters |
| Laptop | 1024–1439 | Sidebar + content |
| Desktop / Large | ≥1440 | Wider content; no special max-width discipline everywhere |

Tokens: `--fp-touch: 44px` defined but not applied on all controls.

---

## 2. Surface-by-surface

| Surface | Mobile | Tablet | Desktop | Issues |
|---------|--------|--------|---------|--------|
| Landing | Stacked CTAs | OK | Wide hero | Risk of dense pricing rows |
| Login | Form + stats stack | OK | Split layout | Mode toggles small |
| AppShell | Bottom tabs + top bar | Sidebar | Sidebar | Notifications not in bottom tabs (by design) |
| HomeSection | Cards stack | 2-col opportunities | Multi-col | Above-fold may push Best Value below fold on short phones |
| StickyFilterBar | Horizontal overflow risk | Wrap | Row | Search + chips may force scroll-x |
| LeaguePanel | Full-width accordion | Side/overlay | Open by default desktop | Long lists OK |
| MatchCard | Compact | Grid 2 | Grid 3+ | ★/Share 36px |
| MatchModal | Full-screen sheet-like | Centered | Large dialog | Tab strip overflow |
| History/Stats | Stack | OK | OK | Tables may need horizontal scroll |
| CommandPalette | Full width | Centered | Centered | Keyboard OK |
| Profile billing | Stack buttons | OK | OK | Stripe CTAs OK |

---

## 3. Horizontal scroll risks

1. StickyFilterBar chip row on 320–375px  
2. MatchModal tab list (10 tabs)  
3. Odds / market tables inside modal  
4. Admin panels (out of scope)  

**V4 fix:** `overflow-x-auto` with fade + snap; never `overflow-x: hidden` that clips focus.

---

## 4. Large monitor (≥1600px)

| Issue | Recommendation |
|-------|----------------|
| Content may stretch too wide | Max content width ~1280–1440px centered |
| Match grid too many columns | Cap at 3–4 columns |
| Home opportunities sparse | Constrain hero column |

---

## 5. Orientation / safe areas

| Item | Status |
|------|--------|
| iOS bottom safe area for tabs | Verify `env(safe-area-inset-bottom)` |
| Landscape phone | Modal height + filter bar crowding |
| Keyboard open (search) | Palette should remain usable |

---

## 6. Responsive QA checklist (pre-ship)

- [ ] 320 / 375 / 390 / 414 widths — no page-level horizontal scroll  
- [ ] 768 / 1024 / 1280 / 1440 / 1920 — layout intact  
- [ ] Bottom tabs reachable with thumb; not covered by browser chrome  
- [ ] MatchModal tabs scrollable; all tabs activatable  
- [ ] Predict loading state visible on mobile top bar  
- [ ] Landing pricing CTAs stack without overflow  
- [ ] Landscape: modal close still reachable  

---

## 7. Verdict

**Baseline:** Functional responsive shell exists (AppShell + filter bar).  
**Not yet premium:** filter overflow, modal tabs, &lt;44px hits, Home fold on short devices, large-monitor width discipline.  
These are V4 UI tasks only.
