// src/components/CorrectScoreCard.tsx
import React from "react";

export type CorrectScoreItem = {
  score: string;      // ex: "2-1"
  prob: number;       // 0..1 sau 0..100
};

function formatScoreWithPct(s: CorrectScoreItem) {
  const pct = s.prob <= 1 ? Math.round(s.prob * 100) : Math.round(s.prob);
  return `${s.score} (${pct}%)`;
}

const CorrectScoreCard: React.FC<{ top: CorrectScoreItem[] }> = ({ top }) => {
  if (!Array.isArray(top) || top.length === 0) return null;

  const first = top[0];
  return (
    <div className="rounded-2xl shadow p-4 bg-white">
      <div className="text-sm font-semibold mb-2">Correct score (est.)</div>
      <div className="text-gray-700">{formatScoreWithPct(first)}</div>
      {top.slice(1, 4).map((it, i) => (
        <div key={i} className="text-gray-500 text-sm">
          {formatScoreWithPct(it)}
        </div>
      ))}
    </div>
  );
};

export default CorrectScoreCard;
