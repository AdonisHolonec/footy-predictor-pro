import CallsCounter from "../cards/CallsCounter";
import DatePicker from "../cards/DatePicker";

type GuestHeaderControlsProps = {
  usageCount: number;
  usageLimit: number;
  usagePct: number;
  authLoading: boolean;
  user: { email?: string | null } | null;
  onLogout: () => void;
  onOpenAuth: () => void;
  date: string;
  setDate: (value: string) => void;
  selectedDates: string[];
  setSelectedDates: (value: string[] | ((prev: string[]) => string[])) => void;
  setStatus: (message: string) => void;
  onWarm: () => void;
  onPredict: () => void;
};

export default function GuestHeaderControls({
  usageCount,
  usageLimit,
  usagePct,
  authLoading,
  user,
  onLogout,
  onOpenAuth,
  date,
  setDate,
  selectedDates,
  setSelectedDates,
  setStatus,
  onWarm,
  onPredict
}: GuestHeaderControlsProps) {
  return (
    <>
      <CallsCounter usageCount={usageCount} usageLimit={usageLimit} usagePct={usagePct} />
      <div className="flex flex-col items-stretch gap-2 lg:gap-3">
        <div className="flex justify-end">
          {authLoading ? (
            <div className="rounded-xl border border-[var(--fp-border)]/50 bg-[var(--fp-bg-card)]/55 px-3 py-2 text-xs font-semibold text-[var(--fp-text-muted)] shadow-inner">
              Checking session...
            </div>
          ) : user ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--fp-success)]/25 bg-[var(--fp-success)]/10 px-3 py-2 shadow-inner">
              <span className="max-w-[180px] truncate text-xs font-semibold text-[var(--fp-accent)]">{user.email}</span>
              <button
                onClick={() => void onLogout()}
                className="rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-accent)] hover:bg-[var(--fp-bg-card)]"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="rounded-xl border border-[var(--fp-accent)]/25 bg-[var(--fp-accent)]/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--fp-accent)] hover:bg-[var(--fp-accent)]/15"
            >
              Login / Signup
            </button>
          )}
        </div>
        <DatePicker
          date={date}
          setDate={setDate}
          selectedDates={selectedDates}
          setSelectedDates={setSelectedDates}
          setStatus={setStatus}
          actions={
            <>
              <button
                type="button"
                onClick={onWarm}
                disabled={!user}
                className="touch-manipulation rounded-xl border border-white/10 bg-[var(--fp-bg-card)]/60 px-4 py-2.5 text-sm font-semibold text-[var(--fp-text)] transition-all hover:bg-[var(--fp-bg-card)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Warm
              </button>
              <button
                type="button"
                onClick={onPredict}
                disabled={!user}
                className="touch-manipulation col-span-2 w-full rounded-xl bg-[var(--fp-accent)] px-6 py-2.5 text-sm font-semibold text-white shadow-atelier transition-all hover:bg-[var(--fp-accent-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1 sm:w-auto"
              >
                Predict
              </button>
            </>
          }
        />
      </div>
    </>
  );
}
