# Design System V3 — Footy Predictor Pro

**Codename:** Signal Atelier v3  
**Constraint:** Evolve existing `signal.*` / `lab-*` tokens — do not invent a second parallel system overnight.  
**Modes:** Dark (default) · Light · High contrast

---

## 1. Brand posture

Premium sports intelligence — **calm, precise, athletic**.  
Not neon betting. Not purple AI cliché. Not newspaper clutter.

**Voice of UI:** short labels, mono for metrics, display for match names only.

---

## 2. Color palette

### 2.1 Core (map to CSS variables)

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--bg` | `#0B0F14` | `#F4F6F8` | Page |
| `--bg-elevated` | `#121821` | `#FFFFFF` | Cards |
| `--bg-muted` | `#1C2633` | `#E8EEF4` | Wells / filters |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(15,23,42,0.08)` | Hairlines |
| `--text` | `#E8EEF4` | `#0F172A` | Primary |
| `--text-muted` | `#8B9BB0` | `#64748B` | Secondary |
| `--text-faint` | `#5C6B7A` | `#94A3B8` | Meta |

### 2.2 Accents (≤3 chromatic)

| Token | Hex | Usage |
|-------|-----|-------|
| `--accent` | `#5EC4B6` (petrol/mint) | Primary CTA, focus, links |
| `--accent-2` | `#E0B46A` (amber) | Value / EV / warning soft |
| `--danger` | `#E07A7A` | Loss / error |
| `--success` | `#6FCF97` | Win / healthy |
| `--info` | `#6A9BB8` | Live / info |

**Rule:** One accent per view region. Never rainbow chips.

### 2.3 Semantic badges

| State | BG / Text |
|-------|---------|
| LIVE | info / white |
| WIN | success muted |
| LOSE | danger muted |
| VALUE | amber muted |
| SAFE | accent muted |
| LOCKED | muted / faint |
| OPEN | border only |

### 2.4 Compatibility with today

Keep Tailwind `signal.*` names; remap internals:

```
signal.void → --bg
signal.panel → --bg-elevated
signal.petrol → --accent
signal.amber → --accent-2
```

---

## 3. Typography

| Role | Family | Size / weight | Notes |
|------|--------|---------------|-------|
| Display | Sora | 28–40 / 600 | Match titles sparingly |
| Title | Sora | 20–24 / 600 | Section headers |
| Body | Plus Jakarta Sans | 14–16 / 400–500 | UI copy |
| Label | Plus Jakarta Sans | 11–12 / 600 | Uppercase tracking optional |
| Metric | JetBrains Mono | 12–18 / 500 | Probabilities, KPIs |
| Micro | JetBrains Mono | 10 / 500 | Badges |

**Line length:** body ≤ 68ch. Cards: 1 title + 1 meta line max above fold.

---

## 4. Spacing scale

```
0  2  4  8  12  16  24  32  40  48  64  96
```

| Token | px | Use |
|-------|-----|-----|
| `space-1` | 4 | Icon gaps |
| `space-2` | 8 | Chip padding |
| `space-3` | 12 | Dense lists |
| `space-4` | 16 | Card inner |
| `space-5` | 24 | Card sections |
| `space-6` | 32 | Between cards |
| `space-8` | 48 | Section breaks |
| `space-10` | 64 | Page padding desktop |

**Layout grid:** 12-col desktop · 8-col tablet · 4-col mobile. Gutter 24 / 16 / 12.

---

## 5. Radius & elevation

| Token | Value |
|-------|-------|
| `radius-sm` | 8px |
| `radius-md` | 12px |
| `radius-lg` | 16px |
| `radius-xl` | 24px |
| `radius-pill` | 999px |

| Elevation | Shadow |
|-----------|--------|
| `e0` | none |
| `e1` | `0 1px 2px rgba(0,0,0,.24)` |
| `e2` | `0 8px 24px rgba(0,0,0,.28)` (modals) |

Prefer **border + bg** over heavy glass. Soften existing `.lab-glass`.

---

## 6. Iconography

- Style: 1.5px stroke, 24px grid, rounded joins (Lucide or equivalent).  
- Semantic set: kickoff, trophy, chart, shield, bolt (value), lock, star, live, search, command, bell, moon/sun.  
- Never emoji in product chrome.

---

## 7. Motion

| Token | ms | Easing |
|-------|-----|--------|
| `fast` | 120 | ease-out |
| `base` | 200 | cubic-bezier(0.2, 0.8, 0.2, 1) |
| `slow` | 320 | same |

**Use for:** tab underline, drawer enter, chart draw, skeleton shimmer.  
**Avoid:** parallax, continuous pulse on KPIs, page-wide fades.

`prefers-reduced-motion: reduce` → disable non-essential motion.

---

## 8. Themes

### Dark (default)
Current sports-lab DNA preserved.

### Light
Elevated white cards on cool gray bg; accent unchanged; borders stronger.

### High contrast
`--text` pure white/black; borders 2px; badges solid; focus ring 3px accent.

**Toggle:** Settings + header control; persist `localStorage.theme`.

---

## 9. Accessibility (WCAG AA)

- Contrast ≥ 4.5:1 body, ≥ 3:1 large.  
- Focus visible: 2px accent ring, offset 2.  
- Hit targets ≥ 44×44.  
- Keyboard: tab order = visual; Esc closes modal; arrows in tabs.  
- `aria-label` on icon buttons; live region for predict status.  
- Charts: pattern + color; table fallback for MC/backtest.

---

## 10. Component token recipes (summary)

| Component | Recipe |
|-----------|--------|
| Button primary | bg accent · text void · radius-md · h-10 |
| Button ghost | border · text · hover bg-muted |
| Card | bg-elevated · border · radius-lg · p-4/5 · e1 |
| Badge | radius-pill · mono 10 · px-2 py-0.5 |
| Input | h-10 · radius-md · border · bg-muted |
| Table | mono metrics · zebra muted · sticky header |
| Alert | left accent bar · soft bg |
| Dialog | e2 · radius-xl · max-w-lg · focus trap |

Full specs → `COMPONENT_LIBRARY.md`.

---

## 11. Data visualization rules

1. **One message per chart.**  
2. Max **2** series in default view.  
3. Tooltip on hover/focus; no permanent clutter.  
4. Empty state illustration + CTA, not blank axes.  
5. Contribution bars: shared scale 0–max; label left, value right.  
6. MC: density/histogram preferred over raw tables (table in “Data” disclosure).  
7. Colorblind-safe: accent vs amber vs gray — never red/green alone.

---

## 12. Migration of tokens

| Step | Action |
|------|--------|
| 1 | Add CSS variables in `index.css` mirroring table §2 |
| 2 | Alias `signal.*` Tailwind colors to variables |
| 3 | Introduce `.theme-light` / `.theme-contrast` on `<html>` |
| 4 | Replace one-off hex in components gradually |
| 5 | Document forbidden colors (purple glow, cream-terracotta kitsch) |

---

## 13. Do / Don’t

| Do | Don’t |
|----|-------|
| Airy section gaps (32–48) | Stack 8 KPI cards |
| One primary CTA per region | Equal-weight rainbow buttons |
| Truncate with expand | Walls of explanation on cards |
| Skeleton on predict | Layout jump |
| Sticky filters | Filters buried in modal only |
