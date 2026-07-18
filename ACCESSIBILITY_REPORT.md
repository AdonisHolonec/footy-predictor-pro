# ACCESSIBILITY_REPORT.md
## Accessibility Audit — User UI (Baseline)

**Target:** WCAG 2.2 AA+ · keyboard · screen readers · contrast · touch.  
**Method:** Static ARIA/focus review of user components. Runtime axe/Lighthouse still required.

---

## 1. Strengths (already present)

| Area | Evidence |
|------|----------|
| Modal close | Escape, backdrop, ✕ with aria-label, focus restore (MatchModal) |
| Tabs | `role="tab"` / `aria-selected` on MatchModal |
| Nav current | `aria-current` on AppShell items |
| League search | `sr-only` label pattern |
| Button primitive | `focus-visible`, disabled+loading, 44px md size |
| Card keyboard | MatchCard Enter/Space |
| Themes | Including `theme-contrast` |

---

## 2. Gaps

| ID | Issue | Severity | Fix |
|----|-------|----------|-----|
| A1 | ★ / Share buttons ~36px | Medium | min 44×44 |
| A2 | Filter chips / mode toggles small | Medium | Touch + focus ring |
| A3 | Dual color systems → uneven contrast | Medium | Unify `--fp-*` |
| A4 | CommandPalette list lacking roving tabindex | Medium | Arrow-key navigation |
| A5 | History rows not interactive (OK) but Success Rate may lack button role if div | Low | Ensure button/role |
| A6 | Live score updates may not announce | Medium | `aria-live="polite"` on score |
| A7 | Loading Predict: ensure `aria-busy` on trigger | Low | Wire on Button |
| A8 | Charts (Feature Importance etc.) | Medium | Text alternative / aria labels |
| A9 | Modal tab strip: keyboard Left/Right | Medium | Implement tablist keys |
| A10 | Toast/alerts for share/export may be silent | Low | Live region |
| A11 | Landing decorative motion | Low | `prefers-reduced-motion` |
| A12 | Form errors: associate `aria-describedby` | Medium | Login + Profile |

---

## 3. Keyboard map (expected)

| Key | Context | Action |
|-----|---------|--------|
| Tab / Shift+Tab | Global | Focus order |
| Enter / Space | Cards, buttons | Activate |
| Escape | Modal / Palette | Close |
| ⌘K / Ctrl+K | Global | Open palette |
| Arrow L/R | Tablist (target) | Switch tabs |
| Arrow U/D | Palette (target) | Move selection |

---

## 4. Screen reader content priorities

1. Match: teams, kickoff, prediction, confidence, value  
2. Live: score + minute  
3. Errors: what failed + Retry  
4. Empty: why empty + next step  
5. Billing: clear price/tier before Stripe leave  

---

## 5. Contrast notes

- Dark theme with `#a1a1aa` on `#0a0a0b` generally AA for body; captions need spot-check.  
- Amber/warning on graphite: verify badge text.  
- Disabled states must not rely on color alone.  

---

## 6. Pre-ship a11y checklist

- [ ] Keyboard-only: Landing → Login → Home → Matches → Modal all tabs → Profile logout  
- [ ] VoiceOver/TalkBack: MatchCard + MatchModal Overview  
- [ ] Focus never trapped outside open modal  
- [ ] Contrast AA on Home KPIs and badges  
- [ ] Lighthouse Accessibility ≥95  
- [ ] `prefers-reduced-motion` respected  

---

## 7. Verdict

Solid foundations on modal/nav; **not yet AA+ product-wide**. V4 must treat a11y as a ship gate, not polish.
