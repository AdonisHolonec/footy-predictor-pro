import type { UsageSnapshot } from "../../types/index";

type AdminUsageSnapshotProps = {
  usageSnapshot: UsageSnapshot | null;
  usageLoading: boolean;
  onLoad: () => void;
};

export default function AdminUsageSnapshot({ usageSnapshot, usageLoading, onLoad }: AdminUsageSnapshotProps) {
  return (
    <div className="mt-3 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fp-accent)]">Instantaneu utilizare API</p>
        <button
          type="button"
          onClick={() => void onLoad()}
          disabled={usageLoading}
          className="rounded-md border border-[var(--fp-success)]/35 bg-[var(--fp-success)]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-accent)] disabled:opacity-50"
        >
          {usageLoading ? "Se încarcă..." : "Încarcă utilizarea"}
        </button>
      </div>
      {usageSnapshot && (
        <div className="mt-2 text-[11px] text-[var(--fp-text-muted)]">
          <p>
            Astăzi: <span className="font-mono font-semibold text-[var(--fp-accent)]">{usageSnapshot.today.count}/{usageSnapshot.today.limit}</span> | Ieri:{" "}
            <span className="font-mono font-semibold text-[var(--fp-accent)]">{usageSnapshot.yesterday.count}/{usageSnapshot.yesterday.limit}</span>
          </p>
          <p className="mt-1 text-[10px]">
            Ultimele 7 zile: {usageSnapshot.history.map((row) => `${row.date ?? "-"}=${row.count}`).join(" · ") || "-"}
          </p>
        </div>
      )}
    </div>
  );
}
