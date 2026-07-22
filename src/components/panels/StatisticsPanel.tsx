import { BacktestKpi, RiskAlert } from "../../types";
import { StatTile } from "../../design-system";

export type StatisticsPanelProps = {
  kpi: BacktestKpi | null;
  kpiLoading: boolean;
  riskAlerts: RiskAlert[];
  alertsSeverity: "none" | "medium" | "high";
  draftDrawdownThreshold: number;
  setDraftDrawdownThreshold: (value: number) => void;
  draftDriftThreshold: number;
  setDraftDriftThreshold: (value: number) => void;
  draftLowDataThreshold: number;
  setDraftLowDataThreshold: (value: number) => void;
  alertDrawdownThreshold: number;
  alertDriftThreshold: number;
  alertLowDataThreshold: number;
  hasThresholdDraftChanges: boolean;
  thresholdsSaved: "idle" | "saved" | "reset";
  applyAlertThresholds: () => void;
  resetAlertThresholds: () => void;
  /** Guest header uses max-w-[760px]; observatory uses max-w-full. */
  kpiMaxWidthClass?: string;
  /** Observatory wraps alerting in a <details> disclosure. */
  alertsCollapsible?: boolean;
};

function KpiTiles({
  kpi,
  kpiLoading,
  maxWidthClass
}: {
  kpi: BacktestKpi | null;
  kpiLoading: boolean;
  maxWidthClass: string;
}) {
  return (
    <div className={`mt-3 grid ${maxWidthClass} grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5`}>
      <StatTile
        label="KPI ROI"
        value={`${(kpi?.roi || 0).toFixed(2)}%`}
        loading={kpiLoading}
        tone={(kpi?.roi || 0) >= 0 ? "success" : "danger"}
      />
      <StatTile label="KPI Hit Rate" value={`${(kpi?.hitRate || 0).toFixed(2)}%`} loading={kpiLoading} />
      <StatTile
        label="KPI Drawdown"
        value={`${(kpi?.drawdown || 0).toFixed(2)}u`}
        loading={kpiLoading}
        tone="warning"
      />
      <StatTile label="KPI Settled" value={`${kpi?.settled || 0}`} loading={kpiLoading} />
    </div>
  );
}

function AlertingBlock(props: StatisticsPanelProps) {
  const {
    riskAlerts,
    alertsSeverity,
    draftDrawdownThreshold,
    setDraftDrawdownThreshold,
    draftDriftThreshold,
    setDraftDriftThreshold,
    draftLowDataThreshold,
    setDraftLowDataThreshold,
    alertDrawdownThreshold,
    alertDriftThreshold,
    alertLowDataThreshold,
    hasThresholdDraftChanges,
    thresholdsSaved,
    applyAlertThresholds,
    resetAlertThresholds
  } = props;

  return (
    <div
      className={`${props.alertsCollapsible ? "mt-3" : "mt-2 max-w-[760px]"} rounded-card border px-3 py-2.5 ${
        alertsSeverity === "high"
          ? "border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10"
          : alertsSeverity === "medium"
            ? "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10"
            : "border-[var(--fp-success)]/30 bg-[var(--fp-success)]/10"
      }`}
    >
      <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">
        Auto alerting
      </div>
      <div className="mt-1 text-xs font-medium text-[var(--fp-text)]">
        {riskAlerts.length ? riskAlerts.map((a) => a.message).join(" • ") : "No active risk alerts"}
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-[10px] font-semibold text-[var(--fp-text-muted)]">
          DD
          <input
            type="number"
            min={0.5}
            max={20}
            step={0.1}
            value={draftDrawdownThreshold}
            onChange={(e) => setDraftDrawdownThreshold(Number(e.target.value))}
            className="w-full rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-1.5 font-mono text-[11px] text-[var(--fp-text)]"
          />
        </label>
        <label className="flex items-center gap-2 text-[10px] font-semibold text-[var(--fp-text-muted)]">
          Drift
          <input
            type="number"
            min={5}
            max={100}
            step={1}
            value={draftDriftThreshold}
            onChange={(e) => setDraftDriftThreshold(Number(e.target.value))}
            className="w-full rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-1.5 font-mono text-[11px] text-[var(--fp-text)]"
          />
        </label>
        <label className="flex items-center gap-2 text-[10px] font-semibold text-[var(--fp-text-muted)]">
          LowData
          <input
            type="number"
            min={0.05}
            max={0.95}
            step={0.01}
            value={draftLowDataThreshold}
            onChange={(e) => setDraftLowDataThreshold(Number(e.target.value))}
            className="w-full rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-1.5 font-mono text-[11px] text-[var(--fp-text)]"
          />
        </label>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          onClick={() => void applyAlertThresholds()}
          disabled={!hasThresholdDraftChanges}
          className="rounded-lg bg-[var(--fp-accent)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-[var(--fp-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply thresholds
        </button>
        <button
          onClick={() => void resetAlertThresholds()}
          className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text)] hover:bg-[var(--fp-bg-card)]"
        >
          Reset defaults
        </button>
        {thresholdsSaved !== "idle" && (
          <span className="rounded-lg border border-[var(--fp-success)]/30 bg-[var(--fp-success)]/10 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-success)]">
            {thresholdsSaved === "saved" ? "Saved" : "Defaults restored"}
          </span>
        )}
      </div>
      <div className="mt-2 font-mono text-[9px] font-medium uppercase tracking-wide text-[var(--fp-text-muted)]">
        Active thresholds: DD {alertDrawdownThreshold.toFixed(2)} | Drift {alertDriftThreshold.toFixed(0)} | LowData{" "}
        {(alertLowDataThreshold * 100).toFixed(0)}%
      </div>
    </div>
  );
}

export default function StatisticsPanel(props: StatisticsPanelProps) {
  const kpiMaxWidthClass = props.kpiMaxWidthClass ?? "max-w-[760px]";
  const kpiTiles = (
    <KpiTiles kpi={props.kpi} kpiLoading={props.kpiLoading} maxWidthClass={kpiMaxWidthClass} />
  );

  if (props.alertsCollapsible) {
    return (
      <>
        <div className="mt-4 grid max-w-full grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
          <StatTile
            label="KPI ROI"
            value={`${(props.kpi?.roi || 0).toFixed(2)}%`}
            loading={props.kpiLoading}
            tone={(props.kpi?.roi || 0) >= 0 ? "success" : "danger"}
          />
          <StatTile label="KPI Hit Rate" value={`${(props.kpi?.hitRate || 0).toFixed(2)}%`} loading={props.kpiLoading} />
          <StatTile
            label="KPI Drawdown"
            value={`${(props.kpi?.drawdown || 0).toFixed(2)}u`}
            loading={props.kpiLoading}
            tone="warning"
          />
          <StatTile label="KPI Settled" value={`${props.kpi?.settled || 0}`} loading={props.kpiLoading} />
        </div>
        <details className="mt-3 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)]">
          <summary className="cursor-pointer font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fp-text-muted)]">
            Auto alerting & thresholds
          </summary>
          <AlertingBlock {...props} />
        </details>
      </>
    );
  }

  return (
    <>
      {kpiTiles}
      <AlertingBlock {...props} />
    </>
  );
}
