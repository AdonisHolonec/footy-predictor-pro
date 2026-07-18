import type { ReactNode } from "react";
import { isoToday, normalizeSelectedDates } from "../../utils/appUtils";

type DatePickerProps = {
  date: string;
  setDate: (value: string) => void;
  selectedDates: string[];
  setSelectedDates: (value: string[] | ((prev: string[]) => string[])) => void;
  setStatus: (message: string) => void;
  /** Optional controls rendered after "+ Zi" inside the same grid (e.g. Warm/Predict). */
  actions?: ReactNode;
};

export default function DatePicker({
  date,
  setDate,
  selectedDates,
  setSelectedDates,
  setStatus,
  actions
}: DatePickerProps) {
  return (
    <>
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap lg:flex-nowrap lg:gap-3">
        <input
          type="date"
          value={date}
          onChange={(e) => {
            const next = e.target.value;
            setDate(next);
            setSelectedDates((prev) => {
              const filtered = prev.filter((d) => d !== date);
              return normalizeSelectedDates([next, ...filtered]);
            });
          }}
          className="col-span-2 w-full rounded-xl border glass-input px-4 py-2.5 text-sm text-signal-ink outline-none focus:ring-2 focus:ring-signal-sage/35 sm:col-span-1"
        />
        <button
          type="button"
          onClick={() => {
            setSelectedDates((prev) => {
              const normalized = normalizeSelectedDates(prev.length ? prev : [date]);
              if (normalized.length >= 3) {
                setStatus("Poți selecta maximum 3 zile.");
                return normalized;
              }
              const base = normalized[normalized.length - 1] || isoToday();
              const nextDate = new Date(base);
              nextDate.setDate(nextDate.getDate() + 1);
              return normalizeSelectedDates([...normalized, nextDate.toISOString().slice(0, 10)]);
            });
          }}
          className="touch-manipulation rounded-xl border border-white/10 bg-signal-panel/60 px-4 py-2.5 text-sm font-semibold text-signal-ink transition-all hover:bg-signal-panel hover:text-signal-petrol active:translate-y-px"
        >
          + Zi
        </button>
        {actions}
      </div>
      <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
        {normalizeSelectedDates(selectedDates.length ? selectedDates : [date]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setSelectedDates((prev) => {
                const next = prev.filter((item) => item !== d);
                const normalized = normalizeSelectedDates(next.length ? next : [date]);
                setDate(normalized[0] || isoToday());
                return normalized;
              });
            }}
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${
              d === date ? "border-signal-petrol/40 bg-signal-petrol/15 text-signal-petrol" : "border-white/10 bg-signal-panel/40 text-signal-inkMuted"
            }`}
            title="Elimină ziua"
          >
            {d} {normalizeSelectedDates(selectedDates.length ? selectedDates : [date]).length > 1 ? "✕" : ""}
          </button>
        ))}
      </div>
    </>
  );
}
