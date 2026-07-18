import { AdminModelMetricsPanel } from "../admin/AdminObservatory";

type BacktestPanelProps = {
  accessToken: string;
  days?: number;
};

export default function BacktestPanel({ accessToken, days = 45 }: BacktestPanelProps) {
  return (
    <div className="mt-6">
      <AdminModelMetricsPanel accessToken={accessToken} days={days} />
    </div>
  );
}
