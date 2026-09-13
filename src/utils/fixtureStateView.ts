import { isFixtureInPlay, isTerminalOrAbandonedStatus } from "./appUtils";
import type { FixtureState } from "../services/fixtureStateService";

/**
 * How a real fixture state is rendered — the match, not the bet.
 *
 * Pure and React-free so the rules below are testable without a DOM.
 *
 * ── THE LINE THIS FILE DOES NOT CROSS ────────────────────────────────────────
 * Nothing here reads, returns or implies a settlement. A selection is won, lost,
 * pending or void because `special_bet_selections.status` says so; this file
 * only says what the scoreboard showed. Deriving one from the other in either
 * direction is the specific defect this whole feature exists to avoid:
 *
 *   FT  Liverpool 2-1 Fulham   pick Home   → CÂȘTIGAT
 *   FT  Liverpool 1-1 Fulham   pick Home   → PIERDUT
 *
 * Same status, same shape of score, opposite results. The score cannot decide
 * it, and a finished match is not evidence a pick came in.
 *
 * ── STATUS CODES ARE UPSTREAM'S, NOT OURS ────────────────────────────────────
 * The short code is shown exactly as received (NS, 1H, HT, 2H, FT, AET, PEN,
 * PST, CANC, ABD…). No translation table, no invented "LIVE" constant: a code
 * this app has never seen still renders as itself, which is honest, whereas
 * mapping it to a familiar-looking word would be a guess. Classification for
 * tone reuses `isFixtureInPlay` / `isTerminalOrAbandonedStatus` from appUtils,
 * so there is exactly one in-play definition in the codebase.
 */

export type FixtureDisplay = {
  /** e.g. "FT", "NS", "2H 67'" — upstream's code, plus the minute only when real. */
  statusLabel: string;
  /** e.g. "2 – 1", or null when no score exists. NEVER "0 – 0" as a stand-in. */
  scoreLabel: string | null;
  inPlay: boolean;
  tone: "success" | "warning" | "neutral";
};

/**
 * A score, or nothing.
 *
 * BOTH sides must be real numbers. A half-known score (one side null) is not a
 * score, and printing "2 – " or treating the missing half as zero would invent
 * a result. 0-0 IS rendered when upstream actually reports 0 and 0 — the ban is
 * on manufacturing it from absence, not on a genuine goalless match.
 */
export function formatScore(score: { home: number | null; away: number | null } | null | undefined): string | null {
  const home = score?.home;
  const away = score?.away;
  if (typeof home !== "number" || typeof away !== "number") return null;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return `${home} – ${away}`;
}

/**
 * The status word, with a live minute when there genuinely is one.
 *
 * The minute is appended only while the match is in play AND upstream sent a
 * finite `elapsed`. A finished match never carries a minute, and a null elapsed
 * stays absent rather than becoming 0' — the `Number(null) === 0` trap the
 * server guards at the same boundary.
 */
export function formatFixtureStatus(state: Pick<FixtureState, "status" | "elapsed" | "inPlay">): string {
  const code = String(state?.status || "").trim();
  if (!code) return "";
  const live = state?.inPlay === true || isFixtureInPlay(code);
  const elapsed = state?.elapsed;
  if (live && typeof elapsed === "number" && Number.isFinite(elapsed)) return `${code} ${elapsed}'`;
  return code;
}

/**
 * Everything a leg needs to show its fixture, or null when we know nothing.
 *
 * NULL IS A REAL ANSWER and the caller must render it as one. A fixture the
 * server did not return, or returned without a status, produces null so the row
 * can say "unavailable" — never a default status, never a zero score.
 */
export function describeFixture(state: FixtureState | null | undefined): FixtureDisplay | null {
  if (!state) return null;
  const statusLabel = formatFixtureStatus(state);
  if (!statusLabel) return null;

  const inPlay = state.inPlay === true || isFixtureInPlay(state.status);
  // Tone marks the MATCH's phase, never its outcome: finished is neutral because
  // "finished" is not good or bad news — only the settlement badge beside it is.
  const tone: FixtureDisplay["tone"] = inPlay
    ? "success"
    : isTerminalOrAbandonedStatus(state.status)
      ? "neutral"
      : "warning";

  return { statusLabel, scoreLabel: formatScore(state.score), inPlay, tone };
}
