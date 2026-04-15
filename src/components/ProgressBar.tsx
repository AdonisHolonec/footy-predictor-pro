// src/components/ProgressBar.tsx
import React from "react";

type Seg = { label: string; value: number };

export default function ProgressBar({
  segments,
  title,
  highlightMax = true,
}: {
  segments: Seg[];
  title?: string;
  highlightMax?: boolean;
}) {
  const clamped = segments.map(s => ({ ...s, value: Math.max(0, Math.min(100, s.value || 0)) }));
  const total = clamped.reduce((s, x) => s + x.value, 0) || 1;
  const maxIdx = clamped.reduce((mi, s, i, arr) => (s.value > arr[mi].value ? i : mi), 0);

  const palette = ["bg-green-500", "bg-gray-400", "bg-blue-500"];

  return (
    <div className="w-full">
      {title ? <div className="text-xs font-medium text-gray-600 mb-1">{title}</div> : null}

      <div className="w-full h-3 rounded-full bg-gray-200 overflow-hidden flex">
        {clamped.map((s, i) => (
          <div
            key={s.label + i}
            className={`h-full ${palette[i] ?? "bg-gray-500"} ${highlightMax && i === maxIdx ? "ring-2 ring-black/10" : ""}`}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${Math.round(s.value)}%`}
          />
        ))}
      </div>

      <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-700">
        {clamped.map((s, i) => (
          <div key={s.label} className="flex items-center gap-1">
            <span className={`px-1.5 py-0.5 rounded ${i===maxIdx && highlightMax ? "bg-green-100 text-green-800 font-semibold" : "bg-gray-100 font-medium"}`}>
              {s.label}
            </span>
            <span>{Math.round(s.value)}%</span>
            {highlightMax && i === maxIdx ? <span className="px-1 py-0.5 rounded bg-green-600 text-white">Best</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
