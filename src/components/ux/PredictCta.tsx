import { useLocale } from "../../context/LocaleContext";
import { predictSurfaceProps, type PredictAction } from "./predictState";
import "./predictCta.css";

/**
 * The header's primary action: generate predictions for the browsed date.
 *
 * WHY IT IS NOT design-system/Button. Button is deliberately flat and shared by
 * every surface in the app; this one control gets a layered, animated treatment
 * that would be wrong everywhere else. Rather than push a one-off variant into a
 * primitive that fifty callers depend on, the treatment stays local — the escape
 * hatch a design system is supposed to have.
 *
 * IT OWNS NO LOGIC. The handler, the quota rules, the busy flag and the
 * analytics all stay with the caller. This renders a real <button> and hands
 * clicks straight back.
 *
 * THE LABEL IS THE POINT, THE ANIMATION IS NOT. It says what it does, in words,
 * at full contrast, in every frame of the shimmer and in every state including
 * reduced-motion. See predictCta.css.
 */

type Props = {
  /*
    THE ACTION, not a handful of strings describing it.

    This used to take `state`, `hint`, `busyLabel`, `disabledLabel` and
    `accessibleName` as five loose props and compose the spoken name, the
    tooltip and the live-region text from them itself. That is a SECOND
    derivation of what predictState.ts already resolved: the two agreed only
    for as long as someone kept them agreeing, and they had already drifted
    once — the title read the idle promise on a button that would refuse.

    It composes nothing now. Every string below is read off the contract.
  */
  action: PredictAction;
  className?: string;
};

/**
 * Split for animation only.
 *
 * Per-letter spans are what let the shimmer travel across the word, but a run of
 * single-character elements is exactly the shape that makes some screen readers
 * spell a word out. The whole run is therefore aria-hidden and the button
 * carries its own accessible name — the reader gets one clean label, the eye
 * gets the animation.
 */
function AnimatedWord({ word, delayFrom }: { word: string; delayFrom: number }) {
  return (
    <>
      {Array.from(word).map((ch, i) => (
        <span
          key={`${word}-${i}`}
          className="fp-predict-letter"
          // The sequential offset is the travelling part. 60ms keeps the wave
          // readable without the word ever visibly disassembling.
          style={{ animationDelay: `${(delayFrom + i) * 0.06}s` }}
        >
          {ch}
        </span>
      ))}
    </>
  );
}

export default function PredictCta({ action, className = "" }: Props) {
  const { busy } = action;
  const { t } = useLocale();
  const label = t("shell.predict");
  /*
    Split on the space so the second word can drop at narrow widths without a
    second i18n key holding a duplicate of the same copy.
  */
  /*
    Split on the LAST space, not the first. "Generate Match Predictions"
    split on the first put a bare space character into a letter-gapped flex
    row, rendering a triple-width hole on line two.
  */
  const cut = label.lastIndexOf(" ");
  const first = cut === -1 ? label : label.slice(0, cut);
  const second = cut === -1 ? "" : label.slice(cut + 1);

  /*
    NOT the `disabled` attribute.

    A disabled button is removed from the tab order, and the browser blurs it
    the moment the attribute lands on the focused element — so a keyboard user
    who pressed Enter here lost focus to <body> in the same tick, and the busy
    name this component swaps in was announced to nobody. `aria-disabled` keeps
    the button focusable and in the accessibility tree; the guard below is what
    actually makes it inert, including for Enter and Space, which fire click.

    It is on the BUTTON, never on a wrapper: PR #202 removed exactly that from
    a <Card> div, where the attribute is not supported and leaked to
    descendants.
  */

  return (
    <>
    <button
      type="button"
      /*
        THE WHOLE SURFACE, SPREAD — not the same five attributes derived again.

        `predictSurfaceProps` already computes onClick, aria-disabled, aria-busy,
        title and data-predict-state. Restating them here made this component a
        second implementation of the factory: a field added to the factory later
        (aria-describedby, say) would silently not reach the one control most of
        this file's comments describe as where these bugs used to live. The
        activation guard comes with it — `onActivate` is already inert when the
        action is, including for Enter and Space, which the browser routes
        through click on a native button.
      */
      {...predictSurfaceProps(action)}
      /*
        The ONE override, and the reason this control cannot simply spread and
        stop: the factory emits no `aria-label` when idle, so a control's own
        visible words stay its name. The letters below are aria-hidden for the
        shimmer, so this button has no visible words to fall back on and must
        name itself in every state. Busy and blocked still open with the visible
        label (WCAG 2.5.3) because `accessibleName` is built that way.
      */
      aria-label={action.accessibleName}
      data-testid="predict-cta"
      /*
        Below sm the label tightens rather than losing a word: 10px, no extra
        tracking and slimmer padding is what buys "Predicții" room in a 390px
        bar. Dropping the noun was the easier fix and the worse one — a button
        reading only "GENEREAZĂ" does not say what it generates.

        10px is the floor, not a preference: geometry.guard.test.ts forbids UI
        text below it, and shrinking past an accessibility rule to win layout
        space is the wrong trade.
      */
      /*
        TWO LINES, NOT ONE. On one line this ran ~190px and ate the row: the
        brand collapsed to "F…" and the date to "27". Stacked, the same words
        occupy roughly half the width and sit inside the 56px bar beside three
        other zones instead of crowding them out.

        No fixed width — it is sized by its own content, so the allocation stays
        correct when the copy or the locale changes.
      */
      className={`fp-predict${busy ? " is-busy" : ""}${action.blocked ? " is-disabled" : ""} touch-target shrink-0 px-2 py-1 font-display text-[10px] font-bold uppercase leading-[1.15] tracking-[0.08em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] sm:px-3 sm:text-[11px] ${className}`}
    >
      {/*
        Decorative: the readable name is on the button itself.

        Each WORD is its own flex row so the letter gap applies inside both and
        the line break falls only between them. Flat, the gap fell between word
        one's letters and word two as a block, which letter-spaced the first
        word and left the second tight against itself.
      */}
      <span aria-hidden="true" className="flex flex-col items-center justify-center">
        <span className="flex items-center gap-[0.1em]">
          <AnimatedWord word={first} delayFrom={0} />
        </span>
        {second ? (
          <span className="flex items-center gap-[0.1em]">
            <AnimatedWord word={second} delayFrom={first.length} />
          </span>
        ) : null}
      </span>
    </button>
    {/*
      The busy state needs somewhere to be HEARD. Swapping the button's own
      accessible name is not an announcement — nothing re-reads a control the
      user is already on. This region is the only thing that speaks when a run
      starts, and it is a sibling so it is never part of the button's name.
    */}
    <span role="status" aria-live="polite" className="sr-only" data-testid="predict-status">
      {busy ? (action.reason ?? "") : ""}
    </span>
    </>
  );
}
