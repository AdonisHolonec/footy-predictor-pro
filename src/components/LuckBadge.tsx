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
      className={`inline-flex items-center gap-1.5 text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-lg border shadow-sm whitespace-nowrap ${
        isLucky
          ? "bg-orange-500/15 border-orange-400/40 text-orange-300"
          : "bg-cyan-500/15 border-cyan-400/40 text-cyan-200"
      }`}
      title={`${isLucky ? "Lucky Form" : "Value Trend"} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)})`}
    >
      <span>{isLucky ? "⚠️" : "💎"}</span>
      <span>{isLucky ? "Lucky Form" : "Value Trend"}</span>
      <span className="opacity-80 font-mono text-[8px] sm:text-[9px]">
        {diff >= 0 ? "+" : ""}
        {diff.toFixed(2)}
      </span>
    </div>
  );
}
