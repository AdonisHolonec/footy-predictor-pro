import { generateText } from "ai";
import { kv } from "../fetcher.js";
import { logWarn } from "../observability/logger.js";

const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const CACHE_TTL_SEC = 120;
const MAX_OUTPUT_TOKENS = 50;
const GENERATION_TIMEOUT_MS = 6000;
/** A generated sentence longer than this is treated as malformed output, not narration. */
const MAX_SENTENCE_CHARS = 200;

/**
 * Momentum Engine confidence (server-utils/momentum/MomentumEngine.js) measures how many of the
 * per-side stat fields it tracks were actually populated upstream — not match-outcome confidence.
 * Its own weighted keys include three (dangerousAttacks/attacks/recentGoals) that the current API
 * plan never populates, so 100 is structurally unreachable; the practical ceiling is ~67. A gate at
 * 50 means at least ~three-quarters of that *achievable* ceiling is present — below it, too few
 * stat fields are in so a single confident-sounding sentence would be dressing up a guess. Below
 * the gate we skip the AI request entirely and let the deterministic Match Story carry the widget,
 * exactly as it already does when momentum itself is unavailable.
 */
const CONFIDENCE_GATE_THRESHOLD = 50;

/** Second protection layer beyond the fingerprint cache: even when the state changes, don't
 *  regenerate more than once per this window unless the change is significant (score or a red
 *  card) — stays within the requested 90-120s range. */
const COOLDOWN_MS = 100_000;
/** Meta (cooldown + last-sentence-for-stability) outlives a single narrative TTL so it still
 *  applies across fingerprint cache misses within the cooldown window. */
const META_TTL_SEC = 600;
/** Jaccard word-overlap threshold above which a freshly generated sentence is treated as a
 *  paraphrase of the previous one, not a new observation — reuse the old wording instead of
 *  flickering between near-identical phrasings every cycle. */
const STABILITY_SIMILARITY_THRESHOLD = 0.7;

const SYSTEM_INSTRUCTIONS =
  "You explain a football live-match momentum engine's verdict, in the voice of a premium live " +
  "sports broadcast analyst — clear, concise, confident, natural. You are given the engine's own " +
  "verdict (which side is in control, and the trend) plus supporting stats as grounding context " +
  "only. Explain WHY the engine reached that verdict — never invent your own analysis and never " +
  "contradict the given verdict.\n\n" +
  "Hard rules:\n" +
  "- Exactly ONE sentence, maximum 18-20 words.\n" +
  "- No markdown, no bullet points, no line breaks, no quotation marks, no preamble.\n" +
  "- Never state percentages, scorelines, or any raw statistic — describe the picture in words, not numbers.\n" +
  "- Never give betting advice, odds, or a prediction of the final result.\n" +
  "- Never hedge — no \"maybe\", \"possibly\", \"appears\", \"seems\".\n" +
  "- If a previous sentence is given, vary the phrasing and structure — do not repeat it.\n" +
  "- Output only the sentence itself.";

/** Rounds to the nearest 10 — coarse enough that ordinary poll-to-poll noise in how much stat
 *  data is available doesn't bust the cache, but a real swing in data richness still does. */
function bucket10(n) {
  return Math.round(Number(n) / 10) * 10;
}

/** Buckets the shots-on-target GAP (not the absolute counts) to the nearest 2 — a 6-3 and a 7-4
 *  read the same to a viewer, so they shouldn't be treated as a different match state. */
function shotsOnTargetBucket(raw) {
  const home = raw?.home?.shotsOnTarget;
  const away = raw?.away?.shotsOnTarget;
  if (home == null || away == null) return "sot:na";
  const leader = home === away ? "even" : home > away ? "home" : "away";
  const gap = Math.round(Math.abs(home - away) / 2) * 2;
  return `sot:${leader}${gap}`;
}

function redCardsSignature(raw) {
  return `${raw?.home?.redCards ?? 0}-${raw?.away?.redCards ?? 0}`;
}

function scoreSignature(score) {
  return `${score?.home ?? 0}-${score?.away ?? 0}`;
}

/**
 * Deterministic fingerprint of "what materially changes the interpretation right now" — this, not
 * a poll-interval TTL, is the primary cache key: the same interpretation (across every concurrent
 * viewer, and across repeated polls where nothing that matters changed) produces one narration
 * call, not one per poll. Deliberately narrow: score, red cards, dominant team, trend, a coarse
 * confidence bucket, and the shots-on-target gap — the fields that actually change what a viewer
 * would be told. Raw event counts and possession/corners noise are excluded on purpose; "dangerous
 * attacks" is excluded because MomentumEngine has no data source for it today (see its own
 * zero-weight placeholder), not an oversight.
 */
export function buildFingerprint({ momentum, score }) {
  const dominant = momentum?.dominantTeam || "balanced";
  const trend = momentum?.trend || "stable";
  const confidenceBucket = bucket10(momentum?.confidence ?? 0);
  return [
    dominant,
    trend,
    `c${confidenceBucket}`,
    scoreSignature(score),
    `r${redCardsSignature(momentum?.raw)}`,
    shotsOnTargetBucket(momentum?.raw)
  ].join("|");
}

export function buildCacheKey({ locale, fixtureId, fingerprint }) {
  return `momentum_narrative:v1:${locale}:${fixtureId}:${fingerprint}`;
}

function metaCacheKey({ locale, fixtureId }) {
  return `momentum_narrative_meta:v1:${locale}:${fixtureId}`;
}

/** True when score or red cards differ — the only changes worth breaking cooldown for; everything
 *  else (a sub, a minor momentum drift) can wait for the next natural regeneration. */
function isSignificantChange(prevMeta, score, raw) {
  if (!prevMeta) return true;
  return prevMeta.score !== scoreSignature(score) || prevMeta.redCards !== redCardsSignature(raw);
}

function normalizeWords(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Cheap local heuristic (no extra model call) — Jaccard similarity over word sets. */
function isSemanticallyEquivalent(a, b) {
  if (!a || !b) return false;
  const wordsA = new Set(normalizeWords(a));
  const wordsB = new Set(normalizeWords(b));
  if (!wordsA.size || !wordsB.size) return false;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared += 1;
  const union = wordsA.size + wordsB.size - shared;
  return union > 0 && shared / union >= STABILITY_SIMILARITY_THRESHOLD;
}

function statLine(raw) {
  if (!raw) return "";
  const parts = [];
  if (raw.home?.possession != null && raw.away?.possession != null) {
    parts.push(`possession ${raw.home.possession}%-${raw.away.possession}%`);
  }
  if (raw.home?.shotsOnTarget != null && raw.away?.shotsOnTarget != null) {
    parts.push(`shots on target ${raw.home.shotsOnTarget}-${raw.away.shotsOnTarget}`);
  }
  if (raw.home?.corners != null && raw.away?.corners != null) {
    parts.push(`corners ${raw.home.corners}-${raw.away.corners}`);
  }
  return parts.join(", ");
}

/** Plain-language statement of what the engine itself concluded — the AI is told to explain THIS, not to re-derive its own verdict from the stats. */
function verdictLine(momentum, homeTeam, awayTeam) {
  const team = momentum.dominantTeam === "home" ? homeTeam : momentum.dominantTeam === "away" ? awayTeam : null;
  if (!team) return "Engine verdict: balanced, no side clearly in control.";
  const trendWord = momentum.trend === "up" ? "growing" : momentum.trend === "down" ? "fading" : "steady";
  return `Engine verdict: ${team} in control, trend ${trendWord}.`;
}

function buildPrompt({ homeTeam, awayTeam, score, momentum, recentEvents, locale, previousSentence }) {
  const scoreLine = `${homeTeam} ${score?.home ?? 0}-${score?.away ?? 0} ${awayTeam}, minute ${score?.minute ?? "?"}.`;
  const verdict = verdictLine(momentum, homeTeam, awayTeam);
  const stats = statLine(momentum.raw);
  const events = (recentEvents || [])
    .slice(-5)
    .map((ev) => `${ev.minute}' ${ev.type} (${ev.team}${ev.player ? `, ${ev.player}` : ""})`)
    .join("; ");
  return [
    scoreLine,
    verdict,
    stats ? `Grounding context only, do not quote these numbers: ${stats}.` : "",
    events ? `Recent events: ${events}.` : "",
    previousSentence ? `Previous sentence (vary the phrasing, do not repeat it): "${previousSentence}"` : "",
    `Respond in ${locale === "ro" ? "Romanian" : "English"}.`
  ]
    .filter(Boolean)
    .join("\n");
}

async function readMeta(key) {
  try {
    return await kv.get(key);
  } catch (err) {
    logWarn("momentum.narrative_meta_read_failed", { error: err?.message });
    return null;
  }
}

async function writeMeta(key, meta) {
  try {
    await kv.set(key, meta, { ex: META_TTL_SEC });
  } catch (err) {
    logWarn("momentum.narrative_meta_write_failed", { error: err?.message });
  }
}

async function cacheNarrative(cacheKey, text) {
  try {
    await kv.set(cacheKey, text, { ex: CACHE_TTL_SEC });
  } catch (err) {
    logWarn("momentum.narrative_cache_write_failed", { error: err?.message });
  }
}

/**
 * Real AI-generated one-sentence narration of the current match state — additive to, never a
 * replacement for, the deterministic buildMatchStory() rule engine on the client (that stays the
 * fallback and the sole source for the full "Match Story" list). Fails open on every error path:
 * no key configured, low engine confidence, KV unavailable, upstream timeout/rate-limit, malformed
 * output — all return null, never throw, so a caller always has a safe path back to the
 * deterministic sentence.
 *
 * @param {{
 *   locale: "ro" | "en",
 *   fixtureId: number,
 *   homeTeam: string,
 *   awayTeam: string,
 *   score?: { home?: number | null, away?: number | null, minute?: number | null },
 *   momentum: { homeMomentum: number, awayMomentum: number, dominantTeam: string, trend?: string, confidence?: number, raw?: object },
 *   recentEvents?: Array<{ minute: number, extra?: number|null, type: string, team: string, player?: string|null }>
 * }} input
 * @returns {Promise<string|null>}
 */
export async function narrateMatchState(input) {
  // No key configured → skip immediately, no network attempt. Keeps handleLive() fast for anyone
  // who hasn't opted in; without this guard every live poll would pay for a doomed auth attempt.
  if (!process.env.AI_GATEWAY_API_KEY) return null;

  // Confidence gate — see CONFIDENCE_GATE_THRESHOLD doc comment above for why 50 specifically.
  if ((input.momentum?.confidence ?? 0) < CONFIDENCE_GATE_THRESHOLD) return null;

  const locale = input.locale === "en" ? "en" : "ro";
  const fingerprint = buildFingerprint(input);
  const cacheKey = buildCacheKey({ locale, fixtureId: input.fixtureId, fingerprint });

  try {
    const cached = await kv.get(cacheKey);
    if (cached) return String(cached);
  } catch (err) {
    logWarn("momentum.narrative_cache_read_failed", { fixtureId: input.fixtureId, error: err?.message });
    // KV read failure → fall through to generation, same fail-open contract as getWithCache.
  }

  const metaKey = metaCacheKey({ locale, fixtureId: input.fixtureId });
  const meta = await readMeta(metaKey);
  const now = Date.now();
  const withinCooldown = meta?.lastGeneratedAt != null && now - meta.lastGeneratedAt < COOLDOWN_MS;
  if (withinCooldown && !isSignificantChange(meta, input.score, input.momentum?.raw) && meta.lastSentence) {
    // Same interpretation, too soon to regenerate — reuse rather than pay for a near-identical
    // sentence. Still index it under this fingerprint so the next identical poll is a direct hit.
    await cacheNarrative(cacheKey, meta.lastSentence);
    return meta.lastSentence;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  try {
    const model = process.env.MOMENTUM_NARRATIVE_MODEL || DEFAULT_MODEL;
    const result = await generateText({
      model,
      instructions: SYSTEM_INSTRUCTIONS,
      prompt: buildPrompt({ ...input, locale, previousSentence: meta?.lastSentence || null }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.4,
      maxRetries: 1,
      abortSignal: controller.signal
    });
    let text = result.text?.trim();
    if (!text || text.length > MAX_SENTENCE_CHARS) return null;

    // Narrative stability: a paraphrase of what's already showing isn't a new observation — keep
    // the wording the user already saw instead of flickering to a lexically-different retelling.
    if (meta?.lastSentence && isSemanticallyEquivalent(text, meta.lastSentence)) {
      text = meta.lastSentence;
    }

    await cacheNarrative(cacheKey, text);
    await writeMeta(metaKey, {
      lastGeneratedAt: now,
      lastSentence: text,
      score: scoreSignature(input.score),
      redCards: redCardsSignature(input.momentum?.raw)
    });
    return text;
  } catch (err) {
    logWarn("momentum.narrative_generation_failed", { fixtureId: input.fixtureId, error: err?.message });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
