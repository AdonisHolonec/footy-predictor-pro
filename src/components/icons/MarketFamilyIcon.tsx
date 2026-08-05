import type { MarketFamilyKey } from "../../utils/formatRecommendation";

type Props = {
  familyKey: MarketFamilyKey;
  className?: string;
  size?: number;
};

const PATHS: Record<MarketFamilyKey, JSX.Element> = {
  "1X2": (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4a2 2 0 0 0 2 4M17 6h3a2 2 0 0 1-2 4" />
    </>
  ),
  DOUBLE_CHANCE: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.2 2.2L15.5 9.5" />
    </>
  ),
  BTTS: (
    <>
      <path d="M4 8h11M15 8l-3-3M15 8l-3 3" />
      <path d="M20 16H9M9 16l3-3M9 16l3 3" />
    </>
  ),
  GOALS: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7 3 2.2-1.1 3.6h-3.8L9 9.2 12 7Z" />
      <path d="M12 3v4M4.8 9l3.3 1M19.2 9l-3.3 1M7 19l1.6-4.4M17 19l-1.6-4.4" />
    </>
  ),
  CORNERS: (
    <>
      <path d="M5 3v18" />
      <path d="M5 4h9l-2 3 2 3H5" />
      <path d="M13 19a6 6 0 0 0 6-6" />
    </>
  ),
  CARDS: <rect x="7" y="4" width="10" height="15" rx="1.5" />,
  SHOTS: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </>
  ),
  CORRECT_SCORE: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M9 5v14M15 5v14" />
    </>
  ),
  OTHER: <circle cx="12" cy="12" r="9" />
};

/** Small contextual glyph for a recommended pick's market family — pairs with formatRecommendedPick(). */
export default function MarketFamilyIcon({ familyKey, className, size = 12 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[familyKey]}
    </svg>
  );
}
