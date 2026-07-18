export type * from "../types";

export type { KickoffScope } from "../components/admin/AdminObservatory";

export type UsageSnapshot = {
  today: { date?: string; count: number; limit: number; updatedAt?: string | null };
  yesterday: { date?: string; count: number; limit: number; updatedAt?: string | null };
  history: Array<{ date?: string; count: number; limit: number; updatedAt?: string | null }>;
  cache?: import("../types").CacheHitStats | null;
};

export type PerfAdminSnapshot = {
  byUser: import("../types").PerformanceUserBreakdown[];
  byUserLeague: import("../types").PerformanceUserLeagueBreakdown[];
};

export type PredictionListVariant = "observatory" | "guest";

export type ModelPulse = {
  tone: "healthy" | "watch" | "alert";
  status: string;
};

export type AlertThresholdOverrides = {
  drawdown?: number;
  drift?: number;
  lowDataShare?: number;
};
