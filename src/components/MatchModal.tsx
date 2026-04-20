import { useEffect, useState } from "react";
import LuckBadge from "./LuckBadge";
import XGPerformanceBar from "./XGPerformanceBar";
import {
  ConfidenceAura,
  deriveDataQuality,
  deriveSignalEdge,
  EdgeCompass,
  FormRibbon,
  SignalLens
} from "./SignalLab";
import { LeagueStandingEntry, MatchScore, PredictionRow, TeamStandingsFormSnapshot, XGData } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";

type MatchModalProps = {
  match: PredictionRow;
  logoColors: Record<string, string>;
  onClose: () => void;
  hashColor: (seed: string) => string;
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
  if (result === false) return "LOSS";
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
  if (!snap) {
    return (
      <div className="rounded-xl border border-white/5 bg-signal-void/40 p-4 text-center">
        <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">{title}</div>
        <p className="mt-2 text-[11px] text-signal-inkMuted">Fără date clasament / formă</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/5 bg-signal-mist/20 p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">{title}</div>
      <div className="flex flex-wrap items-baseline gap-2">
        {snap.rank != null && (
          <span className="font-display text-2xl font-bold tabular-nums" style={{ color: accent }}>
            #{snap.rank}
          </span>
        )}
        {snap.points != null && <span className="font-mono text-sm text-signal-ink">{snap.points} pt</span>}
        {snap.played != null && <span className="text-[10px] text-signal-inkMuted">· {snap.played} meciuri</span>}
      </div>
      <div className="mt-2 font-mono text-[11px] text-signal-silver">
        GF {snap.goalsFor ?? "—"} · GA {snap.goalsAgainst ?? "—"}
        {snap.goalsDiff != null && (
          <span className="text-signal-inkMuted">
            {" "}
            · DG {snap.goalsDiff > 0 ? "+" : ""}
            {snap.goalsDiff}
          </span>
        )}
      </div>
      {snap.form ? (
        <div className="mt-3">
          <div className="mb-1 text-[9px] font-semibold uppercase text-signal-inkMuted">Mini-formă</div>
          <div className="flex flex-wrap gap-1">
            {snap.form.split("").map((ch, i) => (
              <span
                key={`${ch}-${i}`}
                className={`inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border text-[10px] font-bold ${
                  ch === "W"
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
                    : ch === "L"
                      ? "border-rose-500/30 bg-rose-500/15 text-rose-200"
                      : "border-white/10 bg-signal-void/60 text-signal-silver"
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
  return (
    <div className="max-h-64 overflow-auto rounded-xl border border-white/5 ring-1 ring-white/[0.04]">
      <table className="w-full min-w-[480px] text-left text-[10px]">
        <thead className="sticky top-0 z-[1] bg-signal-void/95 backdrop-blur-sm">
          <tr className="font-mono uppercase tracking-wide text-signal-inkMuted">
            <th className="px-2 py-2.5">#</th>
            <th className="px-2 py-2.5">Echipă</th>
            <th className="px-2 py-2.5">J</th>
            <th className="px-2 py-2.5">Pct</th>
            <th className="px-2 py-2.5">GF-GA</th>
            <th className="px-2 py-2.5">Formă</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hi = r.teamId === highlightHomeId || r.teamId === highlightAwayId;
            return (
              <tr
                key={r.teamId}
                className={`border-t border-white/[0.06] ${hi ? "bg-signal-petrol/12" : "hover:bg-white/[0.03]"}`}
              >
                <td className="px-2 py-1.5 font-mono tabular-nums text-signal-silver">{r.rank ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    {r.logo ? <img src={r.logo} alt="" className="h-5 w-5 shrink-0 object-contain opacity-90" /> : null}
                    <span className={`font-medium ${hi ? "text-signal-petrol" : "text-signal-ink"}`}>{r.teamName}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 font-mono tabular-nums text-signal-inkMuted">{r.played ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono tabular-nums text-signal-silver">{r.points ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono tabular-nums text-signal-inkMuted">
                  {r.goalsFor ?? "—"}-{r.goalsAgainst ?? "—"}
                </td>
                <td className="px-2 py-1.5 font-mono text-[9px] tracking-tight text-signal-silver">{r.form || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function MatchModal({ match, logoColors, onClose, hashColor }: MatchModalProps) {
  const [xgData, setXgData] = useState<XGData | null>(() => {
    if (!match.luckStats) return null;
    return { homeXG: match.luckStats.hXG, awayXG: match.luckStats.aXG };
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/get-xg?fixtureId=${match.id}`)
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
            <p className="font-display text-lg font-semibold text-signal-ink">Date insuficiente pentru model</p>
            <p className="mt-2 text-sm leading-relaxed text-signal-inkMuted">{match.insufficientReason}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 rounded-xl border border-signal-line bg-signal-fog px-4 py-2.5 text-sm font-semibold text-signal-petrol hover:bg-signal-panel hover:text-signal-ink"
            >
              Închide
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
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-lg font-semibold text-signal-ink">Date insuficiente pentru model</p>
              <p className="mt-1 text-[11px] text-signal-inkMuted">{match.insufficientReason}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-sm text-signal-inkMuted hover:border-signal-petrol/40 hover:text-signal-petrol"
              aria-label="Închide"
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
              <TeamSnapshotCard title="Gazde" snap={ctx?.home} accent={homeColor} />
              <TeamSnapshotCard title="Oaspeți" snap={ctx?.away} accent={awayColor} />
            </div>
          )}

          {table && table.length > 0 ? (
            <div className="mt-6">
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Clasament ligă</h3>
              <LeagueStandingsTable rows={table} highlightHomeId={hid} highlightAwayId={aid} />
            </div>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="mt-8 w-full rounded-xl border border-signal-line bg-signal-fog py-2.5 text-sm font-semibold text-signal-petrol hover:bg-signal-panel hover:text-signal-ink"
          >
            Închide
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
  const confPct = pct(match.recommended?.confidence);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-signal-void/88 p-3 backdrop-blur-md sm:p-4" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-gradient-to-b from-signal-panel/98 to-signal-mist shadow-atelierLg backdrop-blur-2xl lg:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-petrol/40 to-transparent" />
        <button
          onClick={onClose}
          className="sticky top-3 z-10 ml-auto mr-3 mt-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-signal-void/80 text-signal-inkMuted transition hover:border-signal-petrol/40 hover:text-signal-petrol"
          type="button"
          aria-label="Închide"
        >
          ✕
        </button>

        <div className="border-b border-white/5 px-5 pb-8 pt-2 sm:px-10">
          <p className="mb-6 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-signal-petrol/80">
            Analitică predictivă · Poisson / xG
          </p>
          <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:mb-8 sm:gap-4 lg:gap-6">
            <div className="flex min-w-0 flex-col items-center gap-1.5 sm:gap-2">
              <img
                src={match.logos?.home}
                className="h-11 w-11 shrink-0 object-contain opacity-90 sm:h-16 sm:w-16 lg:h-20 lg:w-20"
                alt=""
              />
              <div className="w-full px-0.5 text-center font-display text-[11px] font-semibold leading-tight text-signal-ink sm:text-sm lg:text-lg">
                {match.teams.home}
              </div>
            </div>
            <div className="flex w-[min(100%,11.5rem)] shrink-0 flex-col items-center px-0.5 sm:w-auto sm:min-w-[10rem] sm:max-w-sm sm:px-2">
              <div className="mb-0.5 text-center text-[9px] font-semibold uppercase leading-tight tracking-wider text-signal-inkMuted sm:text-[10px]">
                {match.league}
              </div>
              <div className="font-display text-3xl font-bold leading-none tracking-tighter text-signal-ink sm:text-5xl">
                {hasNumericScore && (hasFinalScore || hasLiveScore) ? `${match.score?.home}-${match.score?.away}` : "—"}
              </div>
              <div className="mt-2 flex items-center justify-center gap-1.5 sm:mt-3 sm:gap-3">
                <ConfidenceAura value={confPct} size="compact" />
                <div className="min-w-0 text-left">
                  <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-signal-petrol/70 sm:text-[9px]">Pick</div>
                  <div className="font-display text-lg font-bold leading-tight text-signal-petrol sm:text-3xl">{match.recommended.pick}</div>
                  <div className="font-mono text-[10px] font-semibold tabular-nums text-signal-inkMuted sm:text-[11px]">{confPct}%</div>
                </div>
              </div>
              {hasFinalScore && (
                <div
                  className={`mt-2 inline-block max-w-full truncate rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-wide sm:mt-3 sm:px-3 sm:py-1.5 sm:text-[10px] ${finalScoreBadgeClass(finalPickResult)}`}
                >
                  {finalScoreLabel(finalPickResult)} · {match.score?.home}-{match.score?.away}
                </div>
              )}
              {hasLiveScore && (
                <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-red-300 sm:mt-3 sm:px-3 sm:py-1.5 sm:text-[10px]">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400 motion-reduce:animate-none" /> Live ·{" "}
                  {match.score?.home}-{match.score?.away}
                </div>
              )}
              <div className="mt-2 flex max-w-full flex-wrap justify-center gap-x-1.5 gap-y-0.5 text-center text-[9px] text-signal-inkMuted sm:mt-3 sm:gap-x-3 sm:text-[10px]">
                <span className="font-mono tabular-nums">{kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}</span>
                <span>·</span>
                <span className="font-mono tabular-nums">{new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span>·</span>
                <span className="max-w-[6rem] truncate sm:max-w-[10rem]">{match.referee || "—"}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col items-center gap-1.5 sm:gap-2">
              <img
                src={match.logos?.away}
                className="h-11 w-11 shrink-0 object-contain opacity-90 sm:h-16 sm:w-16 lg:h-20 lg:w-20"
                alt=""
              />
              <div className="w-full px-0.5 text-center font-display text-[11px] font-semibold leading-tight text-signal-ink sm:text-sm lg:text-lg">
                {match.teams.away}
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-2xl rounded-2xl border border-white/5 bg-signal-void/40 p-5">
            <SignalLens confidence={confPct} edge={edgeScore} />
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <FormRibbon p1={match.probs.p1} pX={match.probs.pX} p2={match.probs.p2} homeTint={homeColor} awayTint={awayColor} />
              <EdgeCompass dataQuality={dq} valueDetected={Boolean(match.valueBet?.detected)} />
            </div>
          </div>

          <section className="mx-auto mt-6 max-w-2xl rounded-2xl border border-white/5 bg-signal-void/25 p-4 sm:p-5">
            <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Clasament & mini-formă</h3>
            {showStandingsBlock ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TeamSnapshotCard title="Gazde" snap={match.teamContext?.home} accent={homeColor} />
                  <TeamSnapshotCard title="Oaspeți" snap={match.teamContext?.away} accent={awayColor} />
                </div>
                {standingsRows && standingsRows.length > 0 ? (
                  <div className="mt-4">
                    <h4 className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Clasament complet · {match.league}</h4>
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
                Nu am primit date de clasament sau formă pentru acest meci (de obicei sezonul ligii sau răspunsul API la clasament/statistici).
                <span className="mt-2 block font-mono text-[10px] text-signal-petrol/90">Încearcă din nou Predict după deploy; datele vechi din browser fără aceste câmpuri nu se completează retroactiv.</span>
              </p>
            )}
          </section>
        </div>

        <div className="space-y-8 p-5 sm:p-10">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6">
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">01 — xG & luck</h3>
              <div className="flex justify-center">{xgData ? <XGPerformanceBar xg={xgData} /> : null}</div>
              {match.luckStats && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <LuckBadge goals={match.luckStats.hG} xg={xgData?.homeXG ?? match.luckStats.hXG} />
                  <LuckBadge goals={match.luckStats.aG} xg={xgData?.awayXG ?? match.luckStats.aXG} />
                </div>
              )}
              {!match.luckStats && <p className="text-center text-[10px] text-signal-inkMuted">Luck factor indisponibil</p>}
            </section>

            <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6">
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">02 — Cote & value</h3>
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
              {match.valueBet?.detected && (
                <div className="mt-4 rounded-xl border border-signal-amber/25 bg-signal-amber/10 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-amber">Value bet</div>
                  {match.odds?.bookmaker && <div className="mt-1 text-[10px] text-signal-inkMuted">Operator · {match.odds.bookmaker}</div>}
                  <div className="mt-2 flex flex-col gap-1 font-mono text-[12px] font-semibold text-signal-silver lg:flex-row lg:justify-between">
                    <span>{match.valueBet.type}</span>
                    <span>EV +{match.valueBet.ev ?? 0}%</span>
                    <span>Stake {match.valueBet.kelly ?? 0}%</span>
                  </div>
                  {match.valueBet.stakePlan && (
                    <p className="mt-2 font-mono text-[10px] text-signal-inkMuted">Plan · {match.valueBet.stakePlan}</p>
                  )}
                  {match.valueBet.ensemble && (
                    <div className="mt-3 rounded-lg border border-white/5 bg-signal-void/40 px-3 py-2 font-mono text-[10px] text-signal-silver">
                      <div className="text-[9px] uppercase tracking-wider text-signal-inkMuted">Ensemble</div>
                      <div className="mt-1 grid gap-1 tabular-nums sm:grid-cols-2">
                        <span>kelly base · {String(match.valueBet.ensemble.baseKelly ?? "—")}</span>
                        {match.valueBet.ensemble.adjustment != null ? (
                          <span>adj ×{match.valueBet.ensemble.adjustment.toFixed(3)}</span>
                        ) : null}
                        {match.valueBet.ensemble.confScore != null && (
                          <span>conf {match.valueBet.ensemble.confScore >= 0 ? "+" : ""}{match.valueBet.ensemble.confScore.toFixed(3)}</span>
                        )}
                        {match.valueBet.ensemble.evScore != null && (
                          <span>ev {match.valueBet.ensemble.evScore >= 0 ? "+" : ""}{match.valueBet.ensemble.evScore.toFixed(3)}</span>
                        )}
                        {match.valueBet.ensemble.dqScore != null && (
                          <span>dq {match.valueBet.ensemble.dqScore >= 0 ? "+" : ""}{match.valueBet.ensemble.dqScore.toFixed(3)}</span>
                        )}
                        {match.valueBet.ensemble.gapPenalty != null && (
                          <span>gap {match.valueBet.ensemble.gapPenalty.toFixed(3)}</span>
                        )}
                        {match.valueBet.ensemble.volPenalty != null && (
                          <span>vol {match.valueBet.ensemble.volPenalty.toFixed(3)}</span>
                        )}
                        {/* Legacy fields (backward compat pentru istoric) */}
                        {match.valueBet.ensemble.confidenceBoost != null && (
                          <span>conf boost ×{String(match.valueBet.ensemble.confidenceBoost)}</span>
                        )}
                        {match.valueBet.ensemble.volatilityPenalty != null && (
                          <span>vol penalty ×{String(match.valueBet.ensemble.volatilityPenalty)}</span>
                        )}
                        {match.valueBet.ensemble.evBoost != null && (
                          <span>EV boost ×{String(match.valueBet.ensemble.evBoost)}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {Array.isArray(match.valueBet.reasons) && match.valueBet.reasons.length > 0 && (
                    <ul className="mt-3 list-inside list-disc space-y-1 text-[10px] text-signal-inkMuted">
                      {match.valueBet.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {!match.valueBet?.detected && (
                <p className="mt-4 text-[10px] text-signal-inkMuted">Value bet · nu detectat</p>
              )}
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {match.lambdas && (
              <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6 text-center">
                <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">03 — λ ofensiv</h3>
                <div className="flex items-center justify-center gap-6">
                  <div className="font-mono text-3xl font-semibold tabular-nums" style={{ color: homeColor }}>
                    {formatLambda(match.lambdas.home)}
                  </div>
                  <span className="font-display text-signal-stone">vs</span>
                  <div className="font-mono text-3xl font-semibold tabular-nums" style={{ color: awayColor }}>
                    {formatLambda(match.lambdas.away)}
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6">
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">04 — Piețe & scor</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">1X2</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.oneXtwo}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">GG</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.gg}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">Over 2.5</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.over25}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">Correct score</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.correctScore || "—"}</div>
                  {hasFinalScore && (
                    <div className="mt-1 font-mono text-[10px] text-signal-inkMuted">Final · {match.score?.home}-{match.score?.away}</div>
                  )}
                </div>
                {match.predictions.cards && (
                  <div className="col-span-2 rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                    <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">Cartonașe</div>
                    <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.cards}</div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
            <div className="rounded-2xl border border-dashed border-signal-line/40 bg-signal-void/20 p-4 sm:p-5">
              <h3 className="mb-4 border-b border-white/5 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">1X2 (model)</h3>
              <ProbBar label="Victorie gazde" val={match.probs.p1} color={homeColor} />
              <ProbBar label="Egalitate" val={match.probs.pX} color="#94a3b8" />
              <ProbBar label="Victorie oaspeți" val={match.probs.p2} color={awayColor} />
            </div>
            <div className="rounded-2xl border border-dashed border-signal-line/40 bg-signal-void/20 p-4 sm:p-5">
              <h3 className="mb-4 border-b border-white/5 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Șansă dublă</h3>
              <p className="mb-3 text-[10px] leading-relaxed text-signal-inkMuted">Sume din 1X2 (nu sunt calibrate separat față de piață).</p>
              <ProbBar label="1 sau X" val={ext.pDC1X} color={homeColor} />
              <ProbBar label="1 sau 2" val={ext.pDC12} color="#a78bfa" />
              <ProbBar label="X sau 2" val={ext.pDCX2} color={awayColor} />
            </div>
            <div className="rounded-2xl border border-dashed border-signal-line/40 bg-signal-void/20 p-4 sm:p-5 xl:col-span-1">
              <h3 className="mb-4 border-b border-white/5 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Goluri & piețe derivate</h3>
              <ProbBar label="Peste 1.5" val={match.probs.pO15} color="#22d3ee" />
              <ProbBar label="Sub 1.5" val={ext.pU15} color="#64748b" />
              <ProbBar label="Peste 2.5" val={match.probs.pO25} color="#38bdf8" />
              <ProbBar label="Sub 2.5" val={ext.pU25} color="#0ea5e9" />
              <ProbBar label="Sub 3.5" val={match.probs.pU35} color="#34d399" />
              <ProbBar label="Ambele marchează (GG)" val={match.probs.pGG} color="#fbbf24" />
              <ProbBar label="Nu ambele (NGG)" val={ext.pNGG} color="#94a3b8" />
            </div>
          </div>

          {match.modelMeta &&
            (match.modelMeta.method ||
              match.modelMeta.reasonCodes?.length ||
              match.modelMeta.stakeBucket ||
              match.evaluation) && (
              <details className="group rounded-2xl border border-white/[0.07] bg-signal-void/25 p-4 sm:p-5">
                <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/90 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    Model audit
                    <span className="text-signal-inkMuted transition group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="mt-4 space-y-4 border-t border-white/5 pt-4 text-[11px] text-signal-inkMuted">
                  {/* === Pipeline summary: indicator clar pentru ce strat e activ === */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-signal-silver">Pipeline:</span>
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
                      <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">Probabilities pipeline</div>
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

                  {/* === League params (DC / home adv / blend) === */}
                  {match.modelMeta.leagueParams && (
                    <div className="rounded-lg border border-white/5 bg-signal-mist/20 p-3 font-mono text-[10px] text-signal-silver">
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-signal-petrol/80">League parameters</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums sm:grid-cols-4">
                        {match.modelMeta.leagueParams.leagueAvg != null && (
                          <span>λ̄ lig {match.modelMeta.leagueParams.leagueAvg.toFixed(2)}</span>
                        )}
                        {match.modelMeta.leagueParams.homeAdv != null && (
                          <span>home {match.modelMeta.leagueParams.homeAdv.toFixed(2)}×</span>
                        )}
                        {match.modelMeta.leagueParams.awayAdv != null && (
                          <span>away {match.modelMeta.leagueParams.awayAdv.toFixed(2)}×</span>
                        )}
                        {match.modelMeta.leagueParams.rho != null && (
                          <span>DC ρ {match.modelMeta.leagueParams.rho.toFixed(3)}</span>
                        )}
                        {match.modelMeta.leagueParams.blendWeight != null && (
                          <span>blend {Math.round(match.modelMeta.leagueParams.blendWeight * 100)}%</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* === Shin info (market) === */}
                  {match.odds?.marginMethod && (
                    <div className="rounded-lg border border-white/5 bg-signal-mist/20 p-3 font-mono text-[10px] text-signal-silver">
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-signal-petrol/80">Market debiasing</div>
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
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-signal-petrol/80">Strength ratings (post-shrinkage)</div>
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
                      <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-signal-silver">Reason codes</div>
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
