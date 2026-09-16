import { usePresence } from "../../hooks/usePresence";

/**
 * "🟢 25 online", or "👁️ 74 accesări astăzi" when nobody else is here.
 *
 * ONE COMPONENT, TWO PLACEMENTS. The mobile app bar and the desktop toolbar show
 * the same fact at different sizes, so this takes a `variant` rather than being
 * duplicated — the second copy is where the two would drift apart.
 *
 * NO LAYOUT JUMP. The two states have very different text lengths, and this sits
 * next to the logo on mobile, so the box reserves a minimum width. Without it the
 * header would twitch every time the last person leaves.
 *
 * NOTHING IS SHOWN UNTIL SOMETHING IS KNOWN. `stats === null` renders null, not a
 * zero: "0 online" is a real, meaningful reading and must never be how "we have
 * not loaded yet" or "the request failed" looks.
 */

export type ActivityIndicatorProps = {
  userId: string | null | undefined;
  /** `compact` = mobile app bar; `toolbar` = desktop controls row. */
  variant?: "compact" | "toolbar";
  className?: string;
};

export default function ActivityIndicator({
  userId,
  variant = "compact",
  className = ""
}: ActivityIndicatorProps) {
  const { stats } = usePresence(userId);

  if (!stats) return null;

  const isLive = stats.onlineCount > 0;
  const value = isLive ? stats.onlineCount : stats.accessesToday;
  /*
    The visible contract, identical in both placements: "X online" when anyone is
    here, "Y azi" when nobody is. "azi" rather than "accesări astăzi" because the
    56px app bar cannot carry the sentence — the full wording is the accessible
    name instead, so screen readers still hear what the number means.
  */
  const text = isLive ? "online" : "azi";
  const label = isLive ? `${value} online` : `${value} accesări astăzi`;

  const compact = variant === "compact";

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      title={label}
      data-testid="activity-indicator"
      data-state={isLive ? "online" : "accesses"}
      className={[
        "inline-flex shrink-0 items-center gap-1 rounded-full border tabular-nums",
        "border-[var(--fp-border)] bg-[var(--fp-bg-muted)]",
        isLive ? "text-[var(--fp-accent)]" : "text-[var(--fp-text-muted)]",
        /*
          RESERVED WIDTH, NOT CONTENT WIDTH. "🟢 25 online" and "👁️ 74 azi" are
          very different lengths, and on mobile this sits between the wordmark and
          the menu in a fixed 56px row whose zones already sum to ~395px of
          min-content against 366px usable at 390px — the reason its gap is 1.5
          rather than 2. A floor wide enough for the longer state means swapping
          between them moves nothing, and the brand column (which truncates)
          absorbs a narrow viewport rather than the menu being pushed off-screen.
        */
        compact
          ? "min-w-[5.25rem] justify-center px-1.5 py-0.5 text-[10px] font-semibold"
          : "min-w-[6rem] justify-center px-2.5 py-1 text-[11px] font-semibold",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden="true">{isLive ? "🟢" : "👁️"}</span>
      <span>{value}</span>
      <span>{text}</span>
    </span>
  );
}
