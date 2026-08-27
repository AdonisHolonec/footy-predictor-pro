import { useLocale } from "../../context/LocaleContext";
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
  onPredict: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** Tooltip and accessible description — the caller owns the wording. */
  hint: string;
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

export default function PredictCta({ onPredict, busy = false, disabled = false, hint, className = "" }: Props) {
  const { t } = useLocale();
  const label = t("shell.predict");
  /*
    Split on the space so the second word can drop at narrow widths without a
    second i18n key holding a duplicate of the same copy.
  */
  const [first, ...rest] = label.split(" ");
  const second = rest.join(" ");

  return (
    <button
      type="button"
      onClick={onPredict}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      /*
        The accessible name, since the animated letters below are hidden from
        assistive technology. It stays the fuller hint the button already used —
        "Generează predicții pentru zilele selectate" — which both preserves the
        existing name and satisfies Label in Name, because it opens with the
        visible label word for word.
      */
      aria-label={hint}
      title={hint}
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
      className={`fp-predict touch-target shrink-0 px-2.5 py-1 font-display text-[10px] font-bold uppercase leading-[1.15] tracking-[0.08em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] sm:px-3 sm:text-[11px] ${className}`}
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
  );
}
