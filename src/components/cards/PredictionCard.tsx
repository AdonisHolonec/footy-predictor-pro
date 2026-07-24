import MatchCard from "../MatchCard";
import { PredictionRow } from "../../types";

type PredictionCardProps = {
  row: PredictionRow;
  logoColors: Record<string, string>;
  hashColor: (seed: string) => string;
  animationDelayMs?: number;
  canShowSpecialBet?: boolean;
  onClick: () => void;
  /** Effective access tier (free / premium / ultra) — drives lock vs missing-data UI. */
  accessTier?: string;
};

export default function PredictionCard(props: PredictionCardProps) {
  return <MatchCard {...props} />;
}
