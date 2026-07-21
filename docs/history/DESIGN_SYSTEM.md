# DESIGN_SYSTEM.md
## Footy Predictor Pro — UX V4 Design System Spec

**Status:** Spec for V4 implementation (tokens partially exist in `src/design-system/`).  
**Constraint:** Visual/system only — no engine/API/auth changes.

---

## 1. Principles

1. **Dark-first** — almost black canvas, graphite cards, subtle borders  
2. **One accent** — Electric Blue for primary actions only  
3. **8pt spacing** — no arbitrary gaps  
4. **One card language** — shared radius, padding, elevation, hover  
5. **Bettor language** — hide lab/pipeline jargon from user surfaces  
6. **Motion subtle** — ≤200ms ease; no decorative gradient noise  

---

## 2. Color (V4 target)

| Token | Role | Hex / value |
|-------|------|-------------|
| `--fp-bg` | Background | `#0a0a0b` (Almost black) |
| `--fp-bg-card` | Cards (Graphite) | `#1a1a1e` |
| `--fp-bg-elevated` | Elevated surfaces | `#141416` |
| `--fp-border` | Subtle border | `rgba(255,255,255,0.08)` |
| `--fp-accent` | Primary / Electric Blue | `#1d6bff` *(shipped)* |
| `--fp-navy` | Deep Navy (brand) | `#0B1F3A` *(shipped)* |
| `--fp-success` | Emerald | `#22c55e` |
| `--fp-warning` | Amber | `#f59e0b` |
| `--fp-danger` | Red | `#ef4444` |
| `--fp-text` | Primary text | `#f4f4f5` |
| `--fp-text-muted` | Secondary | `#a1a1aa` |

**Light / contrast themes:** already bridged in `tokens.css` (`html.theme-light`, `html.theme-contrast`).

**Migration risk:** MatchCard / MatchModal / Landing still use Tailwind `signal-*`. V4 must migrate user surfaces to `--fp-*` only.

**Gradients:** avoid unless conveying live pulse or scoreboard identity. Prefer flat + border.

---

## 3. Typography scale

| Role | Token | Size | Weight | Use |
|------|-------|------|--------|-----|
| Hero | `--fp-hero` | clamp 1.75–2.25rem | 700 | Home “Today’s opportunities” |
| Section | `--fp-section` | 1.25rem | 600 | Section headers |
| Card title | `--fp-card-title` | 1rem | 600 | Match/teams |
| Body | `--fp-body` | 0.875rem | 400 | Copy |
| Caption | `--fp-caption` | 0.75rem | 500 | Kickoff, league |
| Badge | `--fp-badge` | 0.625rem | 700 | Value / Live |
| Numbers | *(add)* `--fp-num` | tabular-nums | 600–700 | Odds, %, confidence |

**Font:** keep existing display + body stack from app; do not introduce Inter/Roboto as new default if brand fonts exist.

---

## 4. Spacing (8pt)

| Token | Value |
|-------|-------|
| `--fp-space-1` | 4px |
| `--fp-space-2` | 8px |
| `--fp-space-3` | 12px |
| `--fp-space-4` | 16px |
| `--fp-space-5` | 24px |
| `--fp-space-6` | 32px |
| `--fp-space-7` | 40px |
| `--fp-space-8` | 48px |

**Card padding:** 16px mobile / 16–24px desktop.  
**Section gap:** 24–32px.  
**Touch target:** `--fp-touch: 44px` minimum.

---

## 5. Radius & elevation

| Token | Value | Use |
|-------|-------|-----|
| `--fp-radius-sm` | 8px | Chips, badges |
| `--fp-radius` | 12px | Cards, inputs |
| `--fp-radius-lg` | 16px | Modals, hero blocks |

**Elevation:** border + slight bg lift on hover (`--fp-bg-elevated`), not multi-layer shadows.  
**Hover:** border strengthen + 180ms transition (`--fp-ease`).  
**Press:** scale `0.98` on buttons only.

---

## 6. Components (canonical)

| Primitive | File | States |
|-----------|------|--------|
| Button | `Button.tsx` | primary / secondary / ghost / danger · loading · disabled · focus-visible |
| Card | `Card.tsx` | default · interactive hover |
| Badge | `Badge.tsx` | success / warning / danger / accent / muted |
| Skeleton | `Skeleton.tsx` | pulse for lists/cards |

**V4 additions needed:** Input, Select, Tabs, EmptyState, ErrorState, Toast, MatchCard (ds), Modal shell.

---

## 7. Terminology (user-facing)

| Internal / current | User-facing |
|--------------------|-------------|
| Prediction Laboratory | Prediction Analysis |
| Feature Importance | Key Factors *(already used in chart)* |
| Prediction Contributions | Why This Prediction *(already used)* |
| Confidence Engine | Confidence |
| Recommendation Engine | Top Pick |
| Value Engine | Best Value |
| Raw Probability | Initial Probability |
| Calibrated Probability | Final Probability |
| Model Lab | Prediction Models |
| Pipeline | Prediction Process |
| Model Insights | Prediction Analysis *(or keep Insights if clearer)* |

Admin observatory may keep technical labels.

---

## 8. Iconography

- Single stroke set (current SVG/inline)  
- Size: 16 / 20 / 24  
- Live: emerald pulse (subtle opacity, not glow spam)  
- Value badge: amber/emerald depending on EV sign  

---

## 9. Do / Don’t

**Do:** dark navy + electric blue accent; compact match cards; tabbed detail; persistent filters.  
**Don’t:** purple themes; cream+serif AI cliché; card-in-card nesting; endless scroll detail pages; engine jargon on Home.
