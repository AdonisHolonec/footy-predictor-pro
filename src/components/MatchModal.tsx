import { useEffect, useRef, useState } from "react";
import { useLocale } from "../context/LocaleContext";
import CollapsiblePanel from "../design-system/CollapsiblePanel";
import LuckBadge from "./LuckBadge";
import XGPerformanceBar from "./XGPerformanceBar";
import ConfidenceEnginePanel from "./ConfidenceEnginePanel";
import ExplanationCard from "./ExplanationCard";
import FeatureImportanceChart from "./FeatureImportanceChart";
import PredictionContributionsChart from "./PredictionContributionsChart";
import ValueCard from "./ValueCard";
import PredictionLaboratoryPanel from "./PredictionLaboratory";
import MonteCarloPanel from "./MonteCarloPanel";
import {
  ConfidenceAura,
  deriveDataQuality,
  deriveSignalEdge,
  EdgeCompass,
  FormRibbon,
  SignalLens
} from "./SignalLab";
import { LeagueStandingEntry, MarketTier, MarketTierInfo, MatchScore, PoissonMarketProbs, PredictionRow, TeamStandingsFormSnapshot, XGData } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";
import {
  buildSpecialBetLegs,
  outcomeTextClass,
  specialBetCombinedOdd as specialBetCombinedOddValue,
  specialBetCombinedOutcome
} from "../utils/specialBet";

/**
 * Stil vizual pentru un pick în funcţie de nivelul de încredere.
 * `toss` înseamnă practic 50/50 — UI trebuie să clarifice asta explicit.
 */
function tierToneClass(tier: MarketTier | undefined): string {
  switch (tier) {
    case "strong":
      return "border-signal-sage/35 bg-signal-sage/8 text-signal-sage";
    case "lean":
      return "border-signal-petrol/35 bg-signal-petrol/8 text-signal-petrol";
    case "toss":
      return "border-signal-amber/30 bg-signal-amber/8 text-signal-amberSoft";
    case "lean_off":
      return "border-signal-rose/25 bg-signal-rose/5 text-signal-rose/90";
    case "strong_off":
      return "border-signal-rose/40 bg-signal-rose/10 text-signal-rose";
    default:
      return "border-white/10 bg-signal-void/40 text-signal-silver";
  }
}

function tierBadgeLabel(tier: MarketTier | undefined, tr: (key: string) => string): string {
  switch (tier) {
    case "strong":
      return tr("match.tierStrong");
    case "lean":
      return tr("match.tierLean");
    case "toss":
      return tr("match.tierToss");
    case "lean_off":
      return tr("match.tierLeanOff");
    case "strong_off":
      return tr("match.tierStrongOff");
    default:
      return "";
  }
}

/** Derive a fallback MarketTierInfo din probabilităţile brute (pentru istoricul vechi fără `marketTiers`). */
function fallbackTierFromProb(pickLabel: string, probForPick: number | null): MarketTierInfo | undefined {
  if (probForPick == null || !Number.isFinite(probForPick)) return undefined;
  const p = Math.max(0, Math.min(100, probForPick));
  let tier: MarketTier;
  if (p >= 65) tier = "strong";
  else if (p >= 55) tier = "lean";
  else if (p >= 45) tier = "toss";
  else if (p >= 35) tier = "lean_off";
  else tier = "strong_off";
  return { pick: pickLabel, prob: Number(p.toFixed(1)), tier };
}

/** Etichetă prietenoasă pentru un key de linie stil "o8_5" → "Over 8.5". */
function formatLineKey(key: string): string {
  const m = key.match(/^o(\d+)_(\d+)$/);
  if (!m) return key;
  return `Over ${m[1]}.${m[2]}`;
}

function parseLineThreshold(key: string): number | null {
  const m = key.match(/^o(\d+)_(\d+)$/);
  if (!m) return null;
  return Number(`${m[1]}.${m[2]}`);
}

function deriveBestOverUnderPick(
  totalLines?: Record<string, number>
): { pick: string; probability: number; line: number } | null {
  if (!totalLines) return null;
  const entries = Object.entries(totalLines).filter(([, v]) => Number.isFinite(Number(v)));
  if (!entries.length) return null;
  let best: { pick: string; probability: number; line: number } | null = null;
  for (const [key, rawProb] of entries) {
    const line = parseLineThreshold(key);
    if (line == null) continue;
    const pOver = Math.max(0, Math.min(100, Number(rawProb)));
    const overCandidate = { pick: `Over ${line.toFixed(1)}`, probability: pOver, line };
    const underCandidate = { pick: `Under ${line.toFixed(1)}`, probability: 100 - pOver, line };
    const chosen = overCandidate.probability >= underCandidate.probability ? overCandidate : underCandidate;
    if (!best || chosen.probability > best.probability) best = chosen;
  }
  return best;
}

function deriveRecommendedOdd(match: PredictionRow): number | null {
  const explicit = Number(match.recommended?.odd);
  if (Number.isFinite(explicit) && explicit > 1) return explicit;
  const pick = String(match.recommended?.pick || "").trim().toLowerCase();
  if (!pick) return null;
  if (pick === "1") return Number.isFinite(Number(match.odds?.home)) ? Number(match.odds?.home) : null;
  if (pick === "x") return Number.isFinite(Number(match.odds?.draw)) ? Number(match.odds?.draw) : null;
  if (pick === "2") return Number.isFinite(Number(match.odds?.away)) ? Number(match.odds?.away) : null;
  if (pick === "gg") return Number.isFinite(Number(match.marketOdds?.btts?.odd)) ? Number(match.marketOdds?.btts?.odd) : null;
  const ou = pick.match(/^(peste|sub)\s*(1[.,]5|2[.,]5|3[.,]5)$/);
  if (ou) {
    const line = ou[2].replace(",", ".");
    const quote =
      line === "1.5" ? match.marketOdds?.goals15 : line === "2.5" ? match.marketOdds?.goals25 : match.marketOdds?.goals35;
    const overOdd = Number(quote?.odd);
    if (!Number.isFinite(overOdd) || overOdd <= 1) return null;
    if (ou[1] === "peste") return overOdd;
    const underOdd = overOdd / (overOdd - 1);
    return Number.isFinite(underOdd) ? underOdd : null;
  }
  return null;
}

function marketResultBadge(
  predicted: string,
  probability: number,
  verdict: boolean | null,
  odd?: number | null,
  source?: string | null,
  tone: "corners" | "shots" | "ht" | "neutral" = "neutral"
) {
  const base = "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide";
  const oddText = Number.isFinite(Number(odd)) ? ` · ${Number(odd).toFixed(2)}` : " · N/A";
  const srcText = source ? ` · ${source}` : "";
  const pred = `${predicted} · ${Math.round(probability)}%${oddText}${srcText}`;
  const isHot = probability >= 85;
  const toneClass =
    tone === "corners"
      ? "border-[var(--fp-accent)]/45 bg-[var(--fp-accent-muted)] text-[var(--fp-text)]"
      : tone === "shots"
        ? "border-violet-500/40 bg-violet-500/10 text-[var(--fp-text)]"
        : tone === "ht"
          ? "border-[var(--fp-warning)]/45 bg-[var(--fp-warning)]/10 text-[var(--fp-text)]"
          : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text)]";
  const pulseClass = isHot ? " animate-pulse motion-reduce:animate-none ring-1 ring-white/35" : "";
  if (verdict === true) {
    return (
      <span className={`${base} border-[var(--fp-success)]/45 bg-[var(--fp-success)]/15 text-[var(--fp-text)]${pulseClass}`}>
        {pred} · WIN
      </span>
    );
  }
  if (verdict === false) {
    return (
      <span className={`${base} border-[var(--fp-danger)]/45 bg-[var(--fp-danger)]/15 text-[var(--fp-text)]${pulseClass}`}>
        {pred} · LOSE
      </span>
    );
  }
  return <span className={`${base} ${toneClass}${pulseClass}`}>{pred} · OPEN</span>;
}

/**
 * Randează un bloc Poisson (cornere / şuturi la poartă / total şuturi) cu:
 * - header cu λ & total aşteptat
 * - linii Over pe total, cu probabilităţi (verde la peste 60%, amber 40-60, gri sub)
 * - linii Over pe echipă (home vs away), dacă există
 */
function PoissonMarketSection({
  title,
  subtitle,
  accent,
  icon,
  data,
  homeLabel,
  awayLabel,
  actualTotal,
  quotedOdd,
  quoteSource,
  badgeTone = "neutral",
  framed = true
}: {
  title: string;
  subtitle: string;
  accent: string;
  icon: string;
  data: PoissonMarketProbs;
  homeLabel: string;
  awayLabel: string;
  actualTotal?: number | null;
  quotedOdd?: number | null;
  quoteSource?: string | null;
  badgeTone?: "corners" | "shots" | "ht" | "neutral";
  framed?: boolean;
}) {
  const { t: tr } = useLocale();
  const totalKeys = Object.keys(data.total || {});
  const homeKeys = Object.keys(data.home || {});
  const awayKeys = Object.keys(data.away || {});
  const hasTeamLines = homeKeys.length > 0 || awayKeys.length > 0;
  const bestPick = deriveBestOverUnderPick(data.total);
  const settled =
    bestPick && actualTotal != null
      ? bestPick.pick.startsWith("Over")
        ? actualTotal > bestPick.line
        : actualTotal < bestPick.line
      : null;

  const toneClass = (pct: number) => {
    if (pct >= 60) return "text-signal-sage";
    if (pct >= 40) return "text-signal-amberSoft";
    return "text-signal-inkMuted";
  };

  return (
    <section
      className={framed ? "rounded-2xl border p-4 shadow-inner sm:p-5" : "p-0"}
      style={
        framed
          ? { borderColor: `${accent}40`, background: `linear-gradient(180deg, ${accent}0d, transparent)` }
          : undefined
      }
    >
      {framed ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-white/5 pb-2">
          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: accent }}>
              {icon} {title}
            </h3>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">{subtitle}</p>
          </div>
          <div className="text-right font-mono text-[10px] tabular-nums">
            <div className="text-signal-silver">
              λ · {data.lambdaHome.toFixed(1)} vs {data.lambdaAway.toFixed(1)}
            </div>
            <div className="text-[9px] text-signal-inkMuted">
              total aşteptat ≈ {data.expectedTotal.toFixed(1)}
              {data.usedFallback ? " · fallback" : ""}
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-3 text-right font-mono text-[10px] tabular-nums text-signal-silver">
          λ · {data.lambdaHome.toFixed(1)} vs {data.lambdaAway.toFixed(1)} · ≈ {data.expectedTotal.toFixed(1)}
          {data.usedFallback ? " · fallback" : ""}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* TOTAL */}
        <div>
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">{tr("match.poissonTotal")}</div>
          <table className="w-full font-mono text-[10px] tabular-nums">
            <tbody>
              {totalKeys.map((k) => {
                const pct = data.total[k];
                return (
                  <tr key={k} className="border-t border-white/5">
                    <td className="py-1 pr-2 text-signal-silver">{formatLineKey(k)}</td>
                    <td className={`py-1 pl-2 text-right ${toneClass(pct)}`}>{pct.toFixed(0)}%</td>
                  </tr>
                );
              })}
              <tr className="border-t border-white/5">
                <td className="py-1 pr-2 text-[9px] uppercase tracking-wider text-signal-inkMuted">{tr("match.mostLikely")}</td>
                <td className="py-1 pl-2 text-right text-signal-amberSoft">{data.mostProbableTotal}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* TEAM LINES */}
        {hasTeamLines ? (
          <div>
            <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">{tr("match.perTeamOver")}</div>
            <table className="w-full font-mono text-[10px] tabular-nums">
              <thead className="text-left text-[9px] uppercase tracking-wider text-signal-inkMuted">
                <tr>
                  <th className="py-1"></th>
                  <th className="py-1 text-right" title={homeLabel}>
                    {homeLabel.slice(0, 12)}
                  </th>
                  <th className="py-1 text-right" title={awayLabel}>
                    {awayLabel.slice(0, 12)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {homeKeys.map((k) => {
                  const hp = data.home[k];
                  const ap = data.away[k] ?? 0;
                  return (
                    <tr key={k} className="border-t border-white/5">
                      <td className="py-1 pr-2 text-signal-silver">{formatLineKey(k)}</td>
                      <td className={`py-1 pl-2 text-right ${toneClass(hp)}`}>{hp.toFixed(0)}%</td>
                      <td className={`py-1 pl-2 text-right ${toneClass(ap)}`}>{ap.toFixed(0)}%</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-white/5">
                  <td className="py-1 pr-2 text-[9px] uppercase tracking-wider text-signal-inkMuted">Modal</td>
                  <td className="py-1 pl-2 text-right text-signal-amberSoft">{data.mostProbableHome}</td>
                  <td className="py-1 pl-2 text-right text-signal-amberSoft">{data.mostProbableAway}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {(data.sampleHome != null || data.sampleAway != null || data.leagueBaseline != null) && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/5 pt-2 font-mono text-[9px] text-signal-inkMuted">
          {data.sampleHome != null && <span>n gazde · {data.sampleHome}</span>}
          {data.sampleAway != null && <span>n oaspeţi · {data.sampleAway}</span>}
          {data.leagueBaseline != null && <span>medie ligă · {data.leagueBaseline.toFixed(1)}</span>}
          {data.usedFallback && <span className="text-signal-amber">⚠ fallback (rolling stats incomplete)</span>}
        </div>
      )}
      {bestPick && (
        <div className="mt-3 border-t border-white/5 pt-2">
          {marketResultBadge(bestPick.pick, bestPick.probability, settled, quotedOdd, quoteSource, badgeTone)}
          {actualTotal != null && (
            <span className="ml-2 font-mono text-[9px] text-signal-inkMuted">
              {tr("match.finalTotal")} {actualTotal}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** Mini-card pentru un pick în secţiunea „Pieţe & scor" — afişează probabilitatea + badge încredere. */
function MarketPickCard({
  label,
  info
}: {
  label: string;
  info: MarketTierInfo | undefined;
}) {
  const { t: tr } = useLocale();
  const tone = tierToneClass(info?.tier);
  const badge = tierBadgeLabel(info?.tier, tr);
  const isToss = info?.tier === "toss";
  return (
    <div className={`rounded-xl border p-3 text-center ${tone}`}>
      <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">
        <span>{label}</span>
        {badge ? (
          <span
            className={`rounded-sm px-1 py-[1px] text-[8.5px] font-bold tracking-wider ${
              isToss ? "bg-signal-amber/20 text-signal-amber" : ""
            }`}
            title={
              info?.tier === "toss"
                ? "Probabilităţile sunt practic 50/50 — modelul nu are direcţie clară"
                : undefined
            }
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline justify-center gap-1.5">
        <span className="font-mono text-sm font-semibold">{info?.pick ?? "—"}</span>
        {info?.prob != null && Number.isFinite(info.prob) ? (
          <span className="font-mono text-[10px] tabular-nums opacity-80">
            {isToss ? "≈ " : ""}
            {info.prob.toFixed(0)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

type MatchModalProps = {
  match: PredictionRow;
  logoColors: Record<string, string>;
  onClose: () => void;
  hashColor: (seed: string) => string;
  canShowSpecialBet?: boolean;
  /** Effective access tier — avoids false upgrade locks for premium/ultra. */
  accessTier?: "free" | "premium" | "ultra" | string;
  /** Enterprise UI V2: right drawer (desktop) / bottom sheet (mobile). */
  presentation?: "modal" | "focus";
  /** Called when user clicks a plan-locked control. */
  onUpgradeRequired?: (feature: string, requiredTier: "premium" | "ultra") => void;
};

function isFinalStatus(status?: string) {
  return ["FT", "AET", "PEN"].includes(status || "");
}

function evaluateTopPick(pick: string, score?: MatchScore): boolean | null {
  if (!pick || !score) return null;
  if (score.home === null || score.away === null) return null;
  const home = score.home;
  const away = score.away;
  const total = home + away;
  const normalized = pick.trim().toLowerCase();

  if (normalized === "1") return home > away;
  if (normalized === "2") return away > home;
  if (normalized === "x") return home === away;
  if (normalized === "gg") return home > 0 && away > 0;
  if (normalized === "ngg") return home === 0 || away === 0;

  const overMatch = normalized.match(/peste\s*(\d+(?:[.,]\d+)?)/);
  if (overMatch) return total > Number(overMatch[1].replace(",", "."));
  const underMatch = normalized.match(/sub\s*(\d+(?:[.,]\d+)?)/);
  if (underMatch) return total < Number(underMatch[1].replace(",", "."));
  return null;
}

function finalScoreBadgeClass(result: boolean | null) {
  if (result === true) return "text-signal-sage border-signal-sage/35 bg-signal-sage/10";
  if (result === false) return "text-signal-rose border-signal-rose/30 bg-signal-rose/10";
  return "text-signal-inkMuted border-white/10 bg-signal-void/50";
}

function finalScoreLabel(result: boolean | null) {
  if (result === true) return "WIN";
  if (result === false) return "LOSE";
  return "FINAL";
}

function formatLambda(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function TeamSnapshotCard({
  title,
  snap,
  accent
}: {
  title: string;
  snap?: TeamStandingsFormSnapshot | null;
  accent: string;
}) {
  const { t } = useLocale();
  if (!snap) {
    return (
      <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 text-center shadow-[var(--fp-shadow-sm)]">
        <div className="text-[10px] font-bold uppercase text-[var(--fp-text-muted)]">{title}</div>
        <p className="mt-1.5 text-sm text-[var(--fp-text-muted)]">{t("match.noStandings")}</p>
      </div>
    );
  }
  return (
    <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)]">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{title}</div>
      <div className="flex flex-wrap items-baseline gap-2">
        {snap.rank != null && (
          <span className="font-display text-xl font-bold tabular-nums" style={{ color: accent }}>
            #{snap.rank}
          </span>
        )}
        {snap.points != null && (
          <span className="text-sm font-bold tabular-nums text-[var(--fp-text)]">
            {snap.points} {t("match.points")}
          </span>
        )}
        {snap.played != null && (
          <span className="text-xs font-medium text-[var(--fp-text-muted)]">
            · {snap.played} {t("match.matches")}
          </span>
        )}
      </div>
      <div className="mt-1.5 text-sm font-semibold tabular-nums text-[var(--fp-text)]">
        GF {snap.goalsFor ?? "—"} · GA {snap.goalsAgainst ?? "—"}
        {snap.goalsDiff != null && (
          <span className="text-[var(--fp-text-muted)]">
            {" "}
            · GD {snap.goalsDiff > 0 ? "+" : ""}
            {snap.goalsDiff}
          </span>
        )}
      </div>
      {snap.form ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-bold uppercase text-[var(--fp-text-muted)]">{t("match.form")}</div>
          <div className="flex flex-wrap gap-1">
            {snap.form.split("").map((ch, i) => (
              <span
                key={`${ch}-${i}`}
                className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border text-[10px] font-bold ${
                  ch === "W"
                    ? "border-[var(--fp-success)]/40 bg-[var(--fp-success)]/15 text-[var(--fp-success)]"
                    : ch === "L"
                      ? "border-[var(--fp-danger)]/40 bg-[var(--fp-danger)]/15 text-[var(--fp-danger)]"
                      : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"
                }`}
              >
                {ch}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LeagueStandingsTable({
  rows,
  highlightHomeId,
  highlightAwayId
}: {
  rows: LeagueStandingEntry[];
  highlightHomeId?: number;
  highlightAwayId?: number;
}) {
  const { t } = useLocale();
  return (
    <div className="max-h-56 overflow-auto rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)]">
      <table className="w-full min-w-[480px] text-left text-xs">
        <thead className="sticky top-0 z-[1] bg-[var(--fp-navy)] text-white">
          <tr className="uppercase tracking-wide">
            <th className="px-2 py-2 font-bold">#</th>
            <th className="px-2 py-2 font-bold">{t("match.team")}</th>
            <th className="px-2 py-2 font-bold">{t("match.played")}</th>
            <th className="px-2 py-2 font-bold">{t("match.points")}</th>
            <th className="px-2 py-2 font-bold">{t("match.gfGa")}</th>
            <th className="px-2 py-2 font-bold">{t("match.form")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hi = r.teamId === highlightHomeId || r.teamId === highlightAwayId;
            return (
              <tr
                key={r.teamId}
                className={`border-t border-[var(--fp-border)] ${hi ? "bg-[var(--fp-accent-muted)]" : "bg-[var(--fp-bg-card)] hover:bg-[var(--fp-bg-muted)]"}`}
              >
                <td className="px-2 py-1.5 font-semibold tabular-nums text-[var(--fp-text)]">{r.rank ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    {r.logo ? <img src={r.logo} alt="" className="h-5 w-5 shrink-0 object-contain" /> : null}
                    <span className={`font-semibold ${hi ? "text-[var(--fp-accent)]" : "text-[var(--fp-text)]"}`}>
                      {r.teamName}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-1.5 tabular-nums text-[var(--fp-text-muted)]">{r.played ?? "—"}</td>
                <td className="px-2 py-1.5 font-bold tabular-nums text-[var(--fp-text)]">{r.points ?? "—"}</td>
                <td className="px-2 py-1.5 tabular-nums text-[var(--fp-text-muted)]">
                  {r.goalsFor ?? "—"}-{r.goalsAgainst ?? "—"}
                </td>
                <td className="px-2 py-1.5 font-semibold tracking-tight text-[var(--fp-text)]">{r.form || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const DETAIL_TABS = [
  { id: "overview", labelKey: "match.tabOverview" },
  { id: "prediction", labelKey: "match.tabPrediction" },
  { id: "statistics", labelKey: "nav.statistics" },
  { id: "h2h", labelKey: "match.tabH2h" },
  { id: "form", labelKey: "match.tabForm" },
  { id: "xg", labelKey: "match.tabXg" },
  { id: "montecarlo", labelKey: "match.tabMc" },
  { id: "value", labelKey: "match.tabValue" },
  { id: "odds", labelKey: "match.tabMarkets" },
  { id: "why", labelKey: "match.tabWhy" },
  { id: "timeline", labelKey: "match.tabLabs" }
] as const;

type DetailTabId = (typeof DETAIL_TABS)[number]["id"];

export default function MatchModal({
  match,
  logoColors,
  onClose,
  hashColor,
  canShowSpecialBet = false,
  accessTier = "free",
  presentation = "focus",
  onUpgradeRequired
}: MatchModalProps) {
  const { t: tr } = useLocale();
  const [specialLegCount, setSpecialLegCount] = useState<2 | 3>(2);
  const [detailTab, setDetailTab] = useState<DetailTabId>("overview");
  const tab = (ids: DetailTabId[]) => (ids.includes(detailTab) ? "" : "hidden");
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [xgData, setXgData] = useState<XGData | null>(() => {
    if (!match.luckStats) return null;
    return { homeXG: match.luckStats.hXG, awayXG: match.luckStats.aXG };
  });

  useEffect(() => {
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const tm = setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      clearTimeout(tm);
      prevFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = modalRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/fixtures?view=xg&fixtureId=${match.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && !data?.error) setXgData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [match.id]);

  if (match.insufficientData) {
    const table = match.leagueStandings;
    const ctx = match.teamContext;
    const hasRich = Boolean((table && table.length > 0) || ctx?.home || ctx?.away);
    const homeColor = logoColors[match.logos?.home || ""] || hashColor(match.teams.home);
    const awayColor = logoColors[match.logos?.away || ""] || hashColor(match.teams.away);
    const hid = match.fixtureTeamIds?.home;
    const aid = match.fixtureTeamIds?.away;

    if (!hasRich) {
      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-signal-void/85 p-3 backdrop-blur-md sm:p-4"
          onClick={onClose}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-signal-amber/25 bg-signal-panel/90 p-8 text-center shadow-atelierLg backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-lg font-semibold text-signal-ink">{tr("match.insufficientTitle")}</p>
            <p className="mt-2 text-sm leading-relaxed text-signal-inkMuted">{match.insufficientReason}</p>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="mt-6 rounded-xl border border-signal-line bg-signal-fog px-4 py-2.5 text-sm font-semibold text-signal-petrol hover:bg-signal-panel hover:text-signal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/45"
            >
              {tr("match.close")}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-signal-void/88 p-3 backdrop-blur-md sm:p-4"
        onClick={onClose}
      >
        <div
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-signal-amber/25 bg-signal-panel/95 p-5 shadow-atelierLg backdrop-blur-xl sm:max-w-2xl sm:p-8"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="match-modal-insufficient-title"
          aria-describedby="match-modal-insufficient-desc"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p id="match-modal-insufficient-title" className="font-display text-lg font-semibold text-signal-ink">{tr("match.insufficientTitle")}</p>
              <p id="match-modal-insufficient-desc" className="mt-1 text-[11px] text-signal-inkMuted">{match.insufficientReason}</p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-sm text-signal-inkMuted hover:border-signal-petrol/40 hover:text-signal-petrol focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/45"
              aria-label={tr("match.close")}
            >
              ✕
            </button>
          </div>
          <p className="mt-4 text-center font-display text-base font-semibold text-signal-ink">
            {match.teams.home} <span className="text-signal-inkMuted">vs</span> {match.teams.away}
          </p>
          <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-wide text-signal-petrol/70">{match.league}</p>

          {(ctx?.home || ctx?.away) && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <TeamSnapshotCard title={tr("match.home")} snap={ctx?.home} accent={homeColor} />
              <TeamSnapshotCard title={tr("match.away")} snap={ctx?.away} accent={awayColor} />
            </div>
          )}

          {table && table.length > 0 ? (
            <div className="mt-6">
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">{tr("match.standings")}</h3>
              <LeagueStandingsTable rows={table} highlightHomeId={hid} highlightAwayId={aid} />
            </div>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="mt-8 w-full rounded-xl border border-signal-line bg-signal-fog py-2.5 text-sm font-semibold text-signal-petrol hover:bg-signal-panel hover:text-signal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/45"
          >
            {tr("match.close")}
          </button>
        </div>
      </div>
    );
  }

  const homeColor = logoColors[match.logos?.home || ""] || hashColor(match.teams.home);
  const awayColor = logoColors[match.logos?.away || ""] || hashColor(match.teams.away);
  const pct = (n: number) => Math.round(n || 0);
  const hasFinalScore =
    isFinalStatus(match.status) &&
    match.score?.home !== null &&
    match.score?.away !== null &&
    match.score?.home !== undefined &&
    match.score?.away !== undefined;
  const hasNumericScore = match.score != null && typeof match.score.home === "number" && typeof match.score.away === "number";
  const koMs = new Date(match.kickoff).getTime();
  const pastKickoffPollWindow = Number.isFinite(koMs) && Date.now() >= koMs - 15 * 60 * 1000;
  /** Scor în desfășurare: status „live” sau încă NS dar după fereastra de start (poll actualizează). */
  const hasLiveScore =
    hasNumericScore &&
    !hasFinalScore &&
    (isFixtureInPlay(match.status) || (pastKickoffPollWindow && !isFinalStatus(match.status)));
  const finalPickResult = hasFinalScore ? evaluateTopPick(match.recommended.pick, match.score) : null;
  const kickoffDate = new Date(match.kickoff);
  const hasExactConfidence =
    match.recommended?.confidence != null && Number.isFinite(Number(match.recommended?.confidence));
  const confPct = hasExactConfidence ? pct(match.recommended?.confidence) : 0;
  const confidenceCategory = match.recommended?.confidenceCategory || null;
  const isPremiumLike = !hasExactConfidence && Boolean(confidenceCategory);
  const isFreeLike = !hasExactConfidence && !confidenceCategory;
  const effectiveAccessTier = String(accessTier || "free").toLowerCase();
  const showTierUpgradeLocks = effectiveAccessTier === "free" || effectiveAccessTier === "premium";
  const edgeScore = deriveSignalEdge(match);
  const dq = deriveDataQuality(match);

  const ProbBar = ({ label, val, color }: { label: string; val: number; color: string }) => (
    <div className="mb-4">
      <div className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">
        <span>{label}</span>
        <span className="font-mono tabular-nums" style={{ color }}>
          {pct(val)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-signal-void ring-1 ring-white/5">
        <div style={{ width: `${val}%`, backgroundColor: color }} className="h-full rounded-full" />
      </div>
    </div>
  );

  const pr = match.probs;
  const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
  const ext = {
    pDC1X: pr.pDC1X ?? clamp100(pr.p1 + pr.pX),
    pDC12: pr.pDC12 ?? clamp100(pr.p1 + pr.p2),
    pDCX2: pr.pDCX2 ?? clamp100(pr.pX + pr.p2),
    pU15: pr.pU15 ?? clamp100(100 - pr.pO15),
    pNGG: pr.pNGG ?? clamp100(100 - pr.pGG),
    pU25: pr.pU25 ?? clamp100(100 - pr.pO25)
  };
  const standingsRows = match.leagueStandings;
  const showStandingsBlock =
    Boolean(match.teamContext?.home || match.teamContext?.away || (standingsRows && standingsRows.length > 0));
  const firstHalfPick = match.probs.firstHalf
    ? (() => {
        const pOver = match.probs.firstHalf.pO15;
        if (!Number.isFinite(pOver)) return null;
        return pOver >= 50
          ? { pick: "Over 1.5 FH", probability: pOver, line: 1.5 }
          : { pick: "Under 1.5 FH", probability: 100 - pOver, line: 1.5 };
      })()
    : null;
  const firstHalfVerdict =
    firstHalfPick && xgData?.marketResults?.firstHalfGoals != null
      ? firstHalfPick.pick.startsWith("Over")
        ? xgData.marketResults.firstHalfGoals > firstHalfPick.line
        : xgData.marketResults.firstHalfGoals < firstHalfPick.line
      : null;
  const recommendedOdd = deriveRecommendedOdd(match);
  const specialBetPool = buildSpecialBetLegs(
    match,
    {
      main: tr("match.featMain"),
      corners: tr("match.featCorners"),
      shots: tr("match.featShots"),
      ht: tr("match.featHt")
    },
    3,
    match.cardMarketValidations,
    xgData?.marketResults
  );
  const specialBetLegs = specialBetPool.slice(0, specialLegCount);
  const specialBetCombinedOdd = specialBetCombinedOddValue(specialBetLegs);
  const specialCombinedTone = outcomeTextClass(specialBetCombinedOutcome(specialBetLegs));
  const specialBetCandidatesLen = specialBetPool.length;

  const isFocus = presentation === "focus";

  return (
    <div
      className={
        isFocus
          ? "fixed inset-0 z-50 flex items-end justify-end bg-[var(--fp-navy)]/40 pb-[env(safe-area-inset-bottom)] backdrop-blur-[2px] sm:items-stretch sm:pb-0"
          : "fixed inset-0 z-50 flex items-center justify-center bg-[var(--fp-navy)]/50 p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:p-4"
      }
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className={
          isFocus
            ? "fp-readable relative flex h-[min(92dvh,100%)] w-full max-w-xl flex-col overflow-y-auto rounded-t-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-lg)] sm:h-full sm:max-w-2xl sm:rounded-none sm:rounded-l-[var(--fp-radius-lg)] lg:max-w-3xl"
            : "fp-readable relative max-h-[min(92dvh,100%)] w-full max-w-lg overflow-y-auto rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-lg)] lg:max-w-5xl"
        }
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-modal-title"
        aria-describedby="match-modal-desc"
      >
        <button
          ref={closeBtnRef}
          onClick={onClose}
          title={tr("match.close")}
          className="sticky top-2 z-10 ml-auto mr-2 mt-2 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)] transition hover:border-[var(--fp-accent)] hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
          type="button"
          aria-label={tr("match.close")}
        >
          ✕
        </button>

        <div className="border-b border-[var(--fp-border)] px-4 pb-4 pt-1 sm:px-6">
          <p id="match-modal-title" className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">
            {tr("match.analysis")}
          </p>
          <div className="mb-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center justify-center gap-2 max-[380px]:gap-1.5 sm:mb-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
            <div className="flex w-[4.5rem] min-w-0 flex-col items-center gap-1 max-[380px]:w-[4rem] sm:w-full sm:gap-1.5">
              <img
                src={match.logos?.home}
                className="h-14 w-14 shrink-0 object-contain opacity-95 max-[380px]:h-12 max-[380px]:w-12 sm:h-16 sm:w-16 lg:h-20 lg:w-20"
                alt=""
              />
              <div className="w-full px-0.5 text-center font-display text-[11px] font-bold leading-tight text-[var(--fp-text)] max-[380px]:text-[10px] sm:text-sm lg:text-base">
                {match.teams.home}
              </div>
            </div>
            <div className="flex w-full min-w-0 max-w-[15.5rem] shrink-0 flex-col items-center px-0.5 max-[380px]:max-w-[12.75rem] sm:w-auto sm:min-w-[10rem] sm:max-w-[23rem] sm:px-2">
              <div className="mb-0.5 text-center text-[9px] font-bold uppercase leading-tight tracking-wider text-[var(--fp-text-muted)] max-[380px]:text-[8px] sm:text-[10px]">
                {match.league}
              </div>
              <div className="font-display text-3xl font-bold leading-none tracking-tighter text-signal-ink max-[380px]:text-2xl sm:text-5xl">
                {hasNumericScore && (hasFinalScore || hasLiveScore) ? `${match.score?.home}-${match.score?.away}` : "—"}
              </div>
              <div className="mt-1.5 flex w-full items-center justify-center gap-1.5 sm:mt-2.5 sm:justify-start sm:gap-2.5">
                <div className="shrink-0">
                  {hasExactConfidence ? (
                    <ConfidenceAura value={confPct} size="compact" />
                  ) : (
                    <div className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2.5 py-1.5 text-center">
                      <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--fp-text-muted)]">{tr("match.confidence")}</div>
                      <div className="mt-0.5 text-[11px] font-bold text-[var(--fp-accent)]">
                        {confidenceCategory || tr("match.locked")}
                      </div>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.18em] text-signal-petrol/70 sm:text-[9px]">
                    <span>{tr("match.pick")}</span>
                    <span className="sm:hidden rounded-sm border border-white/15 bg-signal-void/45 px-1 py-[1px] text-[7px] font-bold tracking-wider text-signal-petrol">
                      {hasExactConfidence ? `${confPct}%` : confidenceCategory || tr("match.locked")}
                    </span>
                  </div>
                  <div className="line-clamp-2 break-words font-display text-lg font-bold leading-tight text-signal-petrol max-[380px]:text-base sm:text-3xl">{match.recommended.pick}</div>
                  <div className="font-mono text-[10px] font-semibold tabular-nums text-signal-mint sm:text-[11px]">
                    {tr("match.odd")} {Number.isFinite(Number(recommendedOdd)) ? Number(recommendedOdd).toFixed(2) : "N/A"}
                  </div>
                  <div className="hidden font-mono text-[10px] font-semibold tabular-nums text-signal-inkMuted sm:block sm:text-[11px]">
                    {hasExactConfidence ? `${confPct}%` : confidenceCategory || tr("match.tierLocked")}
                  </div>
                </div>
              </div>
              {hasFinalScore && (
                <div
                    className={`mt-2 inline-block max-w-full truncate rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-wide max-[380px]:text-[8px] sm:mt-3 sm:px-3 sm:py-1.5 sm:text-[10px] ${finalScoreBadgeClass(finalPickResult)}`}
                >
                  {finalScoreLabel(finalPickResult)} · {match.score?.home}-{match.score?.away}
                </div>
              )}
              {hasLiveScore && (
                <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--fp-danger)] sm:mt-3 sm:px-3 sm:py-1.5 sm:text-[10px]">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--fp-danger)] motion-reduce:animate-none" /> Live ·{" "}
                  {match.score?.home}-{match.score?.away}
                </div>
              )}
              <div id="match-modal-desc" className="mt-2 flex max-w-full flex-wrap justify-center gap-x-1.5 gap-y-0.5 text-center text-[9px] text-signal-inkMuted sm:mt-3 sm:gap-x-3 sm:text-[10px]">
                <span className="font-mono tabular-nums">{kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}</span>
                <span>·</span>
                <span className="font-mono tabular-nums">{new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span>·</span>
                <span className="max-w-[6rem] truncate sm:max-w-[10rem]">{match.referee || "—"}</span>
              </div>
            </div>
            <div className="flex w-[4.5rem] min-w-0 flex-col items-center gap-1 max-[380px]:w-[4rem] sm:w-full sm:gap-1.5">
              <img
                src={match.logos?.away}
                className="h-14 w-14 shrink-0 object-contain opacity-95 max-[380px]:h-12 max-[380px]:w-12 sm:h-16 sm:w-16 lg:h-20 lg:w-20"
                alt=""
              />
              <div className="w-full px-0.5 text-center font-display text-[11px] font-bold leading-tight text-[var(--fp-text)] max-[380px]:text-[10px] sm:text-sm lg:text-base">
                {match.teams.away}
              </div>
            </div>
          </div>
          {canShowSpecialBet && hasExactConfidence && specialBetLegs.length >= 2 && (
            <div className="mx-auto mt-1 flex w-full max-w-[32rem] items-center justify-center px-1 sm:mt-2">
              <div className="relative w-full max-w-[20.5rem] min-w-0 overflow-hidden rounded-xl border border-[var(--fp-success)]/40 bg-[var(--fp-success)]/10 px-3.5 py-2.5 text-center shadow-[var(--fp-shadow-sm)] max-[380px]:max-w-[21rem] max-[380px]:px-4 sm:max-w-[28rem]">
                <div className="flex min-h-[1.55rem] flex-wrap items-center justify-between gap-1.5">
                  <div className="font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-[var(--fp-success)] max-[380px]:text-[8.5px] sm:text-[8px] sm:tracking-[0.16em]">
                    {tr("match.specialBet")}
                  </div>
                  {specialBetCandidatesLen >= 3 ? (
                    <div className="inline-flex rounded-md border border-[var(--fp-success)]/35 bg-[var(--fp-bg-card)] p-[1px]">
                      {[2, 3].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setSpecialLegCount(n as 2 | 3)}
                          className={`px-1.5 py-0.5 font-mono text-[7px] font-semibold uppercase sm:text-[8px] ${
                            specialLegCount === n
                              ? "rounded bg-[var(--fp-success)]/20 text-[var(--fp-text)]"
                              : "text-[var(--fp-text-muted)]"
                          }`}
                        >
                          {tr("match.specialBetLegs", { n })}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 space-y-1.5 rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2.5 py-1.5 max-[380px]:px-3">
                  {specialBetLegs.map((leg) => {
                    const tone = outcomeTextClass(leg.outcome);
                    return (
                      <div
                        key={`${leg.label}-${leg.pick}`}
                        className={`flex min-h-[1.25rem] items-center justify-between gap-2 font-mono text-[8px] max-[380px]:text-[8.5px] sm:text-[8px] ${tone}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-left font-semibold">
                          {leg.label}: {leg.pick}
                        </span>
                        <span className="shrink-0 rounded-sm border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-1 py-[1px] tabular-nums text-right font-bold">
                          {Math.round(leg.probability)}% · {Number(leg.odd).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div
                  className={`mt-2 border-t border-[var(--fp-border)] pt-1.5 font-mono text-[8.5px] font-semibold tabular-nums max-[380px]:text-[9px] ${specialCombinedTone}`}
                >
                  {tr("match.combinedOdd", {
                    odd: Number.isFinite(Number(specialBetCombinedOdd))
                      ? Number(specialBetCombinedOdd).toFixed(2)
                      : tr("common.na")
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="mx-auto hidden max-w-2xl sm:block">
            {hasExactConfidence ? (
              <CollapsiblePanel compact title={tr("panels.advancedSignals")} lazy={false}>
                <div className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-4">
                  <SignalLens confidence={confPct} edge={edgeScore} />
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <FormRibbon p1={match.probs.p1} pX={match.probs.pX} p2={match.probs.p2} homeTint={homeColor} awayTint={awayColor} />
                    <EdgeCompass dataQuality={dq} valueDetected={Boolean(match.valueBet?.detected)} />
                  </div>
                </div>
              </CollapsiblePanel>
            ) : (
              <CollapsiblePanel
                compact
                title={tr("panels.advancedSignals")}
                badge={<span className="text-[10px] font-bold text-[var(--fp-warning)]">🔒</span>}
              >
                <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 text-center text-sm font-medium text-[var(--fp-text)]">
                  {isPremiumLike ? tr("match.advancedNeedUltra") : tr("match.advancedHigher")}
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  {(isFreeLike
                    ? [
                        { label: tr("match.featConfidence"), tier: "premium" as const },
                        { label: tr("match.featSignalLens"), tier: "ultra" as const },
                        { label: tr("match.featEdgeCompass"), tier: "ultra" as const }
                      ]
                    : [
                        { label: tr("match.featConfidence"), tier: "ultra" as const },
                        { label: tr("match.featEdgeCompass"), tier: "ultra" as const }
                      ]
                  ).map(({ label, tier }) => (
                    <button
                      key={label}
                      type="button"
                      title={tr("match.upgradeTo", { label, tier })}
                      onClick={() => onUpgradeRequired?.(label, tier)}
                      className="inline-flex h-9 items-center rounded-md border border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 px-2.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text)] hover:bg-[var(--fp-warning)]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                    >
                      🔒 {label}
                    </button>
                  ))}
                </div>
                <div className="mt-4">
                  <FormRibbon p1={match.probs.p1} pX={match.probs.pX} p2={match.probs.p2} homeTint={homeColor} awayTint={awayColor} />
                </div>
              </CollapsiblePanel>
            )}
          </div>

          <section
            className={`mx-auto mt-6 max-w-2xl rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-[var(--fp-shadow-sm)] sm:p-5 ${
              detailTab === "form" || detailTab === "h2h"
                ? ""
                : detailTab === "overview"
                  ? "hidden sm:block"
                  : "hidden"
            }`}
          >
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--fp-accent)]">
              {detailTab === "h2h" ? tr("match.h2hContext") : tr("match.standingsForm")}
            </h3>
            {showStandingsBlock ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TeamSnapshotCard title={tr("match.home")} snap={match.teamContext?.home} accent={homeColor} />
                  <TeamSnapshotCard title={tr("match.away")} snap={match.teamContext?.away} accent={awayColor} />
                </div>
                {standingsRows && standingsRows.length > 0 ? (
                  <div className="mt-4">
                    <h4 className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
                      {tr("match.fullStandings", { league: match.league })}
                    </h4>
                    <LeagueStandingsTable
                      rows={standingsRows}
                      highlightHomeId={match.fixtureTeamIds?.home}
                      highlightAwayId={match.fixtureTeamIds?.away}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-signal-inkMuted">
                {tr("match.noStandingsBody")}
                <span className="mt-2 block font-mono text-[10px] text-signal-petrol/90">{tr("match.noStandingsHint")}</span>
              </p>
            )}
          </section>
        </div>

        <div className="sticky top-0 z-20 border-b border-[var(--fp-border)] bg-[var(--fp-bg-card)]/95 px-2 py-1.5 backdrop-blur-md sm:px-4">
          <div className="flex gap-0.5 overflow-x-auto pb-0.5" role="tablist" aria-label={tr("match.analysis")}>
            {DETAIL_TABS.map((tabItem) => (
              <button
                key={tabItem.id}
                type="button"
                role="tab"
                aria-selected={detailTab === tabItem.id}
                onClick={() => setDetailTab(tabItem.id)}
                className={`h-9 shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                  detailTab === tabItem.id
                    ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                    : "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)]"
                }`}
              >
                {tr(tabItem.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 p-3 sm:space-y-4 sm:p-5">
          <div className={tab(["prediction"])}>
            <CollapsiblePanel compact title={tr("panels.predictionAnalysis")}>
              <PredictionLaboratoryPanel match={match} framed={false} />
            </CollapsiblePanel>
          </div>

          {match.monteCarlo?.simulations ? (
            <div className={tab(["montecarlo"])}>
              <CollapsiblePanel compact title={tr("panels.monteCarlo")}>
                <MonteCarloPanel match={match} homeColor={homeColor} awayColor={awayColor} framed={false} />
              </CollapsiblePanel>
            </div>
          ) : null}

          <div className={`grid grid-cols-1 gap-6 lg:grid-cols-2 ${tab(["xg", "odds", "value", "overview"])}`}>
            <section className={`rounded-2xl border border-white/5 bg-signal-void/30 p-6 ${tab(["xg", "overview"])}`}>
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">{tr("match.xgLuck")}</h3>
              <div className="flex justify-center">{xgData ? <XGPerformanceBar xg={xgData} /> : null}</div>
              {match.luckStats && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <LuckBadge goals={match.luckStats.hG} xg={xgData?.homeXG ?? match.luckStats.hXG} />
                  <LuckBadge goals={match.luckStats.aG} xg={xgData?.awayXG ?? match.luckStats.aXG} />
                </div>
              )}
              {!match.luckStats && (
                <p className="text-center text-[10px] text-signal-inkMuted">{tr("match.luckUnavailable")}</p>
              )}
            </section>

            <section className={`rounded-2xl border border-white/5 bg-signal-void/30 p-6 ${tab(["odds", "value", "overview"])}`}>
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">{tr("match.oddsValue")}</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-white/5 bg-signal-mist/50 p-3">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">1</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums lg:text-2xl" style={{ color: homeColor }}>
                    {match.odds?.home ?? "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/50 p-3">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">X</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-signal-petrol lg:text-2xl">{match.odds?.draw ?? "—"}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/50 p-3">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">2</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums lg:text-2xl" style={{ color: awayColor }}>
                    {match.odds?.away ?? "—"}
                  </div>
                </div>
              </div>
              {match.valueEngine && (
                <div className="mt-4">
                  <ValueCard engine={match.valueEngine} bookmaker={match.odds?.bookmaker} />
                </div>
              )}
              {match.valueBet?.detected && match.valueBet.stakePlan && (
                <div className="mt-3 rounded-xl border border-white/5 bg-signal-void/40 px-3 py-2 font-mono text-[10px] text-signal-silver">
                  <div className="text-[9px] uppercase tracking-wider text-signal-inkMuted">{tr("match.stakePlan")}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
                    <span>{match.valueBet.type}</span>
                    <span>EV +{match.valueBet.ev ?? 0}%</span>
                    <span>Stake {match.valueBet.kelly ?? 0}%</span>
                    <span className="text-signal-inkMuted">Plan · {match.valueBet.stakePlan}</span>
                  </div>
                  {match.valueBet.ensemble && (
                    <div className="mt-2 grid gap-1 text-signal-inkMuted sm:grid-cols-2">
                      <span>kelly base · {String(match.valueBet.ensemble.baseKelly ?? "—")}</span>
                      {match.valueBet.ensemble.adjustment != null ? (
                        <span>adj ×{match.valueBet.ensemble.adjustment.toFixed(3)}</span>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
              {!match.valueEngine && !match.valueBet?.detected && (
                <p className="mt-4 text-[10px] text-signal-inkMuted">{tr("match.valueNotDetected")}</p>
              )}
            </section>
          </div>

          {match.explanation && (match.explanation.reasons?.length || match.explanation.reasoning?.length) ? (
            <div className={tab(["prediction", "overview"])}>
              <CollapsiblePanel compact title={tr("panels.predictionExplanation")}>
                <ExplanationCard explanation={match.explanation} framed={false} />
              </CollapsiblePanel>
            </div>
          ) : null}

          {match.featureImportance?.items?.length || match.featureImportance?.contributions ? (
            <div className={tab(["why", "prediction"])}>
              <CollapsiblePanel compact title={tr("panels.keyFactors")} subtitle={tr("panels.keyFactorsSub")}>
                <FeatureImportanceChart importance={match.featureImportance} framed={false} />
              </CollapsiblePanel>
            </div>
          ) : null}

          {match.predictionContributions?.items?.length ? (
            <div className={tab(["why", "prediction"])}>
              <CollapsiblePanel compact title={tr("panels.whyPrediction")}>
                <PredictionContributionsChart data={match.predictionContributions} framed={false} />
              </CollapsiblePanel>
            </div>
          ) : null}

          {match.confidenceEngine && (
            <div className={tab(["why", "overview"])}>
              <ConfidenceEnginePanel
                engine={match.confidenceEngine}
                recommendationPick={match.recommended?.pick || null}
              />
            </div>
          )}

          <div className={`grid grid-cols-1 gap-6 lg:grid-cols-2 ${tab(["statistics", "overview", "timeline"])}`}>
            <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">04 — Piețe & scor</h3>
                <span className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
                  probabilitate · încredere
                </span>
              </div>
              {(() => {
                const tiers = match.predictions.marketTiers;
                const p1 = match.probs.p1;
                const pX = match.probs.pX;
                const p2 = match.probs.p2;
                const oneXtwoPick = match.predictions.oneXtwo;
                // Fallback pentru istoricul vechi fără marketTiers: derivăm tier din probabilităţile brute.
                const oneXtwoInfo =
                  tiers?.oneXtwo ||
                  fallbackTierFromProb(
                    oneXtwoPick,
                    oneXtwoPick === "1" ? p1 : oneXtwoPick === "2" ? p2 : pX
                  );
                const ggInfo =
                  tiers?.gg ||
                  fallbackTierFromProb(
                    match.predictions.gg,
                    match.predictions.gg === "GG" ? match.probs.pGG : 100 - match.probs.pGG
                  );
                const over25Info =
                  tiers?.over25 ||
                  fallbackTierFromProb(
                    match.predictions.over25,
                    match.predictions.over25 === "Peste 2.5" ? match.probs.pO25 : 100 - match.probs.pO25
                  );
                const correctScoreInfo = tiers?.correctScore || {
                  pick: match.predictions.correctScore || "—",
                  prob: 0,
                  tier: "lean_off" as MarketTier
                };

                // Detect când mai multe pieţe sunt "toss" — afişăm un hint general.
                const tossCount = [oneXtwoInfo, ggInfo, over25Info].filter(
                  (i) => i?.tier === "toss"
                ).length;

                return (
                  <>
                    {tossCount > 0 && (
                      <div className="mb-3 rounded-lg border border-signal-amber/25 bg-signal-amber/5 px-3 py-2 text-[10px] leading-snug text-signal-amberSoft">
                        {tr("match.tossWarn", { n: tossCount })}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <MarketPickCard label={tr("match.market1x2")} info={oneXtwoInfo} />
                      <MarketPickCard label={tr("match.marketGgNgg")} info={ggInfo} />
                      <MarketPickCard label={tr("match.marketOu25")} info={over25Info} />
                      <div className={`rounded-xl border p-3 text-center ${tierToneClass(correctScoreInfo.tier)}`}>
                        <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">
                          <span>{tr("match.correctScore")}</span>
                          <span
                            className="rounded-sm px-1 py-[1px] text-[8.5px] font-bold tracking-wider"
                            title={tr("match.correctScoreTip")}
                          >
                            {tr("match.mostLikelyTag")}
                          </span>
                        </div>
                        <div className="mt-1 flex items-baseline justify-center gap-1.5">
                          <span className="font-mono text-sm font-semibold">{correctScoreInfo.pick || "—"}</span>
                          {correctScoreInfo.prob > 0 ? (
                            <span className="font-mono text-[10px] tabular-nums opacity-80">
                              {correctScoreInfo.prob.toFixed(0)}%
                            </span>
                          ) : null}
                        </div>
                        {hasFinalScore && (
                          <div className="mt-1 font-mono text-[10px] text-signal-inkMuted">
                            FINAL · {match.score?.home}-{match.score?.away}
                          </div>
                        )}
                      </div>
                      {match.predictions.cards && (
                        <div className="col-span-2 rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                          <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">{tr("match.cards")}</div>
                          <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.cards}</div>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </section>
          </div>

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-3 xl:gap-3">
            <CollapsiblePanel compact title={tr("panels.model1x2")}>
              <ProbBar label={tr("panels.homeWin")} val={match.probs.p1} color={homeColor} />
              <ProbBar label={tr("panels.draw")} val={match.probs.pX} color="#94a3b8" />
              <ProbBar label={tr("panels.awayWin")} val={match.probs.p2} color={awayColor} />
            </CollapsiblePanel>
            <CollapsiblePanel
              compact
              title={tr("panels.doubleChance")}
              subtitle={tr("match.dcSubtitle")}
            >
              <ProbBar label={tr("match.dc1x")} val={ext.pDC1X} color={homeColor} />
              <ProbBar label={tr("match.dc12")} val={ext.pDC12} color="#a78bfa" />
              <ProbBar label={tr("match.dcx2")} val={ext.pDCX2} color={awayColor} />
            </CollapsiblePanel>
            <CollapsiblePanel compact title={tr("panels.goalsMarkets")}>
              <ProbBar label={tr("match.over15")} val={match.probs.pO15} color="#22d3ee" />
              <ProbBar label={tr("match.under15")} val={ext.pU15} color="#64748b" />
              <ProbBar label={tr("match.over25")} val={match.probs.pO25} color="#38bdf8" />
              <ProbBar label={tr("match.under25")} val={ext.pU25} color="#0ea5e9" />
              <ProbBar label={tr("match.over35")} val={clamp100(100 - match.probs.pU35)} color="#14b8a6" />
              <ProbBar label={tr("match.under35")} val={match.probs.pU35} color="#34d399" />
              <ProbBar label={tr("match.bttsYes")} val={match.probs.pGG} color="#fbbf24" />
              <ProbBar label={tr("match.bttsNo")} val={ext.pNGG} color="#94a3b8" />
            </CollapsiblePanel>
          </div>

          {/* === PRIMA REPRIZĂ — derivată din distribuţia goluri pe minute (/teams/statistics) === */}
          {match.probs.firstHalf && (
            <CollapsiblePanel
              compact
              title={tr("panels.firstHalf")}
              subtitle={tr("match.htSubtitle")}
            >
              {match.modelMeta?.firstHalf && (
                <div className="mb-3 text-right font-mono text-[10px] text-signal-silver tabular-nums">
                  <div>
                    λ FH · {match.modelMeta.firstHalf.lambdaHome.toFixed(2)} vs{" "}
                    {match.modelMeta.firstHalf.lambdaAway.toFixed(2)}
                  </div>
                  <div className="text-[9px] text-signal-inkMuted">
                    scale · {(match.modelMeta.firstHalf.scaleHome * 100).toFixed(0)}% /{" "}
                    {(match.modelMeta.firstHalf.scaleAway * 100).toFixed(0)}%
                    {match.modelMeta.firstHalf.baselineUsed ? " · baseline" : ""}
                  </div>
                </div>
              )}
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <div className="mb-3 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
                    {tr("match.htResult")}
                  </div>
                  <ProbBar label={tr("match.htHomeLead")} val={match.probs.firstHalf.p1} color={homeColor} />
                  <ProbBar label={tr("match.htDraw")} val={match.probs.firstHalf.pX} color="#94a3b8" />
                  <ProbBar label={tr("match.htAwayLead")} val={match.probs.firstHalf.p2} color={awayColor} />
                </div>
                <div>
                  <div className="mb-3 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
                    {tr("match.htGoals")}
                  </div>
                  <ProbBar label={tr("match.htOver05")} val={match.probs.firstHalf.pO05} color="#22d3ee" />
                  <ProbBar label={tr("match.htOver15")} val={match.probs.firstHalf.pO15} color="#38bdf8" />
                  <ProbBar label={tr("match.htOver25")} val={match.probs.firstHalf.pO25} color="#0ea5e9" />
                  <ProbBar label={tr("match.htBtts")} val={match.probs.firstHalf.pGG} color="#fbbf24" />
                </div>
              </div>
              {match.probs.firstHalf.bestScore && match.probs.firstHalf.bestScoreProb > 0 ? (
                <div className="mt-4 rounded-lg border border-white/5 bg-signal-void/30 px-3 py-2 font-mono text-[10px] text-signal-silver">
                  <span className="text-[9px] uppercase tracking-wider text-signal-inkMuted">{tr("match.htBestScore")}</span>
                  <span className="ml-2 text-signal-amberSoft tabular-nums">
                    {match.probs.firstHalf.bestScore} · {match.probs.firstHalf.bestScoreProb.toFixed(0)}%
                  </span>
                </div>
              ) : null}
              {firstHalfPick && (
                <div className="mt-3 border-t border-white/5 pt-2">
                  {marketResultBadge(
                    firstHalfPick.pick,
                    firstHalfPick.probability,
                    firstHalfVerdict,
                    match.marketOdds?.firstHalfGoals?.odd,
                    match.marketOdds?.firstHalfGoals?.bookmaker,
                    "ht"
                  )}
                  {xgData?.marketResults?.firstHalfGoals != null && (
                    <span className="ml-2 font-mono text-[9px] text-signal-inkMuted">
                      {tr("match.htGoalsLabel", { n: xgData.marketResults.firstHalfGoals })}
                    </span>
                  )}
                </div>
              )}
            </CollapsiblePanel>
          )}
          {!match.probs.firstHalf && !hasExactConfidence && (
            <CollapsiblePanel
              compact
              title={tr("match.htLockedTitle")}
              badge={<span className="text-[10px] font-bold text-[var(--fp-warning)]">🔒</span>}
            >
              <p className="text-sm text-[var(--fp-text-muted)]">
                {isPremiumLike ? tr("match.htLockedUltra") : tr("match.htLocked")}
              </p>
            </CollapsiblePanel>
          )}

          {/* === CORNERE + ŞUTURI LA POARTĂ (Poisson pe rolling stats) === */}
          {(match.probs.corners || match.probs.shotsOnTarget || match.probs.shotsTotal) && (
            <div className="space-y-2">
              {match.probs.corners && (
                <CollapsiblePanel compact title={tr("match.featCorners")} subtitle={tr("match.cornersSub")}>
                  <PoissonMarketSection
                    title={tr("match.featCorners")}
                    subtitle={tr("match.cornersSub")}
                    accent="var(--fp-accent)"
                    icon="⚑"
                    data={match.probs.corners}
                    homeLabel={match.teams.home}
                    awayLabel={match.teams.away}
                    actualTotal={xgData?.marketResults?.cornersTotal ?? null}
                    quotedOdd={match.marketOdds?.corners?.odd ?? null}
                    quoteSource={match.marketOdds?.corners?.bookmaker ?? null}
                    badgeTone="corners"
                    framed={false}
                  />
                </CollapsiblePanel>
              )}
              {match.probs.shotsOnTarget && (
                <CollapsiblePanel compact title={tr("match.featShots")} subtitle={tr("match.shotsSub")}>
                  <PoissonMarketSection
                    title={tr("match.featShots")}
                    subtitle={tr("match.shotsSub")}
                    accent="var(--fp-accent)"
                    icon="◎"
                    data={match.probs.shotsOnTarget}
                    homeLabel={match.teams.home}
                    awayLabel={match.teams.away}
                    actualTotal={xgData?.marketResults?.shotsOnTargetTotal ?? null}
                    quotedOdd={match.marketOdds?.shotsOnTarget?.odd ?? null}
                    quoteSource={match.marketOdds?.shotsOnTarget?.bookmaker ?? null}
                    badgeTone="shots"
                    framed={false}
                  />
                </CollapsiblePanel>
              )}
              {match.probs.shotsTotal && (
                <CollapsiblePanel compact title={tr("match.shotsTotalTitle")} subtitle={tr("match.shotsTotalSub")}>
                  <PoissonMarketSection
                    title={tr("match.shotsTotalTitle")}
                    subtitle={tr("match.shotsTotalSub")}
                    accent="var(--fp-warning)"
                    icon="⌖"
                    data={match.probs.shotsTotal}
                    homeLabel={match.teams.home}
                    awayLabel={match.teams.away}
                    actualTotal={xgData?.marketResults?.shotsTotal ?? null}
                    quotedOdd={match.marketOdds?.shotsTotal?.odd ?? null}
                    quoteSource={match.marketOdds?.shotsTotal?.bookmaker ?? null}
                    badgeTone="shots"
                    framed={false}
                  />
                </CollapsiblePanel>
              )}
            </div>
          )}
          {showTierUpgradeLocks &&
            !match.probs.corners &&
            !match.probs.shotsOnTarget &&
            !match.probs.shotsTotal &&
            !hasExactConfidence && (
            <CollapsiblePanel
              compact
              title={tr("match.lockedMarkets")}
              badge={<span className="text-[10px] font-bold text-[var(--fp-warning)]">🔒</span>}
            >
              <p className="text-sm font-medium text-[var(--fp-text)]">
                {effectiveAccessTier === "free" || isFreeLike ? tr("match.lockedFree") : tr("match.lockedPremium")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(effectiveAccessTier === "free" || isFreeLike
                  ? [
                      { label: tr("match.featCorners"), tier: "premium" as const },
                      { label: tr("match.featShots"), tier: "ultra" as const },
                      { label: tr("match.featEdge"), tier: "ultra" as const }
                    ]
                  : [
                      { label: tr("match.featShots"), tier: "ultra" as const },
                      { label: tr("match.featEdge"), tier: "ultra" as const }
                    ]
                ).map(({ label, tier }) => (
                  <button
                    key={label}
                    type="button"
                    title={tr("match.upgradeTo", { label, tier })}
                    onClick={() => onUpgradeRequired?.(label, tier)}
                    className="inline-flex h-9 items-center rounded-md border border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 px-2.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text)] hover:bg-[var(--fp-warning)]/20"
                  >
                    🔒 {label}
                  </button>
                ))}
              </div>
            </CollapsiblePanel>
          )}

          {match.modelMeta &&
            (match.modelMeta.method ||
              match.modelMeta.reasonCodes?.length ||
              match.modelMeta.stakeBucket ||
              match.evaluation) && (
              <details className={`group rounded-2xl border border-white/[0.07] bg-signal-void/25 p-4 sm:p-5 ${tab(["prediction", "why"])}`}>
                <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/90 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    {tr("match.modelAudit")}
                    <span className="text-signal-inkMuted transition group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="mt-4 space-y-4 border-t border-white/5 pt-4 text-[11px] text-signal-inkMuted">
                  {/* === Pipeline summary: indicator clar pentru ce strat e activ === */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-signal-silver">{tr("match.pipeline")}</span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-signal-void/50 px-2 py-0.5 font-mono text-[9px] text-signal-silver">
                      Poisson+DC
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[9px] ${match.modelMeta.calibrationApplied ? "border-signal-petrol/45 bg-signal-petrol/10 text-signal-petrol" : "border-white/8 bg-signal-void/40 text-signal-inkMuted/60"}`}>
                      Isotonic {match.modelMeta.calibrationApplied ? "✓" : "—"}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[9px] ${match.modelMeta.stackerApplied ? "border-signal-mint/45 bg-signal-mintSoft text-signal-mint" : "border-white/8 bg-signal-void/40 text-signal-inkMuted/60"}`}>
                      ML stacker {match.modelMeta.stackerApplied ? "✓" : "—"}
                    </span>
                    {match.modelMeta.elo ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-signal-amber/35 bg-signal-amber/8 px-2 py-0.5 font-mono text-[9px] text-signal-amberSoft">
                        Elo Δ {match.modelMeta.elo.spread > 0 ? "+" : ""}{Math.round(match.modelMeta.elo.spread)}
                      </span>
                    ) : null}
                  </div>

                  {/* === Probabilităţile la fiecare strat (doar dacă avem raw) === */}
                  {match.evaluation?.rawPoissonProbs1x2Pct && (
                    <div className="rounded-lg border border-white/5 bg-signal-mist/20 p-3">
                      <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">{tr("match.probsPipeline")}</div>
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-left font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
                            <th className="py-1">Stage</th>
                            <th className="py-1 text-right">1</th>
                            <th className="py-1 text-right">X</th>
                            <th className="py-1 text-right">2</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono text-signal-silver tabular-nums">
                          <tr className="border-t border-white/5">
                            <td className="py-1">Raw Poisson</td>
                            <td className="py-1 text-right">{match.evaluation.rawPoissonProbs1x2Pct.p1.toFixed(1)}%</td>
                            <td className="py-1 text-right">{match.evaluation.rawPoissonProbs1x2Pct.pX.toFixed(1)}%</td>
                            <td className="py-1 text-right">{match.evaluation.rawPoissonProbs1x2Pct.p2.toFixed(1)}%</td>
                          </tr>
                          {match.evaluation.calibratedProbs1x2Pct && (
                            <tr className="border-t border-white/5 text-signal-petrol">
                              <td className="py-1">+ Isotonic</td>
                              <td className="py-1 text-right">{match.evaluation.calibratedProbs1x2Pct.p1.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.calibratedProbs1x2Pct.pX.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.calibratedProbs1x2Pct.p2.toFixed(1)}%</td>
                            </tr>
                          )}
                          {match.evaluation.stackerProbs1x2Pct && (
                            <tr className="border-t border-white/5 text-signal-mint">
                              <td className="py-1">+ ML stacker</td>
                              <td className="py-1 text-right">{match.evaluation.stackerProbs1x2Pct.p1.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.stackerProbs1x2Pct.pX.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.stackerProbs1x2Pct.p2.toFixed(1)}%</td>
                            </tr>
                          )}
                          {match.evaluation.modelProbs1x2Pct && (
                            <tr className="border-t border-white/5 font-semibold text-signal-ink">
                              <td className="py-1">Final (displayed)</td>
                              <td className="py-1 text-right">{match.evaluation.modelProbs1x2Pct.p1.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.modelProbs1x2Pct.pX.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.modelProbs1x2Pct.p2.toFixed(1)}%</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* === Top pick rationale (lift vs baseline + alternative) === */}
                  {(match.modelMeta.topPickLift != null ||
                    (match.modelMeta.topPickAlternates && match.modelMeta.topPickAlternates.length > 0)) && (
                    <div className="rounded-lg border border-white/5 bg-signal-mist/20 p-3 font-mono text-[10px] text-signal-silver">
                      <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wider">
                        <span className="text-signal-petrol/80">{tr("match.whyThisPick")}</span>
                        {match.modelMeta.topPickLift != null && (
                          <span
                            className={
                              match.modelMeta.topPickLift >= 10
                                ? "text-signal-sage"
                                : match.modelMeta.topPickLift >= 3
                                  ? "text-signal-petrol"
                                  : "text-signal-amber"
                            }
                            title="Cât de mult probabilitatea pick-ului depăşeşte baseline-ul tipic al pieţei. ≥10pp = edge puternic, 3-10pp = moderat, <3pp = pick banal-sigur."
                          >
                            lift {match.modelMeta.topPickLift >= 0 ? "+" : ""}
                            {match.modelMeta.topPickLift.toFixed(1)}pp
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] leading-relaxed text-signal-inkMuted">
                        Pick-ul e ales după scor <span className="text-signal-silver">prob × (1 + lift/60)</span> —
                        premiază pieţele unde modelul vede clar peste medie, nu doar cea mai mare probabilitate brută.
                      </p>
                      {match.modelMeta.topPickAlternates && match.modelMeta.topPickAlternates.length > 0 && (
                        <div className="mt-2 border-t border-white/5 pt-2">
                          <div className="mb-1 text-[9px] uppercase tracking-wider text-signal-inkMuted">
                            Alternative considerate
                          </div>
                          <ul className="space-y-0.5 tabular-nums">
                            {match.modelMeta.topPickAlternates.map((alt) => (
                              <li key={alt.pick} className="flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-signal-silver">{alt.pick}</span>
                                <span className="text-signal-inkMuted">
                                  {alt.prob.toFixed(1)}% · lift {alt.lift >= 0 ? "+" : ""}
                                  {alt.lift.toFixed(1)}pp
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* === League profile + derived params === */}
                  {(match.leagueProfile || match.modelMeta.leagueParams) && (
                    <div className="rounded-lg border border-white/5 bg-signal-mist/20 p-3 font-mono text-[10px] text-signal-silver">
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-signal-petrol/80">
                        League profile
                        {match.leagueProfile?.name ? ` · ${match.leagueProfile.name}` : ""}
                        {match.leagueProfile?.fromCatalog === false ? " · default" : ""}
                      </div>
                      {match.leagueProfile?.rates && (
                        <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums sm:grid-cols-4">
                          {match.leagueProfile.rates.goalFrequency != null && (
                            <span>goals {match.leagueProfile.rates.goalFrequency.toFixed(2)}</span>
                          )}
                          {match.leagueProfile.rates.drawFrequency != null && (
                            <span>draw {(match.leagueProfile.rates.drawFrequency * 100).toFixed(0)}%</span>
                          )}
                          {match.leagueProfile.rates.bttsRate != null && (
                            <span>BTTS {(match.leagueProfile.rates.bttsRate * 100).toFixed(0)}%</span>
                          )}
                          {match.leagueProfile.rates.overFrequency != null && (
                            <span>O2.5 {(match.leagueProfile.rates.overFrequency * 100).toFixed(0)}%</span>
                          )}
                          {match.leagueProfile.rates.homeAdvantage != null && (
                            <span>home {match.leagueProfile.rates.homeAdvantage.toFixed(2)}×</span>
                          )}
                          {match.leagueProfile.rates.corners != null && (
                            <span>corners {match.leagueProfile.rates.corners.toFixed(1)}</span>
                          )}
                          {match.leagueProfile.rates.cards != null && (
                            <span>cards {match.leagueProfile.rates.cards.toFixed(1)}</span>
                          )}
                          {match.leagueProfile.rates.possessionTendency != null && (
                            <span>poss {(match.leagueProfile.rates.possessionTendency * 100).toFixed(0)}%</span>
                          )}
                        </div>
                      )}
                      {match.modelMeta.leagueParams && (
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-signal-inkMuted/80 sm:grid-cols-4">
                          {match.modelMeta.leagueParams.leagueAvg != null && (
                            <span>λ̄ {match.modelMeta.leagueParams.leagueAvg.toFixed(2)}</span>
                          )}
                          {match.modelMeta.leagueParams.rho != null && (
                            <span>DC ρ {match.modelMeta.leagueParams.rho.toFixed(3)}</span>
                          )}
                          {match.modelMeta.leagueParams.blendWeight != null && (
                            <span>blend {Math.round(match.modelMeta.leagueParams.blendWeight * 100)}%</span>
                          )}
                          {match.modelMeta.leagueParams.profileKey != null && (
                            <span>key {match.modelMeta.leagueParams.profileKey}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* === Shin info (market) === */}
                  {match.odds?.marginMethod && (
                    <div className="rounded-lg border border-white/5 bg-signal-mist/20 p-3 font-mono text-[10px] text-signal-silver">
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-signal-petrol/80">{tr("match.marketDebiasing")}</div>
                      <div className="flex flex-wrap gap-x-3 tabular-nums">
                        <span>method · {match.odds.marginMethod}</span>
                        {match.odds.shinZ != null && <span>z · {match.odds.shinZ.toFixed(4)}</span>}
                        {match.odds.bookmakersUsed != null && <span>bookies · {match.odds.bookmakersUsed}</span>}
                      </div>
                    </div>
                  )}

                  {/* === Strength ratings (atk/def shrinkage) === */}
                  {match.modelMeta.strengthMeta && (
                    <div className="rounded-lg border border-white/5 bg-signal-mist/20 p-3 font-mono text-[10px] text-signal-silver">
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-signal-petrol/80">{tr("match.strengthRatings")}</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums sm:grid-cols-4">
                        {match.modelMeta.strengthMeta.atkH != null && <span>atk H {match.modelMeta.strengthMeta.atkH.toFixed(2)}</span>}
                        {match.modelMeta.strengthMeta.defH != null && <span>def H {match.modelMeta.strengthMeta.defH.toFixed(2)}</span>}
                        {match.modelMeta.strengthMeta.atkA != null && <span>atk A {match.modelMeta.strengthMeta.atkA.toFixed(2)}</span>}
                        {match.modelMeta.strengthMeta.defA != null && <span>def A {match.modelMeta.strengthMeta.defA.toFixed(2)}</span>}
                        {match.modelMeta.strengthMeta.homePlayed != null && <span>n H {match.modelMeta.strengthMeta.homePlayed}</span>}
                        {match.modelMeta.strengthMeta.awayPlayed != null && <span>n A {match.modelMeta.strengthMeta.awayPlayed}</span>}
                        {match.modelMeta.strengthMeta.shrinkageK != null && <span>k {match.modelMeta.strengthMeta.shrinkageK}</span>}
                      </div>
                    </div>
                  )}

                  {/* === Elo details === */}
                  {match.modelMeta.elo && (
                    <div className={`rounded-lg border p-3 font-mono text-[10px] tabular-nums ${match.modelMeta.elo.thin ? "border-signal-amber/25 bg-signal-amber/8 text-signal-amberSoft" : "border-signal-line/30 bg-signal-void/30 text-signal-silver"}`}>
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-signal-petrol/80">
                        Elo {match.modelMeta.elo.thin ? "· thin sample" : ""}
                      </div>
                      <div className="flex flex-wrap gap-x-3">
                        <span>H {Math.round(match.modelMeta.elo.home)}</span>
                        <span>A {Math.round(match.modelMeta.elo.away)}</span>
                        <span>Δ {match.modelMeta.elo.spread > 0 ? "+" : ""}{Math.round(match.modelMeta.elo.spread)}</span>
                      </div>
                    </div>
                  )}

                  {match.modelMeta.method && (
                    <p>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-signal-silver">Method</span> · {match.modelMeta.method}
                    </p>
                  )}
                  {match.modelMeta.probsModel && (
                    <p>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-signal-silver">Probs</span> · {match.modelMeta.probsModel}
                    </p>
                  )}
                  {match.modelMeta.stakeBucket != null && (
                    <p className="font-mono tabular-nums">
                      Stake bucket · {match.modelMeta.stakeBucket}
                      {match.modelMeta.stakeCap != null ? ` · cap ${match.modelMeta.stakeCap}` : ""}
                    </p>
                  )}
                  {Array.isArray(match.modelMeta.reasonCodes) && match.modelMeta.reasonCodes.length > 0 && (
                    <div>
                      <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-signal-silver">{tr("match.reasonCodes")}</div>
                      <ul className="list-inside list-disc space-y-0.5 font-mono text-[10px] text-signal-silver">
                        {match.modelMeta.reasonCodes.map((code) => (
                          <li key={code}>{code}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {match.evaluation && (
                    <div className="rounded-lg border border-white/5 bg-signal-mist/30 px-3 py-2 font-mono text-[10px] text-signal-silver">
                      {match.evaluation.recommendedTrack && <div>Track · {match.evaluation.recommendedTrack}</div>}
                      {match.evaluation.marketBlendWeight != null && (
                        <div>Market blend · {(match.evaluation.marketBlendWeight * 100).toFixed(0)}%</div>
                      )}
                      <div className="mt-1 text-[9px] uppercase tracking-wider text-signal-inkMuted">
                        v {match.evaluation.modelVersion || match.modelVersion || "?"}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}
        </div>
      </div>
    </div>
  );
}
