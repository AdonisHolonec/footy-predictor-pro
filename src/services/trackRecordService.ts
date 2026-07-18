export type TrackRecordSummary = {
  settled: number;
  wins: number;
  losses: number;
  hitRate: number;
  roi: number;
  pnlUnits: number;
  drawdown: number;
  totalStake: number;
  expectedValue: number;
};

export type TrackRecordTrendPoint = {
  date?: string | null;
  i?: number;
  hitRate?: number | null;
  roi?: number | null;
  settled?: number | null;
  pnlUnits: number;
};

export type PublicTrackRecord = {
  ok: boolean;
  public: boolean;
  source: "snapshots" | "live_settled";
  days: number;
  asOf: string;
  summary: TrackRecordSummary;
  trend: TrackRecordTrendPoint[];
  byMarket?: Array<{ key: string; settled: number; hitRate: number; roi: number }>;
  disclaimer: string;
  error?: string;
};

export async function loadPublicTrackRecord(days: 30 | 45 | 90 = 45): Promise<PublicTrackRecord> {
  const res = await fetch(`/api/backtest?view=public-track&days=${days}`);
  const json = (await res.json()) as PublicTrackRecord;
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || "Nu am putut încărca track record-ul public.");
  }
  return json;
}
