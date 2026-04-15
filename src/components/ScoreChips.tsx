import React from "react";

export type ScoreChip = { label: string; odd?: string };

export function ScoreChips({
  scores,
  highlightLabel,
}: {
  scores?: ScoreChip[] | null;
  highlightLabel?: string;
}) {
  if (!scores || !scores.length) return null;

  return (
    <div>
      <div className="text-sm text-slate-700 mb-2">Scor corect (top)</div>
      <div className="flex flex-wrap gap-2">
        {scores.map((s, i) => {
          const active = highlightLabel && s.label.replace(/\s/g, "") === highlightLabel.replace(/\s/g, "");
          return (
            <div
              key={i}
              className={`px-3 py-1 rounded-full border text-sm ${
                active ? "bg-green-50 border-green-300 text-green-700" : "bg-white"
              }`}
              title={s.odd ? `Odd ${s.odd}` : undefined}
            >
              {s.label} {s.odd ? <span className="text-slate-500 ml-1">{s.odd}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
