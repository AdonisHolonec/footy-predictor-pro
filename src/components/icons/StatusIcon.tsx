/**
 * Outcome glyphs for the mobile status badge.
 *
 * The three supplied artworks (hourglass, X, check) are authored in a 0–90
 * coordinate space inside a 256×256 document. Their path data is reproduced here
 * VERBATIM — not redrawn, not re-exported, not swapped for an icon library — and
 * the whole set is authored in that same 0–90 space so the four derived glyphs
 * can reuse the original check and cross outlines rather than approximate them.
 *
 * `ART_TRANSFORM` is the original document transform rescaled from 256 to 24
 * (2.81 × 24/256, and the same for its translate), so the project's 24×24 icon
 * viewBox holds the artwork at exactly its original proportions and padding.
 * Nothing here hard-codes the 256×256 intrinsic size into layout — the rendered
 * size comes from `size`/CSS.
 */

const ART_TRANSFORM = "translate(0.1318681318681314 0.1318681318681314) scale(0.2634375)";

/* -- verbatim artwork ------------------------------------------------------ */

/** Supplied hourglass glyph (the sand body). */
const HOURGLASS_BODY =
  "M 40.513 41.614 c 2.452 2.125 2.458 5.665 0.005 7.79 c -4.107 3.558 -9.02 7.211 -9.777 17.146 c -0.047 0.611 0.451 1.133 1.064 1.133 l 27.292 0 c 0.613 0 1.111 -0.522 1.064 -1.133 c -0.757 -9.934 -5.67 -13.587 -9.777 -17.146 c -2.453 -2.126 -2.447 -5.666 0.006 -7.792 c 4.24 -3.673 9.337 -7.45 9.831 -18.138 c 0.028 -0.601 -0.465 -1.107 -1.067 -1.107 l -27.407 0 c -0.602 0 -1.095 0.506 -1.067 1.107 C 31.175 34.164 36.273 37.94 40.513 41.614 z";

/** Supplied hourglass glyph (the broken ring with the arrow head). */
const HOURGLASS_RING =
  "M 88.711 60.078 l -7.712 -2.066 c -2.998 8.042 -8.643 14.735 -16.171 19.08 c -8.575 4.947 -18.557 6.261 -28.113 3.699 c -9.544 -2.557 -17.528 -8.69 -22.481 -17.268 c -4.953 -8.579 -6.272 -18.56 -3.715 -28.104 c 5.286 -19.73 25.638 -31.48 45.374 -26.197 c 5.004 1.341 9.596 3.678 13.647 6.945 l 3.104 2.502 l -5.721 5.721 h 16.556 V 7.835 l -5.262 5.262 l -2.52 -2.177 c -5.151 -4.45 -11.121 -7.606 -17.744 -9.382 C 54.067 0.497 50.161 0 46.318 0 C 26.449 0 8.218 13.278 2.836 33.361 c -3.106 11.59 -1.502 23.714 4.515 34.137 s 15.715 17.872 27.305 20.978 c 11.498 3.078 23.845 1.453 34.148 -4.495 C 78.174 78.57 85.143 70.17 88.711 60.078 z";

/** Supplied disc, shared by the X artwork and reused by every derived glyph. */
const DISC =
  "M 45 90 C 20.187 90 0 69.813 0 45 C 0 20.187 20.187 0 45 0 c 24.813 0 45 20.187 45 45 C 90 69.813 69.813 90 45 90 z";

/** Supplied cross, upper-right to lower-left. Doubles as the void slash. */
const CROSS_A =
  "M 28.902 66.098 c -1.28 0 -2.559 -0.488 -3.536 -1.465 c -1.953 -1.952 -1.953 -5.118 0 -7.07 l 32.196 -32.196 c 1.951 -1.952 5.119 -1.952 7.07 0 c 1.953 1.953 1.953 5.119 0 7.071 L 32.438 64.633 C 31.461 65.609 30.182 66.098 28.902 66.098 z";

/** Supplied cross, upper-left to lower-right. */
const CROSS_B =
  "M 61.098 66.098 c -1.279 0 -2.56 -0.488 -3.535 -1.465 L 25.367 32.438 c -1.953 -1.953 -1.953 -5.119 0 -7.071 c 1.953 -1.952 5.118 -1.952 7.071 0 l 32.195 32.196 c 1.953 1.952 1.953 5.118 0 7.07 C 63.657 65.609 62.377 66.098 61.098 66.098 z";

/** Supplied check mark. */
const CHECK =
  "M 38.478 64.5 c -0.01 0 -0.02 0 -0.029 0 c -1.3 -0.009 -2.533 -0.579 -3.381 -1.563 L 21.59 47.284 c -1.622 -1.883 -1.41 -4.725 0.474 -6.347 c 1.884 -1.621 4.725 -1.409 6.347 0.474 l 10.112 11.744 L 61.629 27.02 c 1.645 -1.862 4.489 -2.037 6.352 -0.391 c 1.862 1.646 2.037 4.49 0.391 6.352 l -26.521 30 C 40.995 63.947 39.767 64.5 38.478 64.5 z";

/** Left half of the disc — the "half" in half-win / half-loss. */
const DISC_LEFT_HALF = "M 45 0 A 45 45 0 0 0 45 90 Z";

/* -- palette --------------------------------------------------------------- */

/** Exact colours from the supplied artwork. */
const GREEN = "rgb(40,201,55)";
const RED = "rgb(236,0,0)";
const YELLOW = "rgb(242,195,0)";
const WHITE = "rgb(255,255,255)";
/** Derived: distinct from RED so half-loss never reads as a full loss. */
const ORANGE = "rgb(242,140,0)";
/** Derived: neutral for the two states that are neither win nor loss. */
const SLATE = "rgb(130,140,155)";
/** How strongly the unearned half of a split disc is knocked back. */
const HALF_OPACITY = 0.35;

export const STATUS_KINDS = ["win", "loss", "pending", "push", "halfWin", "halfLoss", "void"] as const;

export type StatusKind = (typeof STATUS_KINDS)[number];

/**
 * Raw status strings as they arrive from the two products: prediction history
 * uses win/loss/push/half_win/half_loss, Global Special Bet uses won/lost/void.
 * Anything unmodelled returns null so the caller can keep rendering text rather
 * than show a wrong icon.
 */
export function normalizeStatus(raw?: string | null): StatusKind | null {
  switch (String(raw ?? "").toLowerCase()) {
    case "win":
    case "won":
      return "win";
    case "loss":
    case "lost":
      return "loss";
    case "pending":
      return "pending";
    case "push":
      return "push";
    case "half_win":
    case "halfwin":
      return "halfWin";
    case "half_loss":
    case "halfloss":
      return "halfLoss";
    case "void":
      return "void";
    default:
      return null;
  }
}

/** The i18n key holding the accessible name for each status. */
export function statusA11yKey(kind: StatusKind): string {
  return `common.status.${kind}`;
}

/** A split disc: the outcome colour on the left, knocked back on the right. */
function splitDisc(color: string): JSX.Element {
  return (
    <>
      <path d={DISC} fill={color} opacity={HALF_OPACITY} />
      <path d={DISC_LEFT_HALF} fill={color} />
    </>
  );
}

const ART: Record<StatusKind, JSX.Element> = {
  win: (
    <>
      <circle cx="45" cy="45" r="45" fill={GREEN} />
      <path d={CHECK} fill={WHITE} />
    </>
  ),
  loss: (
    <>
      <path d={DISC} fill={RED} />
      <path d={CROSS_A} fill={WHITE} />
      <path d={CROSS_B} fill={WHITE} />
    </>
  ),
  pending: (
    <>
      <path d={HOURGLASS_BODY} fill={YELLOW} />
      <path d={HOURGLASS_RING} fill={YELLOW} />
    </>
  ),
  push: (
    <>
      <path d={DISC} fill={SLATE} />
      <rect x="25" y="35" width="40" height="9" rx="4.5" fill={WHITE} />
      <rect x="25" y="46" width="40" height="9" rx="4.5" fill={WHITE} />
    </>
  ),
  halfWin: (
    <>
      {splitDisc(GREEN)}
      <path d={CHECK} fill={WHITE} />
    </>
  ),
  halfLoss: (
    <>
      {splitDisc(ORANGE)}
      <path d={CROSS_A} fill={WHITE} />
      <path d={CROSS_B} fill={WHITE} />
    </>
  ),
  void: (
    <>
      <path d={DISC} fill={SLATE} />
      <path d={CROSS_A} fill={WHITE} />
    </>
  )
};

type Props = {
  kind: StatusKind;
  /** Accessible name. Comes from `common.status.*` via t() — never hard-coded. */
  label: string;
  className?: string;
  size?: number;
};

/**
 * Outcome glyph. Announces itself as an image named `label`, which is what
 * carries the meaning once the visible text is gone on mobile.
 */
export default function StatusIcon({ kind, label, className = "", size = 18 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label={label}
      focusable="false"
    >
      <g transform={ART_TRANSFORM}>{ART[kind]}</g>
    </svg>
  );
}
