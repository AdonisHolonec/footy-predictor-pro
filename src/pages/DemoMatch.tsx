// src/pages/DemoMatch.tsx
import React from "react";
import CorrectScoreCard, { CorrectScoreItem } from "../components/CorrectScoreCard";

const top: CorrectScoreItem[] = [
  { score: "1-0", prob: 0.18 },
  { score: "2-1", prob: 0.15 },
  { score: "2-0", prob: 0.13 },
  { score: "1-1", prob: 0.12 },
];

export default function DemoMatch() {
  return (
    <div className="max-w-xl mx-auto p-6">
      <CorrectScoreCard top={top} />
    </div>
  );
}
