---
name: Footy Predictor Pro
description: A serious bettor's ledger for match predictions — warm paper, one disciplined ember accent, and plain-spoken win/loss/value states.
colors:
  primary: "#ec3013"
  primary-hover: "#dd2b0f"
  primary-muted: "rgba(236, 48, 19, 0.12)"
  win-green: "#157a4a"
  loss-wine: "#9d174d"
  value-amber: "#b45309"
  chart-violet: "#7c3aed"
  paper: "#f3f2f2"
  paper-elevated: "#eae9e9"
  surface-card: "#ffffff"
  paper-muted: "#eae7e7"
  ink: "#201e1d"
  ink-muted: "#605d5d"
  ink-faint: "#7d7979"
  line: "rgba(32, 30, 29, 0.12)"
  line-strong: "rgba(32, 30, 29, 0.24)"
  scrim: "#201e1d"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 2.5vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.08em"
rounded:
  sm: "10px"
  md: "16px"
  lg: "20px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
  7: "40px"
  8: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  button-ghost:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  button-danger:
    backgroundColor: "rgba(157, 23, 77, 0.15)"
    textColor: "{colors.loss-wine}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.md}"
    padding: "16px"
  badge:
    rounded: "9999px"
    padding: "2px 8px"
    typography: "{typography.label}"
---

# Design System: Footy Predictor Pro

## Overview

**Creative North Star: "The Sharp's Ledger"**

Footy Predictor Pro is built like a serious bettor's private tracking sheet, not a tipster's billboard. Warm paper tones carry the surface; one disciplined ember-red accent is spent sparingly on the things that deserve attention (the pick headline, the primary action, the active nav item); three independent semantic inks — win-green, loss-wine, value-amber — carry outcome and edge information without borrowing the brand accent's weight. Nothing shouts. The interface states a probability, a result, or an edge plainly and gets out of the way; accuracy history and a calm presentation are what earn trust, not confident-sounding copy or decorative flourish.

The voice is confident and unembellished: no exclamation-point energy, no "guaranteed" language, no gamified flourish. This is explicitly not a flashy tipster-site look — restraint is the differentiator from that category, in the same way live in-match intelligence is the product differentiator.

**Key Characteristics:**
- Warm neutral paper background, not stark white or cool gray — the surface itself feels like a physical ledger page.
- A single brand accent (ember red-orange in light mode, shifting to green in dark mode) used only for signal: primary actions, the active nav state, the pick headline's emphasis.
- Three semantic inks (win-green, loss-wine, value-amber) are structurally independent from the brand accent — a loss is never rendered in the same hue as the brand, and a value-bet callout is never confused with a generic warning.
- Structural, flat-by-default elevation: shadows are nearly invisible at rest and deepen only on hover, focus, or true stacking (modals).
- One typeface family (Archivo) carries both display and body text through weight and size alone, with JetBrains Mono reserved for numeric/label contexts (odds, stats, badges) — a ledger's columnar precision, not a second decorative face.

## Colors

The palette reads as a warm paper ledger: neutral warm grays for surface and structure, one ember accent for action, three independent inks for outcome.

### Primary
- **Signal Ember** (`#ec3013`): The single brand accent. Used only for primary CTAs, the active navigation state, focus rings, and the recommended-pick headline's emphasis glow. In dark theme this hue shifts to a green (`#1fae6b`) — the accent's *role* (signal/action) is the invariant, not its literal hue.
- **Signal Ember, Hover** (`#dd2b0f`): Pressed/hover state for primary actions.
- **Signal Ember, Muted** (`rgba(236, 48, 19, 0.12)`): Active-state backgrounds (selected nav item, highlighted chip) where a full-strength fill would be too loud.

### Secondary (semantic, not decorative)
- **Win Green** (`#157a4a`): A settled prediction that hit. Success states, "win" chips, positive stat tiles.
- **Loss Wine** (`#9d174d`): A settled prediction that missed. Deliberately a muted wine/maroon, not a bright alarm red — losses are reported matter-of-factly, not punished visually.
- **Value Amber** (`#b45309`): A detected value bet / positive-EV signal. Distinct from both the brand accent and from warning-as-error — amber here means "an edge exists," not "something is wrong."

### Tertiary
- **Chart Violet** (`#7c3aed`): Reserved for analytics/backtest chart series (`AnalyticsCharts`, `BacktestCharts`, `HealthDashboard`) where a fourth hue is needed to distinguish a data series from the semantic three. Not used in product chrome or CTAs.

### Neutral
- **Paper** (`#f3f2f2`): Base app background — the ledger page itself.
- **Paper, Elevated** (`#eae9e9`): Sidebar/shell surfaces that sit one level above the base page.
- **Surface Card** (`#ffffff`): Card and panel fills — the brightest neutral, reserved for content containers.
- **Paper, Muted** (`#eae7e7`): Recessed surfaces (track behind a probability bar, skeleton loading fill).
- **Ink** (`#201e1d`): Primary text and the modal scrim color (`scrim`, at reduced opacity).
- **Ink, Muted** (`#605d5d`): Secondary text, inactive nav labels.
- **Ink, Faint** (`#7d7979`): Tertiary/caption text.
- **Line** (`rgba(32, 30, 29, 0.12)`) / **Line, Strong** (`rgba(32, 30, 29, 0.24)`): Card borders and dividers; the strong variant is for hover/focus emphasis only, never a resting state.

### Named Rules
**The One Accent Rule.** Signal Ember appears on primary actions, the active nav item, and the pick headline's emphasis only — never as a background fill for informational content, and never for a settled win/loss outcome (those belong to Win Green / Loss Wine).

**The Independent Ink Rule.** Win Green, Loss Wine, and Value Amber never borrow each other's role. A value-bet callout is not a "warning," and a loss is not rendered as if it were an error state — each ink reports exactly one kind of fact.

## Typography

**Display Font:** Archivo (with system-ui, sans-serif fallback)
**Body Font:** Archivo (same family)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, monospace fallback)

**Character:** A single grotesque (Archivo) carries the entire hierarchy through weight and size rather than a display/body pairing — deliberate, ledger-like columnar consistency rather than typographic flourish. JetBrains Mono is reserved for anything numeric or tabular (odds, confidence percentages, stat values, badges), so figures always align and read as data, not prose.

### Hierarchy
- **Display** (700, `clamp(1.75rem, 2.5vw, 2.25rem)`, 1.1 line-height): Page-level headings and the recommended-pick headline (`font-display text-xl sm:text-2xl font-bold`).
- **Section** (600, 1.25rem): Section headers within a page.
- **Card Title** (600, 1.05rem): Card/panel headings (team names, modal titles).
- **Body** (400, 0.9375rem, 1.5 line-height): Default running text and stat descriptions.
- **Caption** (400, 0.75rem): Secondary metadata, timestamps, helper text.
- **Label** (600, 0.6875rem, 0.08em tracking, uppercase, JetBrains Mono): Badges, status chips, section eyebrows.
- **Numeric** (600, 1.25rem, tabular-nums): Stat tile values, odds, confidence figures — always JetBrains Mono or `tabular-nums` so columns of numbers align.

### Named Rules
**The Tabular Numbers Rule.** Any figure a user compares against another figure (odds, probabilities, stat values) renders with `tabular-nums` or JetBrains Mono — never proportional digits, which drift out of alignment in a column.

## Layout

An 8pt spacing scale (4 / 8 / 12 / 16 / 24 / 32 / 40 / 48px) governs rhythm, though components today mostly reach for raw Tailwind spacing utilities that land on the same values rather than referencing the scale's CSS variables directly — the scale is the intended system of record going forward. Desktop uses a fixed 240px left sidebar (`AppShell`) with content flowing right; mobile collapses to a sticky top header plus a fixed bottom tab bar showing a 5-item subset of navigation, with a 44px (`--fp-touch`) minimum touch target enforced on every interactive control. Cards default to `16px` internal padding (`14px` on the smallest mobile breakpoint), with `12px` for compact/inline cards and `24–32px` for larger panels and modals.

## Elevation & Depth

Structural, flat-by-default. Surfaces sit essentially flat at rest — the resting shadow is a near-invisible 1–2px hint of separation — and depth appears only in response to interaction or true stacking: a card's shadow deepens on hover alongside a small upward lift, and a modal gets the heaviest shadow in the system because it's genuinely floating above the page. Depth is earned by state, not applied ambiently.

### Shadow Vocabulary
- **Resting** (`0 1px 2px rgba(45, 43, 43, 0.14)`): Default card/panel elevation. Nearly imperceptible — the point is restraint, not to suggest a physically raised sheet.
- **Hover** (`0 3px 10px rgba(45, 43, 43, 0.16)`): Card hover state, paired with a `-2px` lift and an ember-tinted border at 25% opacity.
- **Modal** (`0 12px 32px rgba(45, 43, 43, 0.22)`): Reserved for genuinely floating surfaces — match detail modal, command palette — never for in-flow cards.

### Named Rules
**The Earned Depth Rule.** A shadow deeper than Resting must be justified by an actual interaction state (hover, focus) or genuine z-stacking (modal, dropdown) — never applied to a resting in-flow element just for visual richness.

## Shapes

Three-step radius scale, all soft-cornered, no sharp edges anywhere in the system: `10px` for compact interactive controls (buttons, nav items, small chips, skeletons), `16px` for the default content container (cards, stat tiles, the match card), and `20px` for genuinely large floating surfaces (the match-detail modal, the command palette). Avatars, badges, and probability-bar tracks are fully circular (`rounded-full`). Borders are hairline (`1px`) and low-contrast at rest (`Line`, 12% opacity), strengthening only on hover/focus (`Line, Strong`, 24%).

### Named Rules
**The Three-Step Rule.** Every rounded surface uses exactly one of 10 / 16 / 20px — never an ad-hoc radius value picked to "feel right" for one component.

## Components

Buttons and cards feel precise and restrained: small, deliberate feedback (a subtle press scale, a modest border/shadow shift) rather than anything bouncy or playful — a tool for serious bettors, not a game.

### Buttons
- **Shape:** 10px radius (`rounded-sm` token), 44px minimum height on the default size — every button is a full touch target regardless of visual density.
- **Primary:** Signal Ember fill, white text, hover darkens to Signal Ember Hover; press state scales to 98%.
- **Secondary:** Card-surface fill with a hairline border, text in Ink; hover strengthens the border and shifts to Paper Muted.
- **Ghost:** No fill or border at rest; text in Ink Muted, hover fills Paper Muted and text darkens to Ink.
- **Danger:** Loss Wine at 15% opacity fill with Loss Wine text; hover/press step up in opacity rather than changing hue.
- All variants share the same focus-visible treatment: a 2px Signal Ember outline, 2px offset.

### Badges
- **Style:** Fully pill-shaped (`rounded-full`), hairline border, JetBrains Mono label type (0.6875rem, uppercase, 0.08em tracking).
- **Tone:** Each semantic tone (neutral / accent / win / loss / value) pairs a ~30%-opacity border with a ~10–20%-opacity background fill of the same ink — never a solid fill, which would compete with the brand accent for visual weight.

#### Exception: the header corner chip (solid fill, approved)

One component departs from the Tone rule above, deliberately and with the product owner's sign-off: the rotated corner chip on the header's plan and referral cards (`CornerBadge` in `PlanHeaderStrip.tsx`), rendering **ACTIV** and **GRATIS**. It uses a **solid fill with inverted ink**, not a tinted fill, because the reference art treats it as a physical sticker sat on the card's corner rather than an inline status pill.

The exception is bounded. A solid chip is allowed **only** when all of these hold:

- It is decorative reinforcement — the card already states the same fact in words — and is therefore `aria-hidden`.
- It is absolutely positioned and costs the layout nothing: removing it must not change the card's width or the bar's height.
- Its fill comes from `--fp-chip-active` / `--fp-chip-free` and its text from `--fp-on-accent`, never a raw Tailwind hue. Each pair is defined per theme and clears **4.5:1**, the threshold for small bold labels.
- It never takes a semantic ink's hue where that would misread. In the dark and high-contrast themes the brand accent *is* green, so `--fp-chip-free` resolves to a **neutral** there — a green "GRATIS" beside prediction content sits in Win Green's hue family, which in this system means *a bet that hit*.

Anything failing one of those conditions is a normal badge and follows the Tone rule.

#### On-fill colour pairs

`--fp-accent-text` exists for coloured **text on paper** and deliberately falls back to `--fp-accent` in the dark themes, so it cannot carry white text on a filled surface. Three tokens cover the filled case, defined in every theme:

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--fp-on-accent` | `#ffffff` | `#0a0d0b` | Ink that sits on any accent/chip fill |
| `--fp-chip-active` | `#157a4a` | `#22d06e` | The "active" corner chip |
| `--fp-chip-free` | `#d22b11` | `#ededed` (neutral) | The "free" corner chip |

Light themes pair deep fills with white; dark themes pair luminous fills with near-black, because the dark palette's greens are too bright to carry white text.

#### Tier label inks

`--fp-tier-free` / `--fp-tier-premium` / `--fp-tier-ultra` carry the plan card's tier text. They exist because **`tailwind.config.js` sets no `darkMode`**, so Tailwind's `dark:` variant is *media*-keyed — it follows the operating system, not the theme the app applies through `html.theme-*`. A user choosing Dark in Settings on a light OS kept light-mode ink on a dark card (`sky-700` measured **2.59:1**). Any text colour that must follow the app's own theme belongs in a token, not a `dark:` variant. Borders and fills are non-text and may stay on Tailwind utilities.

### Cards / Containers
- **Corner Style:** 16px radius.
- **Background:** Surface Card (white) on Paper/Paper Elevated page backgrounds — cards are always the brightest neutral in view.
- **Shadow Strategy:** Resting → Hover on interaction (see Elevation & Depth); a subtle top hairline gradient in Signal Ember at 25% opacity marks a card as interactive/tappable.
- **Border:** 1px Line at rest.
- **Internal Padding:** 16px default (14px on the smallest mobile breakpoint), 12px for compact variants.

### Inputs / Fields
- **Style:** Card-surface fill at 90% opacity over a hairline light border, 16px radius in current usage (a mismatch worth resolving — see Don'ts).
- **Focus:** A 2px ring in Signal Ember at ~35% opacity.

### Navigation
- Desktop: fixed 240px sidebar, Paper Elevated background, hairline right border. Items are 44px-tall buttons at 10px radius; active state is Signal Ember Muted fill with Signal Ember text; inactive is Ink Muted text. The Live nav item carries a small pulsing Loss Wine dot to signal "something is happening now."
- Mobile: sticky blurred top header (56px) plus a fixed bottom tab bar showing a 5-item subset (home / matches / live / history / profile), same 44px touch-target and active/inactive treatment as desktop.

### Prediction Card (signature component)
The product's defining surface. A 16px-radius card with a near-invisible resting shadow that lifts on hover with a small upward translate and an ember-tinted border; a hairline top gradient in Signal Ember signals interactivity. Team identity renders as circular, team-color-bordered avatar chips. The 1/X/2 outcome distribution renders as three thin pill-track bars (Paper Muted track, solid-color fill sized by percentage) rather than a chart — scanability over visual richness. The recommended pick is set in Display type, and gains a soft glow when confidence is high (≥85%), the one place the system allows an emphasis effect beyond color and weight. Status chips (win/loss/live/value) reuse the Badge tone system exactly. An "insufficient data" state swaps the card's border and background tint to Value Amber at low opacity rather than hiding the card or rendering an error.

## Do's and Don'ts

### Do:
- **Do** spend Signal Ember only on primary actions, the active nav state, and the pick headline's emphasis — treat it as the scarcest resource in the palette.
- **Do** keep Win Green / Loss Wine / Value Amber structurally independent — never substitute one for another even when a "generic warning" or "generic success" would be easier to reach for.
- **Do** use JetBrains Mono or `tabular-nums` for any figure the user will compare against another figure.
- **Do** keep shadows flat at rest and let hover/focus/stacking earn depth (The Earned Depth Rule).
- **Do** use exactly one of the three radius steps (10 / 16 / 20px) for any new rounded surface.
- **Do** enforce the 44px minimum touch target on every interactive control, not just primary buttons.

### Don't:
- **Don't** introduce the legacy `--lab-*` token set, the plain unprefixed `--bg`/`--accent`/`--border` variables in `src/index.css`, or the Tailwind-config `atelier`/`frost`/`card-hover` shadow tokens in new work — these are dead remnants of an earlier blue/teal "lab" direction that `--fp-*` has already superseded everywhere it's actually rendered. Treat `--fp-*` as the only canonical token source.
- **Don't** reuse the teal `rgba(62, 207, 191, *)` focus-ring color still hardcoded on global input/select focus-visible states and the login shell's glow effects — it doesn't match either theme's Signal Ember accent and is a leftover from the same superseded direction; new focus states should use Signal Ember.
- **Don't** let `rounded-xl`/`rounded-2xl` Tailwind defaults slip into new components as a substitute for the tokenized 10/16/20px scale — this already happens accidentally on auth-form inputs, where an inline `rounded-xl` silently overrides `.glass-input`'s own `rounded-lg`.
- **Don't** apply a resting shadow heavier than the Resting token to an in-flow card "for visual interest" — depth must be earned by an actual state per the Earned Depth Rule.
- **Don't** brighten Loss Wine toward a pure alarm red or brighten Win Green toward a saturated neon — both are deliberately muted inks, not alert colors.
