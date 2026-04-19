type LuckBadgeProps = {
  goals?: number;
  xg?: number;
};

export default function LuckBadge({ goals, xg }: LuckBadgeProps) {
  if (goals === undefined || xg === undefined) return null;
  if (!isFinite(goals) || !isFinite(xg)) return null;

  const diff = goals - xg;
  const isLucky = diff > 0;

  return (
    <div
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[9px] font-semibold shadow-sm sm:text-[10px] ${
        isLucky
          ? "border-signal-amber/35 bg-signal-amber/10 text-signal-amber"
          : "border-signal-petrol/25 bg-signal-petrol/10 text-signal-petrol/90"
      }`}
      title={`${isLucky ? "Lucky form" : "Value trend"} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)})`}
    >
      <span aria-hidden>{isLucky ? "▲" : "◇"}</span>
      <span>{isLucky ? "Lucky form" : "Value trend"}</span>
      <span className="font-mono text-[8px] tabular-nums opacity-90 sm:text-[9px]">
        {diff >= 0 ? "+" : ""}
        {diff.toFixed(2)}
      </span>
    </div>
  );
}
