import { useMemo } from "react";
import type { HistoryEntry } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Card from "../../design-system/Card";

type Props = {
  history: HistoryEntry[];
};

const BANDS: { min: number; max: number; labelKey: string }[] = [
  { min: 50, max: 60, labelKey: "stats.calibrationBand5059" },
  { min: 60, max: 70, labelKey: "stats.calibrationBand6069" },
  { min: 70, max: 80, labelKey: "stats.calibrationBand7079" },
  { min: 80, max: 90, labelKey: "stats.calibrationBand8089" },
  { min: 90, max: 101, labelKey: "stats.calibrationBand90plus" }
];

export default function CalibrationChart({ history }: Props) {
  const { t } = useLocale();

  const buckets = useMemo(() => {
    return BANDS.map((band) => {
      const rows = history.filter((h) => {
        if (h.validation !== "win" && h.validation !== "loss") return false;
        const c = Number(h.recommended?.confidence);
        return Number.isFinite(c) && c >= band.min && c < band.max;
      });
      const n = rows.length;
      if (!n) return { ...band, n: 0, avgConf: 0, hitRate: 0 };
      const avgConf = rows.reduce((s, r) => s + Number(r.recommended?.confidence || 0), 0) / n;
      const wins = rows.filter((r) => r.validation === "win").length;
      return { ...band, n, avgConf, hitRate: (wins / n) * 100 };
    }).filter((b) => b.n > 0);
  }, [history]);

  if (!buckets.length) return null;

  return (
    <Card>
      <h2 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
        {t("stats.calibrationTitle")}
      </h2>
      <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("stats.calibrationSub")}</p>
      <div className="mt-4 space-y-3">
        {buckets.map((b) => (
          <div key={b.labelKey}>
            <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--fp-text-muted)]">
              <span>
                {t(b.labelKey)} · {t("stats.calibrationSampleSize", { n: b.n })}
              </span>
              <span className="tabular-nums text-[var(--fp-text)]">
                {t("stats.calibrationPredicted")} {Math.round(b.avgConf)}% · {t("stats.calibrationActual")}{" "}
                {Math.round(b.hitRate)}%
              </span>
            </div>
            <div className="relative mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[var(--fp-bg-muted)]">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--fp-accent)]/30"
                style={{ width: `${Math.min(100, b.avgConf)}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--fp-accent)]"
                style={{ width: `${Math.min(100, b.hitRate)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
