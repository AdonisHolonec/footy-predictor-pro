import {
  ConfidenceAura,
  deriveDataQuality,
  deriveSignalEdge,
  SignalScanStrip
} from "./SignalLab";
import { MatchScore, PredictionRow } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";

type MatchCardProps = {
  row: PredictionRow;
  logoColors: Record<string, string>;
  onClick: () => void;
  hashColor: (seed: string) => string;
  animationDelayMs?: number;
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

function statusChip(
  row: PredictionRow,
  confPct: number,
  hasFinalScore: boolean,
  finalPickResult: boolean | null,
  isLive: boolean
): { label: string; className: string } {
  if (isLive) {
    return {
      label: "LIVE",
      className: "border-red-400/35 bg-red-500/10 text-red-200"
    };
  }
  if (hasFinalScore) {
    if (finalPickResult === true) {
      return { label: "WIN", className: "border-signal-sage/35 bg-signal-sage/10 text-signal-mint" };
    }
    if (finalPickResult === false) {
      return { label: "LOSS", className: "border-signal-rose/30 bg-signal-rose/10 text-signal-rose" };
    }
    return { label: "FINAL", className: "border-white/10 bg-signal-void/50 text-signal-silver" };
  }
  if (row.valueBet?.detected) {
    return { label: "VALUE", className: "border-signal-amber/35 bg-signal-amber/10 text-signal-amberSoft" };
  }
  if (confPct >= 70) {
    return { label: "SAFE", className: "border-signal-sage/25 bg-signal-sage/8 text-signal-sage" };
  }
  return { label: "OPEN", className: "border-white/8 bg-signal-void/40 text-signal-inkMuted" };
}

/**
 * Mic badge ce arată nivelul modelului aplicat:
 * - "ML": a fost folosit stacker-ul (multinomial LR)
 * - "CAL": probabilităţi post-calibrare isotonică
 * - "DC" (fallback): doar Poisson + Dixon-Coles (fără învățare pe istoric)
 */
function modelTierBadge(row: PredictionRow): { label: string; title: string; className: string } | null {
  const meta = row.modelMeta;
  if (!meta) return null;
  if (meta.stackerApplied) {
    return {
      label: "ML",
      title: `Stacker ML activ${meta.stackerSampleSize ? ` · n=${meta.stackerSampleSize}` : ""}`,
      className: "border-signal-mint/45 bg-signal-mintSoft text-signal-mint"
    };
  }
  if (meta.calibrationApplied) {
    return {
      label: "CAL",
      title: `Isotonic calibration aplicată${meta.calibrationSampleSize ? ` · n=${meta.calibrationSampleSize}` : ""}`,
      className: "border-signal-petrol/45 bg-signal-petrol/10 text-signal-petrol"
    };
  }
  return {
    label: "DC",
    title: "Poisson + Dixon-Coles (fără calibrare pe istoric încă)",
    className: "border-white/10 bg-signal-void/45 text-signal-silver"
  };
}

export default function MatchCard({ row, logoColors, onClick, hashColor, animationDelayMs = 0 }: MatchCardProps) {
  const homeColor = logoColors[row.logos?.home || ""] || hashColor(row.teams.home);
  const awayColor = logoColors[row.logos?.away || ""] || hashColor(row.teams.away);
  const pct = (n: number) => Math.round(n || 0);
  const isLive = isFixtureInPlay(row.status);
  const confPct = pct(row.recommended?.confidence);
  const edgeScore = deriveSignalEdge(row);
  const dq = deriveDataQuality(row);
  const hasFinalScore =
    isFinalStatus(row.status) &&
    row.score?.home !== null &&
    row.score?.away !== null &&
    row.score?.home !== undefined &&
    row.score?.away !== undefined;
  const finalPickResult = hasFinalScore ? evaluateTopPick(row.recommended.pick, row.score) : null;
  const hasNumericScore =
    row.score != null && typeof row.score.home === "number" && typeof row.score.away === "number";
  const koMs = new Date(row.kickoff).getTime();
  const pastKickoffPollWindow = Number.isFinite(koMs) && Date.now() >= koMs - 15 * 60 * 1000;
  /** Scor parțial: live sau după start până la FT (inclusiv când `status` încă e NS). */
  const showRunningScore =
    hasNumericScore &&
    !hasFinalScore &&
    (isLive || (pastKickoffPollWindow && !isFinalStatus(row.status)));
  const kickoffDate = new Date(row.kickoff);
  const chip = statusChip(row, confPct, hasFinalScore, finalPickResult, isLive);
  const tier = modelTierBadge(row);

  if (row.insufficientData) {
    return (
      <div
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        style={{ animationDelay: `${animationDelayMs}ms` }}
        className="relative flex h-full animate-stagger-in cursor-pointer flex-col rounded-2xl border border-signal-amber/25 bg-signal-fog/50 p-4 shadow-atelier backdrop-blur-md sm:rounded-3xl sm:p-5 touch-manipulation select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/50 motion-reduce:animate-none"
      >
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-amber">Insufficient signal</div>
        <div className="font-display mt-1 text-base font-semibold text-signal-ink">
          {row.teams?.home} vs {row.teams?.away}
        </div>
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-signal-inkMuted">{row.insufficientReason || "Modelul nu a putut estima λ-uri."}</p>
        <p className="mt-3 font-mono text-[9px] text-signal-petrol/80">Detalii în fișă analitică →</p>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ animationDelay: `${animationDelayMs}ms` }}
      className="group relative flex h-full animate-stagger-in cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-b from-signal-panel/92 to-signal-mist/96 p-4 shadow-atelier backdrop-blur-xl sm:rounded-3xl sm:p-5 touch-manipulation select-none transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-signal-petrol/22 hover:shadow-frost active:translate-y-0 motion-reduce:animate-none motion-reduce:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/50"
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-signal-petrol/6 blur-3xl transition-opacity group-hover:opacity-100" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-petrol/30 to-transparent" />

      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="truncate rounded-md border border-signal-line/45 bg-signal-void/45 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-signal-silver">
            {row.league}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${chip.className}`}
          >
            {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 motion-reduce:animate-none" />}
            {chip.label}
          </span>
          {tier ? (
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-wide ${tier.className}`}
              title={tier.title}
            >
              {tier.label}
            </span>
          ) : null}
        </div>
        <div className="shrink-0 font-mono text-[10px] tabular-nums text-signal-inkMuted">
          {kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}
          <span className="mx-1 text-signal-stone/80">·</span>
          {new Date(row.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-[1fr_auto] items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <img src={row.logos?.home} className="h-9 w-9 shrink-0 object-contain opacity-90" alt="" />
            <div className="min-w-0">
              <div className="line-clamp-2 text-[12px] font-semibold leading-tight text-signal-ink sm:text-[13px]">{row.teams.home}</div>
              <div
                className="mt-2 h-0.5 max-w-[8rem] rounded-full opacity-80"
                style={{ background: `linear-gradient(90deg, ${homeColor}, transparent)` }}
              />
            </div>
          </div>
          <div className="my-2 font-mono text-[10px] text-signal-stone/90">vs</div>
          <div className="flex items-center gap-3">
            <img src={row.logos?.away} className="h-9 w-9 shrink-0 object-contain opacity-90" alt="" />
            <div className="min-w-0">
              <div className="line-clamp-2 text-[12px] font-semibold leading-tight text-signal-ink sm:text-[13px]">{row.teams.away}</div>
              <div
                className="mt-2 h-0.5 max-w-[8rem] rounded-full opacity-80"
                style={{ background: `linear-gradient(90deg, ${awayColor}, transparent)` }}
              />
            </div>
          </div>
        </div>
        <ConfidenceAura value={confPct} size="compact" className="self-start" />
      </div>

      {(row.teamContext?.home?.rank != null ||
        row.teamContext?.home?.form ||
        row.teamContext?.away?.rank != null ||
        row.teamContext?.away?.form) && (
        <div className="mt-3 flex items-stretch justify-between gap-2 rounded-xl border border-white/[0.07] bg-signal-void/35 px-2.5 py-2">
          <div className="min-w-0 flex-1 font-mono text-[9px] leading-snug text-signal-silver">
            <span className="block text-[8px] font-semibold uppercase tracking-wide text-signal-inkMuted">Gazde</span>
            <span className="text-signal-petrol">#{row.teamContext?.home?.rank ?? "—"}</span>
            {row.teamContext?.home?.points != null ? <span className="text-signal-inkMuted"> · {row.teamContext.home.points}pt</span> : null}
            {row.teamContext?.home?.form ? (
              <span className="mt-0.5 block truncate tracking-tight text-signal-ink" title={row.teamContext.home.form}>
                {row.teamContext.home.form}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 text-right font-mono text-[9px] leading-snug text-signal-silver">
            <span className="block text-[8px] font-semibold uppercase tracking-wide text-signal-inkMuted">Oaspeți</span>
            <span className="text-signal-petrol">#{row.teamContext?.away?.rank ?? "—"}</span>
            {row.teamContext?.away?.points != null ? <span className="text-signal-inkMuted"> · {row.teamContext.away.points}pt</span> : null}
            {row.teamContext?.away?.form ? (
              <span className="mt-0.5 block truncate tracking-tight text-signal-ink" title={row.teamContext.away.form}>
                {row.teamContext.away.form}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <div className="relative mt-4 flex items-end justify-between gap-3 border-t border-white/[0.06] pt-3">
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-signal-petrol/75">Pick</div>
          <div className="font-display text-2xl font-bold tracking-tight text-signal-ink">{row.recommended.pick}</div>
        </div>
        {(hasFinalScore || showRunningScore) && (
          <div className="text-right font-mono text-xs tabular-nums">
            {showRunningScore ? (
              <span className={isLive ? "text-red-200" : "text-signal-amber/90"}>
                <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide">{isLive ? "Live" : "Scor"}</span>
                <span className="font-display text-lg font-bold tabular-nums text-signal-ink">
                  {row.score?.home}-{row.score?.away}
                </span>
              </span>
            ) : (
              <span className="text-signal-silver">
                FT {row.score?.home}-{row.score?.away}
              </span>
            )}
          </div>
        )}
      </div>

      <SignalScanStrip edge={edgeScore} dataQuality={dq} valueDetected={Boolean(row.valueBet?.detected)} className="mt-1" />

      <p className="relative mt-3 font-mono text-[9px] text-signal-inkMuted/90">Fișă analitică · tap pentru detalii</p>
    </div>
  );
}
