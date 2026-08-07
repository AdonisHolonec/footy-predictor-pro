/**
 * useMatchModalModel - the modal's entire derivation layer (state, effects and
 * ~40 derived values), moved verbatim from MatchModal.tsx (Sprint 7, step d).
 * One hook call replaces ~300 inline lines; the render stays in the component.
 */

import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import type { DetailTabId, MatchModalProps } from "../MatchModal";
import { deriveDataQuality, deriveSignalEdge } from "../SignalLab";
import type { PredictionRow, XGData } from "../../types";
import { isFixtureInPlay } from "../../utils/appUtils";
import { listSpecialBetCandidates, pickSpecialBetLegs, outcomeTextClass, specialBetCombinedOdd as specialBetCombinedOddValue, specialBetCombinedOutcome } from "../../utils/specialBet";
import { resolveCardMarketOutcome } from "../../utils/cardMarketOutcome";
import { fetchWithAuth } from "../../utils/apiAuth";
import { formatRecommendedPick } from "../../utils/formatRecommendation";
import type { BenchmarkConsensus } from "./MatchDecisionBlock";
import { deriveRecommendedOdd, isFinalStatus } from "./helpers";

type UseMatchModalModelArgs = {
  match: PredictionRow;
  accessTier: MatchModalProps["accessTier"];
  presentation: MatchModalProps["presentation"];
  onClose: MatchModalProps["onClose"];
  hashColor: MatchModalProps["hashColor"];
  logoColors: MatchModalProps["logoColors"];
};

export function useMatchModalModel(args: UseMatchModalModelArgs) {
  const { match, accessTier, presentation, onClose, hashColor, logoColors } = args;
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
    fetchWithAuth(`/api/fixtures?view=xg&fixtureId=${match.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && !data?.error) setXgData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [match.id]);

  const homeColor = logoColors[match.logos?.home || ""] || hashColor(match.teams.home);
  const awayColor = logoColors[match.logos?.away || ""] || hashColor(match.teams.away);
  const pct = (n: number) => Math.round(n || 0);
  // UI exposure only — reads existing valueEngine.markets as-is, does not change
  // candidate generation/ranking (server-utils/value/valueMarkets.js).
  const correctScoreCandidates = (match.valueEngine?.markets || [])
    .filter((m) => m.family === "Correct Score")
    .sort((a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0));
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
  // Recommended settlement is server-resolved only — never regraded here (see
  // resolveCardMarketOutcome). Renders the persisted verdict, or neutral when still pending.
  const recommendedOutcome = resolveCardMarketOutcome("recommended", match);
  const finalPickResult =
    recommendedOutcome === "win" ? true : recommendedOutcome === "loss" ? false : null;
  const recommendedLabel = formatRecommendedPick(match.recommended?.pick, match.recommended?.family, tr);
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

  /**
   * Decision Layer inputs. All three READ already-computed engine output — no EV,
   * confidence or probability math happens here. When an engine reports nothing
   * for this fixture the Decision Block renders a neutral "n/a" instead.
   */
  const decisionEvPct = (() => {
    const fromValueBet = Number(match.valueBet?.ev);
    if (Number.isFinite(fromValueBet)) return fromValueBet;
    const fromEngine = Number(match.valueEngine?.expectedValue);
    if (Number.isFinite(fromEngine)) return fromEngine;
    return null;
  })();

  /** First plain-language reason from the Explanation engine — never a formula. */
  const decisionRationale = (() => {
    const label = match.explanation?.reasons?.[0]?.label;
    if (typeof label === "string" && label.trim()) return label.trim();
    const sentence = match.explanation?.reasoning?.[0];
    if (typeof sentence === "string" && sentence.trim()) return sentence.trim();
    return null;
  })();

  /**
   * Prediction Benchmark placeholder (api/backtest?view=benchmark-*). Intentionally
   * null until the feature ships: the consensus row is omitted entirely when this is
   * absent, so the block degrades gracefully rather than showing an empty slot.
   */
  const decisionBenchmark: BenchmarkConsensus | null = null;

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
          ? {
              // Canonical EN pick for odds matching; display uses localized label below.
              pick: "Over 1.5 FH",
              displayPick: `${tr("match.overLine", { line: "1.5" })} FH`,
              probability: pOver,
              line: 1.5,
              side: "over" as const
            }
          : {
              pick: "Under 1.5 FH",
              displayPick: `${tr("match.underLine", { line: "1.5" })} FH`,
              probability: 100 - pOver,
              line: 1.5,
              side: "under" as const
            };
      })()
    : null;
  const htGoalsActual = (() => {
    const fromXg = xgData?.marketResults?.firstHalfGoals;
    if (fromXg != null && Number.isFinite(Number(fromXg))) return Number(fromXg);
    const fromMr = match.marketResults?.firstHalfGoals;
    if (fromMr != null && Number.isFinite(Number(fromMr))) return Number(fromMr);
    const hRaw = match.score?.halftime?.home;
    const aRaw = match.score?.halftime?.away;
    if (hRaw == null || aRaw == null) return null;
    const h = Number(hRaw);
    const a = Number(aRaw);
    if (Number.isFinite(h) && Number.isFinite(a)) return h + a;
    return null;
  })();
  const firstHalfVerdict =
    firstHalfPick && htGoalsActual != null && Number.isFinite(Number(htGoalsActual))
      ? firstHalfPick.side === "over"
        ? Number(htGoalsActual) > firstHalfPick.line
        : Number(htGoalsActual) < firstHalfPick.line
      : null;
  const recommendedOdd = deriveRecommendedOdd(match);
  const specialBetLabels = {
    main: tr("match.featMain"),
    goals: tr("card.marketGoals"),
    corners: tr("match.featCorners"),
    shots: tr("match.featShots"),
    ht: tr("match.featHt"),
    gg: tr("match.marketGgNgg"),
    cards: tr("match.cards")
  };
  const specialBetPool = listSpecialBetCandidates(
    match,
    specialBetLabels,
    match.cardMarketValidations,
    xgData?.marketResults
  );
  const specialBetLegs = pickSpecialBetLegs(specialBetPool, specialLegCount);
  const specialBetCombinedOdd = specialBetCombinedOddValue(specialBetLegs);
  const specialCombinedOutcome = specialBetCombinedOutcome(specialBetLegs);
  const specialCombinedTone = outcomeTextClass(specialCombinedOutcome);
  const specialBetCandidatesLen = specialBetPool.length;

  const isFocus = presentation === "focus";

  return {
    awayColor, clamp100, closeBtnRef, confPct, confidenceCategory, correctScoreCandidates,
    decisionBenchmark, decisionEvPct, decisionRationale, detailTab, dq, edgeScore,
    effectiveAccessTier, ext, finalPickResult, firstHalfPick, firstHalfVerdict,
    hasExactConfidence, hasFinalScore, hasLiveScore, hasNumericScore, homeColor, htGoalsActual,
    isFocus, isFreeLike, isPremiumLike, kickoffDate, modalRef, recommendedLabel,
    recommendedOdd, setDetailTab, setSpecialLegCount, showStandingsBlock, showTierUpgradeLocks,
    specialBetCandidatesLen, specialBetCombinedOdd, specialBetLegs, specialCombinedOutcome,
    specialCombinedTone, specialLegCount, standingsRows, tab, tr, xgData
  };
}