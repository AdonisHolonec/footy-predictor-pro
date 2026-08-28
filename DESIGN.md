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
  micro:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.625rem"
    fontWeight: 700
    letterSpacing: "0.05em"
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
- **Micro-label** (600–700, 0.625rem / **10px**): The floor, and the only step below Label. Reserved for dense permanent chrome where a whole zone must fit a fixed height — the 56px header strip (tier, countdown, quota, corner chip, the Predict CTA) and the referral campaign strip below it and the match-card / match-modal chrome. `geometry.guard.test.ts` enforces 10px as a hard minimum for all UI text, so this is the smallest step that will ever exist; nothing may go below it to win layout space. It was already the most-used step in the codebase before it was in this ramp — **516 `text-[10px]` classes across 77 files** — which is precisely why leaving it undeclared was expensive. It is now declared in this file's `typography:` frontmatter as `micro`, which is the only place the detector reads — so 10px is a real step it recognises, not a value suppressed by the project's ignore list. Prose alone would not have done it.
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
- **Blocked (`aria-disabled`, still focusable):** `--fp-disabled-surface` fill, `--fp-disabled-ink` label, `--fp-disabled-border` edge, no shadow. **Never `opacity`.** A control kept focusable so it can explain itself is not an "inactive component", so WCAG's contrast exemption does not apply to it: the label must clear 4.5:1 and the boundary 3:1 (1.4.11). Blanket opacity fails both — it faded the Predict CTA's label to 1.55:1 — and a card-coloured fill fails the boundary on its own, because the header bar is itself `--fp-bg-card`. That is why the boundary lives in a declared token rather than in the fill.

  **The primitive owns this skin, not each caller.** `aria-disabled` matches none of Tailwind's `disabled:` utilities — the browser still considers the control enabled — so for a while every `Button` handed `predictSurfaceProps(action)` rendered a blocked action at full primary fill, normal cursor, working press animation, with an `onClick` that did nothing. The Banner retry shipped exactly that. `design-system/Button` now carries an `aria-disabled:` recipe beside its `disabled:` one, spelling out `aria-disabled:hover:` and `aria-disabled:active:` explicitly because those have equal specificity to the variant's own and would otherwise be decided by emission order.

- **Natively disabled (`disabled`, NOT focusable): `opacity-50` is correct, and stays.** The rule above is scoped to `aria-disabled`; it is not a ban on opacity for disabled controls in general. All four `Button` variants carry `disabled:opacity-50 disabled:cursor-not-allowed`, and the Predict empty states render exactly that — measured at `opacity: 0.5`, out of the tab order. That is legitimate: a control the browser has removed from the tab order **is** an inactive component under WCAG 1.4.3/1.4.11, which exempts it from the contrast minima, so fading it costs a user nothing they could have reached.

  The distinction is the whole point, and it decides which one a surface should use. `aria-disabled` buys the ability to **explain the refusal to a keyboard user**, and pays for it by owing full contrast. Native `disabled` is cheaper and dimmer, and owes the reason **somewhere else on screen** — which is why `HomeSection` and `MatchesSection` put `predictAction.reason` in the empty state's own description rather than relying on a name nobody can focus. Neither is the default; pick by whether the control has to speak for itself.
- **Busy (`aria-busy`, still focusable):** the resting surface is kept in full — colour, depth and accent glow — and progress is carried by a 2px indeterminate rail inset from the bottom edge. **Motion never crosses the label.** A sweep over the face took the white text to 3.18:1, and to 4.04:1 with `prefers-reduced-motion`, where it freezes. Under reduced motion the rail stays lit and still: the state survives, the animation does not.

  The rail draws from **`--fp-on-accent`**, never a literal — hardcoded white measured 2.73:1 on the dark theme's green face and 1.73:1 on high contrast's, and the rail is a non-text indicator that owes 3:1 under 1.4.11. Themed it reads **5.13 / 6.81 / 11.77** at the travelling peak and **3.16 / 4.24 / 6.41** along the track, in normal motion and reduced alike.

- **Neither inert state may look pressed.** Because these controls use `aria-disabled` rather than the native attribute — which is what keeps them focusable — the global `button:active:not(:disabled)` in `index.css` still matches them. Components that opt out of the native attribute must opt out of the press feedback too, scoped to themselves: `index.css`'s rule is correct for every natively-disabled button in the app and is not the thing to change. `predictState.test.ts` resolves the real cascade (layer, then specificity, then order) and fails if a refactor ever lets the global rule win.

#### The 56px bar is functional chrome; the campaign is not in it

The bar holds exactly three zones: **brand + browsed date · plan + remaining time · Predict**. Nothing else earns a place in a 56px row that has to survive 390px.

The permanent referral campaign used to be a fourth. At 390 the sum of the four zones' min-content widths exceeded the row, so something gave way on every pass — and it was always the wrong thing: the brand truncating to "F…", or the offer to "+5 zile Ul…", which sells nothing. Each fix shaved a functional zone to make room for a marketing one, which is the priority order upside down. The rule that came out of it: **when a 56px row is over budget, the marketing surface moves; the chrome does not shrink.**

The campaign now renders as its own strip immediately below the bar, via ConsumerShell's `campaignSlot` — a separate slot from `statusSlot` precisely so the distinction survives the next edit of that file.

- **Measured height 38.9px**, against a 56px bar. It is secondary by construction: a strip, never a banner, and a test fails if it ever grows past the bar.
- **Fixed product copy never truncates.** "INVITĂ" and "+5 zile Ultra" always fit; the only truncatable thing on the surface is an invitee's name, which is the one unknowable string.
- **Touch target 44px**, delivered by `.touch-target`'s pseudo-element rather than by row height — which is how a 39px strip still clears the minimum.
- **On the first viewport, always.** No menu, no toast, no modal, no scroll to discover it.

**Its ink and boundary were measured, not chosen.** `--fp-accent-text` on the accent tint read **3.99** in light — under the 4.5 that size owes — so the words use `--fp-text` (**12.91 / 15.93 / 18.61**). A tinted border is the badge habit and is wrong for an actionable control, whose edge owes 3:1 under 1.4.11: `accent/40` measured **1.79 / 1.99 / 2.49** and `accent/70` still missed light at **2.75**, so the boundary is the accent at full strength (**3.76 / 6.81 / 11.77**). `--fp-border-strong` was measured too and is a hairline, not a boundary (1.64 / 1.55).

It is **outlined, not solid-filled**, on purpose: Predict is the solid accent button in that viewport and must stay the loudest thing in it.

**The corner chip gained a placement, not a sibling.** Same component, same tokens, same decorative `aria-hidden` contract — but `"corner"` overhangs a tall card, and on a 26px pill that put the chip 4.4px above the strip, straddling the header's bottom border. `"inline-start"` anchors it to the leading edge, vertically centred, inside its own row.

**The reward notice still spans both surfaces**, and is derived once (`referralNotice.ts`): the days on the plan card, the person on the campaign. They are no longer the same component, so one builder feeds both — and the spoken announcement in the plan strip still carries the whole sentence, because a screen-reader user should hear one message, not two fragments split across a layout boundary they cannot perceive. The transient bonus notifications, `ReferralBonusHistory` and the claim flow are untouched by any of this.

#### The Predict state model

Predict is reachable from **six triggers** — the header CTA, the Banner retry, the Home and Matches empty states, the command palette row, and the onboarding effect — plus `restoreOrPredict`, the Refresh path, which falls through to a run on **two** of its branches. That is seven call sites, eight if the two fallthroughs are counted apart; the number is not the point, and any count stated here will drift. **One rule, one gate, one state** is the point, and it is what holds however many callers appear.

`src/components/ux/predictState.ts` owns all three: `PredictState = "idle" | "busy" | "blocked"`, `isPredictBlocked()` over the server's own `quotaExempt` / `limit` / `used`, and `resolvePredictState()` — in which **busy outranks blocked**, because spending the last prediction makes both true at once and every surface has to name the same state.

The gate is the first statement of `warmAndPredict`, not a prop on a button: gating a prop gated exactly one of the eight and left the rest firing runs the server would reject. Surfaces that can show state derive it from the same value; surfaces that cannot are still blocked by construction.

**Quota exhaustion is status, not an action label.** It is reported by the plan card and never by a tag pinned to the Predict button. The card does **not** trade the countdown away to say it: a subscriber who has spent today's allowance needs both facts — what is gone, and how long the plan that grants it still runs — so the two coexist, compacted to two leading units below `sm` and spoken in full at every width. A tag there overlapped the button's own glyphs, covering the "Ă" of GENEREAZĂ, and put the same number in two places 40px apart. The solid corner-chip exception stays limited to **ACTIV** and **GRATIS**.

#### The Predict action contract, and the surface that carries it

The state model above stopped surfaces from *disagreeing about the state*. It did not stop them from disagreeing about everything downstream of it, and three consecutive rounds of fixes proved that: one surface gated and four not, a click guarded and its Enter not, a reason shown here and withheld there. Each round closed the instance and left the class open, because the correct behaviour was still five things every surface had to remember.

`buildPredictAction()` is what surfaces consume instead of `state`. It is built once per render in `UserDashboard` and answers every downstream question in one object — `disabled`, `reason`, `hint`, `accessibleName` — so none of them is a surface's decision any more.

- **`onActivate` is the only way to start a run.** It is safe to call in any state; when the action is unavailable it does nothing. A surface that calls `warmAndPredict` directly has opted out of the contract, and `predictState.test.ts` fails on any JSX handler that does.
- **`predictSurfaceProps(action)` is the thing you spread.** One spread produces the activation guard, the inert semantics, the truthful name, the truthful tooltip, and the `data-predict-state` hook the stylesheet keys off. A contract alone was not enough — it still had to be *applied* correctly five times, and the round that introduced it left a Banner re-deriving `disabled` from a raw state and never showing the reason. This is the version you cannot apply half-way.
- **Spread the surface; never index it, never restate it.** Pulling one field out (`predictSurfaceProps(a)["aria-label"]`) is how the palette row got a correct name, no tooltip and no state attribute. Restating the fields by hand is the same failure spelled differently, and `PredictCta` did it — the component most of this system's comments describe as where these bugs used to live. Both are now guarded.
- **The name is added, never replaced.** Busy and blocked prepend the visible label to the reason, so a voice-control user saying what they can see still matches (WCAG 2.5.3). When **idle** there is no `aria-label` at all: the control's own words are the better name, and overriding them with a longer hint masks what the user can read while adding nothing.

**`aria-disabled`, not the native attribute — and the obligation that comes with it.** The native attribute blurs the focused element and drops it from the tab order, so a keyboard user who lands on a spent Predict button is thrown off it before it can say *why*. These surfaces stay focusable and announce the reason instead. Two obligations follow, and both have already been paid for once: the global `button:active:not(:disabled)` press feedback still matches, so a component opting out of the native attribute must scope its own opt-out (see above); and any consumer that renders a **natively** disabled primitive must carry the reason **visibly**, because a control out of the tab order can explain itself to nobody.

**Pointer and keyboard must refuse identically.** The palette row was the case that made this a rule: its pointer path was guarded and its Enter path was not. The fix is structural rather than a second guard — rows are native `<button type="button">`, so the browser routes both Enter and Space through `click`, and `onActivate` guards that one path. **Do not add a `Space` handler to reach parity.** One was added, on the palette's *search input*, with an unconditional `preventDefault()`; native buttons already handled Space, so all it achieved was making a space impossible to type — every multi-word search in the product, broken by a fix for a bug that did not exist. `CommandPalette.test.tsx` exists because no test had ever rendered that component.

**Two surfaces deliberately stay outside the contract.**

- **Matches Refresh** is a data action, not a Predict trigger. `restoreOrPredict` serves cached picks when they are good and only falls through to a run when they are not, so labelling it blocked would refuse a reload the quota does not govern. It is protected by the gate inside `warmAndPredict` like any other caller — blocked by construction, not by appearance.
- **Matches Refresh** is a data action whose *fallback* reaches Predict. `restoreOrPredict` serves cached picks when they are good and only runs when they are not, and that split decides its wiring exactly: **blocked does not reach it** — refusing a cache reload because today's allowance is spent would refuse something the quota does not govern, and the Predict fallthrough is covered by the gate anyway — while **busy does**, because concurrency is a shared concern and a refresh mid-run could enter a second time. It carries no `data-predict-state`: it is not a Predict surface, and saying so in one place is what stops the next reader from "fixing" it into one.
- **The onboarding effect** renders nothing at all. It cannot show state, so the gate is the only thing standing between it and a rejected run. This is the case that decides where the gate lives: a gate on a prop can never protect a caller that has no props.

**Spread the surface; never index it.** `predictSurfaceProps(action)["aria-label"]` type-checks and reads sensibly, and is how the palette row ended up with a correct accessible name, **no tooltip and no state attribute** — the factory applied one-sixth of the way. The fields travel together or the surface is wrong in a way nothing announces. Where a surface genuinely needs to wrap the handler — the palette closes itself after a run — the override goes **below** the spread and keeps its own guard, so a refusal does not also dismiss the palette.

**Visible text and the accessible name are different jobs.** A surface may compose what it *shows*: the palette row renders `label · reason`. It may not compose what it is *called* — that has one author, because the name is what a voice-control user has to say. The row previously broke the display half too, showing the long hint when idle and a composed label when blocked, so it changed what KIND of string it was between states; the label leads in both now and only the reason varies. `PredictAction` exposes `label` so a surface can render the name without reaching back into i18n for a string the contract was already handed.

**One interaction model per control — never both.** `EmptyState` was handed the native `disabled` attribute *and* `aria-disabled` with the reason as its accessible name. Those are the two models above, and applying both does not double the signal, it cancels it: the native attribute pulls the control out of the tab order, so the reason became unreachable by precisely the users it was added for. The empty states now take the surface alone, and the reason is also stated in their visible description — the channel a natively-disabled control would have owed.

**A caller convention is not an authoritative source.** `PlanHeaderStrip` called the shared `isPredictBlocked` with a hardcoded `quotaExempt: false`, correct only because the dashboard separately encoded exemption by passing `quota={null}` — one rule split across two files and held together by a shape no type could check. Hand it real counters for an exempt account and the card announces "0 predicții azi" beside a Predict button that works. The card now receives **the same `PredictQuota` object the gate reads** and asks the same predicate, so the two cannot reach different answers. Calling a shared rule is not the same as consuming it; what you pass in decides whether it is really shared.

**The ink on an accent fill is a token.** `--fp-accent` is red in light and **green** in dark and high contrast, so a literal `text-white` is legible against exactly one theme. Measured on the primary `Button` — which is what the Predict empty states render — it read **4.20 / 2.87 / 1.78**, failing 4.5:1 in two themes on 14px semibold text. `--fp-on-accent` flips with the theme and reads **4.20 / 6.81 / 11.77**. This is the same rule the CTA and its busy rail already followed, which is exactly why they measured clean while the Button beneath them did not — a component can satisfy the rule while the primitive it sits on breaks it, and only measuring the rendered pixel finds that.

Light remains at **4.20**. There `--fp-on-accent` *is* white, so clearing 4.5 requires the light accent itself to darken to about its own hover step (which measures 4.74) — a brand-token change affecting every accent surface in the theme. It is recorded here rather than taken. **Sixteen further call sites** in `src/` still hardcode white on an accent fill; they are pre-existing and outside this change, and the guard in `predictState.test.ts` is scoped to the Predict surfaces for that reason rather than being a repo-wide ban that would fail on untouched code.


### Badges
- **Style:** Fully pill-shaped (`rounded-full`), hairline border, JetBrains Mono label type (0.6875rem, uppercase, 0.08em tracking).
- **Tone:** Each semantic tone (neutral / accent / win / loss / value) pairs a ~30%-opacity border with a ~10–20%-opacity background fill of the same ink — never a solid fill, which would compete with the brand accent for visual weight.

#### Exception: the header corner chip (solid fill, approved)

One component departs from the Tone rule above, deliberately and with the product owner's sign-off: the rotated corner chip on the header's plan and referral cards (`CornerBadge` in `PlanHeaderStrip.tsx`), rendering **ACTIV** and **GRATIS**. It uses a **solid fill with inverted ink**, not a tinted fill, because the reference art treats it as a physical sticker sat on the card's corner rather than an inline status pill.

The exception is bounded. A solid chip is allowed **only** when all of these hold:

- It is decorative reinforcement — the card already states the same fact in words — and is therefore `aria-hidden`.
- It is absolutely positioned and costs the layout nothing: removing it must not change the card's width or the bar's height.
- Its fill comes from `--fp-chip-active` / `--fp-chip-free` and its text from `--fp-on-accent`, never a raw Tailwind hue. Each pair is defined per theme and clears **4.5:1**, the threshold for small bold labels.
- It never takes a semantic ink's hue where that would misread — **in every theme, not merely the one that was checked first.** `--fp-chip-free` resolves to a **neutral** in dark and high contrast, because the brand accent *is* green there and a green "GRATIS" beside prediction content sits in Win Green's hue family, which in this system means *a bet that hit*. `--fp-chip-active` is **teal** in all three themes for the same reason, and had to move twice: it was Win Green verbatim in light, and once that was corrected it was still byte-identical to `--fp-success` in dark (`#22d06e`) and to `--fp-accent` in high contrast (`#3ddc84`). Teal reads as "active" and belongs to no semantic ink.

Anything failing one of those conditions is a normal badge and follows the Tone rule.

#### On-fill colour pairs

`--fp-accent-text` exists for coloured **text on paper** and deliberately falls back to `--fp-accent` in the dark themes, so it cannot carry white text on a filled surface. Three tokens cover the filled case, defined in every theme:

| Token | Light | Dark | High contrast | Purpose |
|---|---|---|---|---|
| `--fp-on-accent` | `#ffffff` | `#0a0d0b` | `#000000` | Ink that sits on any accent/chip fill |
| `--fp-chip-active` | `#0f766e` | `#2dd4bf` | `#5eead4` | The "active" corner chip (teal — see above) |
| `--fp-chip-free` | `#d22b11` | `#ededed` (neutral) | `#ffffff` (neutral) | The "free" corner chip |

Light themes pair deep fills with white; dark themes pair luminous fills with near-black, because the dark palette's greens are too bright to carry white text. Measured on rendered pixels, the six pairs run 5.13:1 to 21:1.

**`--fp-accent-hover` must be declared in every theme, never inherited.** `html.theme-contrast` used to omit it and fell through to `:root`'s `#dd2b0f`, so the Predict CTA — and every primary button in the app, ~35 call sites through `design-system/Button` — turned red-orange on hover inside the high-contrast theme, at **4.43:1**. The triplet guard test passes on that, because it only checks hex↔triplet sync and treats inheritance as documented. Any token used as a **fill behind text** needs its own value per theme; the guard will not catch it.

#### Disabled surface tokens

`--fp-disabled-surface` / `--fp-disabled-border` / `--fp-disabled-ink`, declared in **all four scopes** (`#d6d3d3`/`#5f5f5f`/`#3d3d3d` light · `#2b332c`/`#8a9a90`/`#cddad2` dark · `#262626`/`#b5b5b5`/`#ffffff` high contrast). Measured against the header bar: boundary 6.35 / 5.95 / 9.27:1, label 7.30 / 9.03 / 15.13:1.

The fill is deliberately well clear of `--fp-bg-elevated`, which `design-system/Button` uses for an **enabled** secondary button — an earlier version of these tokens landed 1.03:1 from it and the disabled primary read as a live secondary control. Colour alone cannot separate them, since both are neutral greys, so **the state is carried by form**: every other button in this system is raised (outer drop shadow, inner top highlight) and the blocked one is a well, `inset 0 1px 3px rgba(0,0,0,0.28)`, with no highlight.

They exist because the reusable neutrals could not do this job. `--fp-bg-muted` and `--fp-border-strong` were both **undeclared in `html.theme-contrast`** and silently inherited the light palette there — the first painted a near-white fill (`#eae7e7`) behind that theme's white text (1.23:1) on every secondary and ghost button hover, the second shipped as a dark hairline on a black card (1.03:1). Both are now declared in that block, and both are in the guard's list. `src/design-system/tokens.guard.test.ts` asserts that each token in its `THEMED_SURFACE_TOKENS` list — the backgrounds, borders, disabled trio and accent/chip fills this system paints controls with — is declared in all four scopes, so the next one of these fails a test instead of a critique. The list is explicit rather than inferred: a token used as a surface and left off it is still invisible to the guard.

#### Tier label inks

`--fp-tier-free` (`#854d0e` / `#fbbf24` / `#fcd34d`), `--fp-tier-premium` (`#047857` / `#34d399` / `#6ee7b7`) and `--fp-tier-ultra` (`#0369a1` / `#7dd3fc` / `#bae6fd`) carry the plan card's tier text, light / dark / high contrast. They exist because **`tailwind.config.js` sets no `darkMode`**, so Tailwind's `dark:` variant is *media*-keyed — it follows the operating system, not the theme the app applies through `html.theme-*`. A user choosing Dark in Settings on a light OS kept light-mode ink on a dark card (`sky-700` measured **2.59:1**). Any text colour that must follow the app's own theme belongs in a token, not a `dark:` variant. Borders and fills are non-text and may stay on Tailwind utilities.

**These inks are measured at full strength, so the text using them must render at full strength.** The plan card's detail line carried `opacity-80`, which composites the whole line at 0.8 alpha and dropped it to 3.21:1 / 3.47:1 / 3.68:1 in the light theme — under the 4.5:1 that 10px semibold requires. (The 3.21 was measured against the free ink of the day, `#a16207`; the `#854d0e` above would have read 4.08 under the same opacity — deeper, still short. The lesson is the opacity, not the ink.) De-emphasis in this card is carried by **weight, case and family** on the line above, never by transparency and never by a lighter ink: these inks already sit close enough to the threshold on their own tinted fill that no lighter value is available. A nested `opacity-100` does not rescue a dimmed parent — CSS composites the subtree as a group.

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

  **One recorded exception: the header's date input, at ~28px.** The consumer bar is 56px and stacks the wordmark above the date in one column, so the date sits flush against the column's bottom edge. `.touch-target` was added there and then removed after probing with `elementFromPoint` at ±21px: the expansion resolved to the brand span above and `<main>` below, clipped both ways. A 44px date target is geometrically impossible inside the 56px contract with the brand stacked over it — it needs a taller bar or the brand moved out of that column, both product decisions rather than a class. The class was removed rather than left in place claiming a target the layout cannot deliver. Any future 56px chrome inherits this constraint; do not re-add `.touch-target` there without changing the geometry first.

### Don't:
- **Don't** introduce the legacy `--lab-*` token set, the plain unprefixed `--bg`/`--accent`/`--border` variables in `src/index.css`, or the Tailwind-config `atelier`/`frost`/`card-hover` shadow tokens in new work — these are dead remnants of an earlier blue/teal "lab" direction that `--fp-*` has already superseded everywhere it's actually rendered. Treat `--fp-*` as the only canonical token source.
- **Don't** reuse the teal `rgba(62, 207, 191, *)` focus-ring color still hardcoded on global input/select focus-visible states and the login shell's glow effects — it doesn't match either theme's Signal Ember accent and is a leftover from the same superseded direction; new focus states should use Signal Ember.
- **Don't** let `rounded-xl`/`rounded-2xl` Tailwind defaults slip into new components as a substitute for the tokenized 10/16/20px scale — this already happens accidentally on auth-form inputs, where an inline `rounded-xl` silently overrides `.glass-input`'s own `rounded-lg`.
- **Don't** apply a resting shadow heavier than the Resting token to an in-flow card "for visual interest" — depth must be earned by an actual state per the Earned Depth Rule.
- **Don't** brighten Loss Wine toward a pure alarm red or brighten Win Green toward a saturated neon — both are deliberately muted inks, not alert colors.
