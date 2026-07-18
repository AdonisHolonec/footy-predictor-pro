import { RiskAlert } from "../types";
import type { AlertThresholdOverrides } from "../types/index";

export type LoadAlertsResult = {
  alerts: RiskAlert[];
  severity: "none" | "medium" | "high";
};

export async function loadAlerts(
  days = 7,
  thresholds: Required<AlertThresholdOverrides>
): Promise<LoadAlertsResult> {
  const qs = new URLSearchParams({
    days: String(days),
    drawdown: String(thresholds.drawdown),
    drift: String(thresholds.drift),
    lowDataShare: String(thresholds.lowDataShare)
  });
  const res = await fetch(`/api/alerts?${qs.toString()}`);
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca alertele.");
  return {
    alerts: Array.isArray(json.alerts) ? json.alerts : [],
    severity: json.severity === "high" || json.severity === "medium" ? json.severity : "none"
  };
}
