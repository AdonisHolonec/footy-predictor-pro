import MatchCard from "../MatchCard";
import { PredictionRow } from "../../types";

type PredictionCardProps = {
  row: PredictionRow;
  logoColors: Record<string, string>;
  hashColor: (seed: string) => string;
  animationDelayMs?: number;
  canShowSpecialBet?: boolean;
  onClick: () => void;
};

export default function PredictionCard(props: PredictionCardProps) {
  return <MatchCard {...props} />;
}
