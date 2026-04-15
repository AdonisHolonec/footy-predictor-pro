// src/components/ConfidenceBar.tsx
import React from "react";

export default function ConfidenceBar({ value = 0 }: { value?: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
        <span className="font-medium">Încredere</span>
        <span className="font-semibold">{v}%</span>
      </div>
      <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden">
        <div className="h-full bg-green-500" style={{ width: `${v}%` }} aria-label={`Confidence ${v}%`} />
      </div>
    </div>
  );
}
