import { useMemo, useState } from "react";
import type { PredictionRow } from "../../types";
import MatchCard from "../MatchCard";
import Button from "../../design-system/Button";

const PAGE = 24;

type Props = {
  matches: PredictionRow[];
  hashColor: (seed: string) => string;
  isWatched: (id: number) => boolean;
  onToggleWatch: (id: number) => void;
  isBookmarked?: (id: number) => boolean;
  onToggleBookmark?: (id: number) => void;
  onShare?: (message: string) => void;
  onOpen: (m: PredictionRow) => void;
  canShowSpecialBet?: boolean;
};

/**
 * Lightweight pagination virtualization — avoids mounting 100+ MatchCards at once.
 */
export default function VirtualizedMatchGrid({
  matches,
  hashColor,
  isWatched,
  onToggleWatch,
  isBookmarked,
  onToggleBookmark,
  onShare,
  onOpen,
  canShowSpecialBet
}: Props) {
  const [visible, setVisible] = useState(PAGE);
  const slice = useMemo(() => matches.slice(0, visible), [matches, visible]);

  return (
    <div>
      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {slice.map((match) => (
          <MatchCard
            key={match.id}
            row={match}
            logoColors={{}}
            hashColor={hashColor}
            compact
            watched={isWatched(Number(match.id))}
            onToggleWatch={() => onToggleWatch(Number(match.id))}
            bookmarked={isBookmarked?.(Number(match.id))}
            onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(Number(match.id)) : undefined}
            onShare={onShare}
            canShowSpecialBet={canShowSpecialBet}
            onClick={() => onOpen(match)}
          />
        ))}
      </div>
      {visible < matches.length && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => setVisible((v) => v + PAGE)}>
            Load more ({matches.length - visible} left)
          </Button>
        </div>
      )}
    </div>
  );
}
