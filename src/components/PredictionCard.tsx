import React from "react";
import type { PairMarket } from "./MarketPair";
import type { TripleItem } from "./MarketTriple";
import { ScoreChips, type ScoreChip } from "./ScoreChips";
import type { LinePair } from "../App";

type FinalInfo = {
  finished?: boolean;
  gh?: number; ga?: number;   // goals final
  hth?: number; hta?: number; // HT goals
};

type Props = {
  fixture: { id: number; date?: string };
  home: { name: string; logo?: string };
  away: { name: string; logo?: string };
  advice?: string;
  adviceOutcome?: "win" | "lose" | "pending";
  oddsBook?: string;
  confidence?: number;

  marketBTTS?: PairMarket | null;
  marketOU25?: PairMarket | null;
  marketDC?: { title: string; items: TripleItem[] } | null;

  marketHTGoals?: PairMarket | null;
  marketCorners?: PairMarket | null;
  marketCards?: PairMarket | null;

  cornersLines?: LinePair[];
  cardsLines?: LinePair[];

  scoreTop?: ScoreChip[] | null;

  showAdvanced?: boolean;
  hideUnavailable?: boolean;

  cachedInfo?: { predAt?: number; oddsAt?: number };

  final?: FinalInfo;
};

const fmtPct = (x?: number) => (x == null ? "—" : `${Math.round(x)}%`);
const fmtOdd = (x?: string) => (x ? x : "N/A");
const clamp01 = (n: number) => Math.max(0, Math.min(100, n));
const isAvail = (m?: PairMarket | null) => !!(m && (m.aOdd || m.bOdd));

const timeAgo = (ts?: number) => {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const m = Math.floor(s / 60);
  if (m < 1) return "acum 0m";
  if (m < 60) return `acum ${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `acum ${h}h ${mm}m`;
};

function Mark({ val }: { val?: boolean }) {
  if (val == null) return null;
  return val ? <span className="mark-ok">✓</span> : <span className="mark-bad">✗</span>;
}

function PairBox({
  m,
  decide, finished,
}: {
  m?: PairMarket | null;
  decide?: (side: "a" | "b") => boolean | undefined;
  finished?: boolean;
}) {
  if (!m) {
    return (
      <div className="market-box text-sm text-slate-500">
        <div className="market-title">N/A</div>
        <div>Date indisponibile</div>
      </div>
    );
  }
  const aBest = (m.aProb ?? 0) >= (m.bProb ?? 0);
  const aRes = finished ? decide?.("a") : undefined;
  const bRes = finished ? decide?.("b") : undefined;

  return (
    <div className="market-box">
      <div className="market-title">{m.title}</div>

      <div className="market-row">
        <div className="text-slate-700">{m.aLabel}</div>
        <div className="flex items-center gap-2">
          {aBest && <span className="chip-best">BEST</span>}
          <span className="pct">{fmtPct(m.aProb)}</span>
          <span className="odd">{fmtOdd(m.aOdd)}</span>
          <Mark val={aRes} />
        </div>
      </div>

      <div className="mt-2 market-row">
        <div className="text-slate-700">{m.bLabel}</div>
        <div className="flex items-center gap-2">
          {!aBest && <span className="chip-best">BEST</span>}
          <span className="pct">{fmtPct(m.bProb)}</span>
          <span className="odd">{fmtOdd(m.bOdd)}</span>
          <Mark val={bRes} />
        </div>
      </div>
    </div>
  );
}

function TripleBox({
  title, items, decideIndex, finished,
}: {
  title: string;
  items?: TripleItem[];
  decideIndex?: () => number | undefined;
  finished?: boolean;
}) {
  const a = items?.[0], b = items?.[1], c = items?.[2];
  const best = Math.max(a?.prob ?? 0, b?.prob ?? 0, c?.prob ?? 0);
  const winIdx = finished ? decideIndex?.() : undefined;

  const Row = (it?: TripleItem, idx?: number) => (
    <div key={idx} className={`market-row ${idx ? "mt-2" : ""}`}>
      <div className="text-slate-700">{it?.label ?? "—"}</div>
      <div className="flex items-center gap-2">
        {(it?.prob ?? 0) === best && best > 0 ? <span className="chip-best">BEST</span> : null}
        <span className="pct">{fmtPct(it?.prob)}</span>
        <span className="odd">{fmtOdd(it?.odd)}</span>
        {winIdx != null ? <Mark val={winIdx === idx} /> : null}
      </div>
    </div>
  );

  return (
    <div className="market-box">
      <div className="market-title">{title}</div>
      {Row(a, 0)}
      {Row(b, 1)}
      {Row(c, 2)}
    </div>
  );
}

function LinesBox({ title, rows }: { title: string; rows?: LinePair[] }) {
  const valid = (rows ?? []).filter((r) => r.overOdd || r.underOdd);
  if (!valid.length) {
    return (
      <div className="market-box text-sm text-slate-500">
        <div className="market-title">{title}</div>
        <div>N/A</div>
      </div>
    );
  }
  return (
    <div className="market-box">
      <div className="market-title">{title}</div>
      <div className="space-y-3">
        {valid.map((r, i) => (
          <div key={i} className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-slate-700">Over {r.line}</div>
              <div className="flex items-center gap-2">
                <span className="pct">{fmtPct(r.overProb)}</span>
                <span className="odd">{fmtOdd(r.overOdd)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-slate-700">Under {r.line}</div>
              <div className="flex items-center gap-2">
                <span className="pct">{fmtPct(r.underProb)}</span>
                <span className="odd">{fmtOdd(r.underOdd)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PredictionCard(props: Props) {
  const {
    home, away, advice, adviceOutcome, oddsBook, confidence,
    marketBTTS, marketOU25, marketDC, marketHTGoals, marketCorners, marketCards,
    cornersLines, cardsLines, scoreTop, showAdvanced, cachedInfo, hideUnavailable,
    final,
  } = props;

  const hideNA = hideUnavailable ?? true;
  const cachedAt = Math.min(
    cachedInfo?.predAt ?? Number.POSITIVE_INFINITY,
    cachedInfo?.oddsAt ?? Number.POSITIVE_INFINITY
  );
  const isCached = Number.isFinite(cachedAt);

  // decideri bazate pe scor
  const finished = !!final?.finished;
  const gh = final?.gh ?? 0;
  const ga = final?.ga ?? 0;
  const htSum = (final?.hth ?? 0) + (final?.hta ?? 0);
  const winner = gh > ga ? "home" : gh < ga ? "away" : "draw";

  // BTTS
  const decideBTTS = (side: "a" | "b") => {
    if (!finished) return undefined;
    const yes = gh > 0 && ga > 0;
    return side === "a" ? yes : !yes;
  };
  // Over/Under 2.5
  const decideOU25 = (side: "a" | "b") => {
    if (!finished) return undefined;
    const over = gh + ga > 2.5;
    return side === "a" ? over : !over;
  };
  // HT Over 0.5 / Over 1.5 – pot fi ambele true
  const decideHT = (side: "a" | "b") => {
    if (!finished || isNaN(htSum)) return undefined;
    if (side === "a") return htSum > 0.5;
    return htSum > 1.5;
  };
  // Double Chance – index câștigător
  const decideDCIndex = () => {
    if (!finished) return undefined;
    if (winner === "home" || winner === "draw") return 0; // 1X
    if (winner === "home" || winner === "away") return 1; // 12
    return 2; // X2 (draw/away) – dacă draw, index 2; dacă away, 2 e true, dar 1 e deja tratat mai sus
  };

  return (
    <div className="card">
      {/* header */}
      <div className="pitch-header flex items-center gap-3 p-4">
        <div className="flex items-center gap-2">
          {home.logo ? <img src={home.logo} alt={home.name} className="w-8 h-8 object-contain" /> : null}
          <span className="font-semibold">{home.name}</span>
          <span className="text-slate-400">vs</span>
          {away.logo ? <img src={away.logo} alt={away.name} className="w-8 h-8 object-contain" /> : null}
          <span className="font-semibold">{away.name}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-700">
          {oddsBook ? <span>odds: <span className="font-medium">{oddsBook}</span></span> : null}
          {isCached && <span className="chip-cache">din cache · {timeAgo(cachedAt)}</span>}
        </div>
      </div>

      {/* advice */}
      {advice ? (
        <div className="mx-4 my-3 rounded-xl bg-interblue-50 text-interblue-900 p-3 text-sm flex items-center gap-2">
          <span className="uppercase text-xs font-semibold">ADVICE</span>
          <span className="ml-2">{advice}</span>
          {adviceOutcome === "win" && <span className="mark-ok ml-2">✓</span>}
          {adviceOutcome === "lose" && <span className="mark-bad ml-2">✗</span>}
        </div>
      ) : null}

      {/* încredere */}
      {typeof confidence === "number" ? (
        <div className="mx-4 mb-4">
          <div className="flex justify-between text-xs text-slate-600 mb-1">
            <span>Încredere</span>
            <span>{Math.round(confidence)}%</span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${clamp01(confidence)}%` }} />
          </div>
        </div>
      ) : null}

      {/* piețe principale */}
      <div className="grid md:grid-cols-3 gap-4 px-4 pb-4">
        {(!hideNA || isAvail(marketBTTS)) && (
          <PairBox m={marketBTTS} decide={decideBTTS} finished={finished} />
        )}
        {(!hideNA || isAvail(marketOU25)) && (
          <PairBox m={marketOU25} decide={decideOU25} finished={finished} />
        )}
        <TripleBox
          title={marketDC?.title ?? "Șansă dublă"}
          items={marketDC?.items}
          decideIndex={decideDCIndex}
          finished={finished}
        />
      </div>

      {/* piețe avansate (principal) */}
      {showAdvanced && (
        <div className="grid md:grid-cols-3 gap-4 px-4 pb-4">
          {(!hideNA || isAvail(marketHTGoals)) && (
            <PairBox m={marketHTGoals} decide={decideHT} finished={finished} />
          )}
          {(!hideNA || isAvail(marketCorners)) && <PairBox m={marketCorners} />}
          {(!hideNA || isAvail(marketCards)) && <PairBox m={marketCards} />}
        </div>
      )}

      {/* linii Cornere/Cartonașe – se afișează mereu, N/A dacă nu sunt cote */}
      {showAdvanced && (
        <div className="grid md:grid-cols-2 gap-4 px-4 pb-4">
          <LinesBox title="Cornere (8.5 / 9.5 / 10.5)" rows={cornersLines} />
          <LinesBox title="Cartonașe (2.5 / 3.5 / 4.5)" rows={cardsLines} />
        </div>
      )}

      <div className="px-4 pb-4">
        <ScoreChips scores={scoreTop} highlightLabel={`${final?.gh ?? "-"}:${final?.ga ?? "-"}`} />
      </div>
    </div>
  );
}
