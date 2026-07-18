type FooterProps = {
  onPredict: () => void;
  disabled: boolean;
  selectedLeagueCount: number;
};

export default function Footer({ onPredict, disabled, selectedLeagueCount }: FooterProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-signal-mist via-signal-mist/95 to-transparent p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
      <div className="pointer-events-auto mx-auto max-w-7xl">
        <button
          type="button"
          onClick={onPredict}
          className="touch-manipulation w-full rounded-2xl bg-signal-petrol px-6 py-3.5 text-sm font-semibold text-signal-mist shadow-atelier transition-all hover:bg-signal-petrolMuted active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
        >
          Predict {selectedLeagueCount ? `(${selectedLeagueCount} ligi)` : ""}
        </button>
      </div>
    </div>
  );
}
