import type { UsageSnapshot } from "../../types/index";

type AdminUsageSnapshotProps = {
  usageSnapshot: UsageSnapshot | null;
  usageLoading: boolean;
  onLoad: () => void;
};

export default function AdminUsageSnapshot({ usageSnapshot, usageLoading, onLoad }: AdminUsageSnapshotProps) {
  return (
    <div className="mt-3 rounded-xl border border-signal-line/60 bg-signal-fog/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-signal-petrol">Instantaneu utilizare API</p>
        <button
          type="button"
          onClick={() => void onLoad()}
          disabled={usageLoading}
          className="rounded-md border border-signal-sage/35 bg-signal-mintSoft/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol disabled:opacity-50"
        >
          {usageLoading ? "Se încarcă..." : "Încarcă utilizarea"}
        </button>
      </div>
      {usageSnapshot && (
        <div className="mt-2 text-[11px] text-signal-inkMuted">
          <p>
            Astăzi: <span className="font-mono font-semibold text-signal-petrol">{usageSnapshot.today.count}/{usageSnapshot.today.limit}</span> | Ieri:{" "}
            <span className="font-mono font-semibold text-signal-petrolMuted">{usageSnapshot.yesterday.count}/{usageSnapshot.yesterday.limit}</span>
          </p>
          <p className="mt-1 text-[10px]">
            Ultimele 7 zile: {usageSnapshot.history.map((row) => `${row.date ?? "-"}=${row.count}`).join(" · ") || "-"}
          </p>
        </div>
      )}
    </div>
  );
}
