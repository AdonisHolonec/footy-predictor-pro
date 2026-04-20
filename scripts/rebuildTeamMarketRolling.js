/**
 * One-time backfill pentru team_market_rolling (cornere + SoT + şuturi totale).
 *
 * Rulează:
 *   SEASON=2025 ROLLING_WINDOW=15 node --env-file=.env.local scripts/rebuildTeamMarketRolling.js
 *
 * Poţi restrânge ligile:
 *   LEAGUE_IDS=39,140 SEASON=2025 node --env-file=.env.local scripts/rebuildTeamMarketRolling.js
 *
 * RATE LIMITING:
 * - Implicit întârziere 1200ms între apeluri (~50 apeluri/min) ca să nu ieşi din quota RapidAPI.
 * - Retry automat cu exponential backoff la 429 (respectă Retry-After dacă e prezent).
 * - Oprire proactivă dacă primeşti >5 erori 429 consecutive (conservare quota).
 *
 * Variabile env opţionale:
 *   API_DELAY_MS          (default 1200)  — delay între apeluri consecutive
 *   API_MAX_RETRIES       (default 4)     — încercări maxime per request la 429
 *   API_RETRY_BACKOFF_MS  (default 4000)  — backoff de bază între retry-uri
 *   CONSECUTIVE_429_STOP  (default 5)     — oprire la N erori 429 la rând
 *   SEASON                (default → auto-detectată din calendar)
 *   ROLLING_WINDOW        (default 15, max 30)
 *   LEAGUE_IDS            (default → TOP_LEAGUE_IDS)
 */
import {
  extractFixtureMarketStats,
  aggregateRollingForTeam,
  persistTeamMarketRolling
} from "../server-utils/teamMarketRolling.js";
import { TOP_LEAGUE_IDS } from "../server-utils/modelConstants.js";

// Dual-provider detect: APISPORTS_KEY (direct) prioritar faţă de X_RAPIDAPI_KEY (legacy).
function resolveUpstream() {
  const explicit = process.env.UPSTREAM_BASE_URL;
  const apiSportsKey = process.env.APISPORTS_KEY;
  const rapidKey = process.env.X_RAPIDAPI_KEY;
  if (apiSportsKey) {
    return {
      provider: "apisports",
      baseUrl: explicit || "https://v3.football.api-sports.io",
      headers: { "x-apisports-key": apiSportsKey }
    };
  }
  if (rapidKey) {
    return {
      provider: "rapidapi",
      baseUrl: explicit || "https://api-football-v1.p.rapidapi.com/v3",
      headers: {
        "X-RapidAPI-Key": rapidKey,
        "X-RapidAPI-Host": process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com"
      }
    };
  }
  return null;
}
const UPSTREAM = resolveUpstream();

const API_DELAY_MS = Math.max(300, Number(process.env.API_DELAY_MS) || 1200);
const API_MAX_RETRIES = Math.max(1, Math.min(Number(process.env.API_MAX_RETRIES) || 4, 8));
const API_RETRY_BACKOFF_MS = Math.max(1000, Number(process.env.API_RETRY_BACKOFF_MS) || 4000);
const CONSECUTIVE_429_STOP = Math.max(1, Number(process.env.CONSECUTIVE_429_STOP) || 5);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Detectare sezon pe ligi europene (aug-mai). În aprilie-iulie sezonul "curent" e anul trecut. */
function inferCurrentSeason() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  // sezonul European 2025-2026 începe în august 2025; în aprilie 2026 sezonul activ e 2025.
  return m >= 8 ? y : y - 1;
}

// state global pentru oprire proactivă la rate limit
const state = {
  consecutive429: 0,
  totalCalls: 0,
  totalSuccess: 0,
  aborted: false,
  abortReason: null
};

async function apiFetch(path, params, { maxRetries = API_MAX_RETRIES } = {}) {
  if (state.aborted) return { ok: false, aborted: true };

  const u = new URL(UPSTREAM.baseUrl + path);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));

  let attempt = 0;
  while (attempt <= maxRetries) {
    state.totalCalls += 1;
    try {
      const res = await fetch(u.toString(), {
        headers: UPSTREAM.headers
      });

      if (res.status === 429) {
        state.consecutive429 += 1;
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const rlReset = Number(res.headers.get("x-ratelimit-requests-reset")) || 0;
        const waitMs = Math.max(
          retryAfter * 1000,
          rlReset * 1000,
          API_RETRY_BACKOFF_MS * Math.pow(2, attempt)
        );

        if (state.consecutive429 >= CONSECUTIVE_429_STOP) {
          state.aborted = true;
          state.abortReason = `${state.consecutive429} erori 429 consecutive — oprit pentru a conserva quota`;
          console.error(`    ✋ ${state.abortReason}`);
          return { ok: false, aborted: true, status: 429 };
        }

        if (attempt >= maxRetries) {
          return { ok: false, status: 429, error: "429 Too Many Requests", retried: attempt };
        }

        console.warn(
          `    ⏸  429 → aştept ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`
        );
        await sleep(waitMs);
        attempt += 1;
        continue;
      }

      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }

      const json = await res.json();
      if (json?.errors && ((Array.isArray(json.errors) && json.errors.length) ||
          (!Array.isArray(json.errors) && Object.keys(json.errors).length))) {
        return { ok: false, error: JSON.stringify(json.errors) };
      }

      state.consecutive429 = 0;
      state.totalSuccess += 1;
      return { ok: true, data: json };
    } catch (e) {
      if (attempt >= maxRetries) {
        return { ok: false, error: e?.message || "network error" };
      }
      await sleep(API_RETRY_BACKOFF_MS * Math.pow(2, attempt));
      attempt += 1;
    }
  }
  return { ok: false, error: "max retries exceeded" };
}

async function apiGetThrottled(path, params) {
  const result = await apiFetch(path, params);
  await sleep(API_DELAY_MS);
  return result;
}

async function fetchFixturesForLeagueSeason(leagueId, season) {
  const r = await apiGetThrottled("/fixtures", {
    league: leagueId,
    season,
    status: "FT-AET-PEN"
  });
  if (!r.ok) return { ok: false, fixtures: [], error: r.error || r.status };
  return { ok: true, fixtures: r.data?.response || [] };
}

async function fetchFixtureStatistics(fixtureId) {
  const r = await apiGetThrottled("/fixtures/statistics", { fixture: fixtureId });
  if (!r.ok) return null;
  return r.data;
}

async function backfillLeagueSeason(leagueId, season, windowSize) {
  if (state.aborted) return { teams: 0, skipped: true };
  console.log(`\n>>> League ${leagueId} season ${season} window=${windowSize}`);

  let fixturesResp = await fetchFixturesForLeagueSeason(leagueId, season);
  // fallback la sezonul anterior dacă am primit listă goală ŞI nu e abort de rate-limit
  if (!state.aborted && fixturesResp.ok && fixturesResp.fixtures.length === 0) {
    const prevSeason = Number(season) - 1;
    console.log(`  fallback: season ${season} returnat 0 meciuri → încerc ${prevSeason}`);
    fixturesResp = await fetchFixturesForLeagueSeason(leagueId, prevSeason);
    if (fixturesResp.ok && fixturesResp.fixtures.length > 0) {
      season = prevSeason;
    }
  }
  if (state.aborted) return { teams: 0, skipped: true };

  const fixtures = fixturesResp.fixtures;
  console.log(`  ${fixtures.length} meciuri terminate încărcate (season=${season})`);

  if (fixtures.length === 0) {
    if (fixturesResp.error) console.log(`  motiv: ${fixturesResp.error}`);
    return { teams: 0 };
  }

  fixtures.sort((a, b) => new Date(a?.fixture?.date || 0) - new Date(b?.fixture?.date || 0));

  const byTeam = new Map();
  for (const fx of fixtures) {
    const fixtureId = Number(fx?.fixture?.id);
    const date = fx?.fixture?.date;
    const hId = Number(fx?.teams?.home?.id);
    const aId = Number(fx?.teams?.away?.id);
    if (!fixtureId || !hId || !aId) continue;
    if (!byTeam.has(hId)) byTeam.set(hId, []);
    if (!byTeam.has(aId)) byTeam.set(aId, []);
    byTeam.get(hId).push({ fixtureId, date, isHome: true, opponentId: aId });
    byTeam.get(aId).push({ fixtureId, date, isHome: false, opponentId: hId });
  }
  console.log(`  ${byTeam.size} echipe distincte`);

  const fixtureIdsNeeded = new Set();
  for (const [, matches] of byTeam.entries()) {
    const lastN = matches.slice(-windowSize);
    for (const m of lastN) fixtureIdsNeeded.add(m.fixtureId);
  }
  console.log(`  ${fixtureIdsNeeded.size} fixture statistics de încărcat`);

  const statsById = new Map();
  let processed = 0;
  let failed = 0;
  for (const fixtureId of fixtureIdsNeeded) {
    if (state.aborted) {
      console.log(`  ⛔ abort — omit ${fixtureIdsNeeded.size - processed} fixturi rămase`);
      break;
    }
    const payload = await fetchFixtureStatistics(fixtureId);
    processed += 1;
    if (payload) {
      const extracted = extractFixtureMarketStats(payload);
      const mapByTeam = new Map();
      for (const row of extracted) if (row.teamId) mapByTeam.set(row.teamId, row);
      statsById.set(fixtureId, mapByTeam);
    } else {
      failed += 1;
    }
    if (processed % 25 === 0) {
      console.log(`    progress: ${processed}/${fixtureIdsNeeded.size} · succes ${processed - failed}/${processed}`);
    }
  }

  const rows = [];
  for (const [teamId, matches] of byTeam.entries()) {
    const lastN = matches.slice(-windowSize);
    const enriched = lastN
      .map((m) => {
        const byT = statsById.get(m.fixtureId);
        if (!byT) return null;
        const teamStats = byT.get(teamId);
        const oppStats = byT.get(m.opponentId);
        if (!teamStats || !oppStats) return null;
        return {
          fixtureId: m.fixtureId,
          date: m.date,
          isHome: m.isHome,
          teamStats,
          opponentStats: oppStats
        };
      })
      .filter(Boolean);
    const agg = aggregateRollingForTeam(enriched);
    if (agg.matches_sampled === 0) continue;
    rows.push({
      team_id: teamId,
      league_id: Number(leagueId),
      season: Number(season),
      ...agg
    });
  }

  if (rows.length > 0) {
    const result = await persistTeamMarketRolling(rows);
    if (!result.ok) console.error(`  persist error: ${result.error}`);
    else console.log(`  ✅ persisted ${result.count} rows`);
  } else {
    console.log(`  ⚠ nicio echipă cu date complete (probabil rate-limit)`);
  }

  return { teams: rows.length };
}

async function run() {
  if (!UPSTREAM) {
    console.error("Missing API key. Set APISPORTS_KEY (direct api-sports.io) or X_RAPIDAPI_KEY.");
    process.exit(1);
  }
  console.log(`Provider: ${UPSTREAM.provider} (${UPSTREAM.baseUrl})`);
  const url = process.env.SUPABASE_URL;
  const keySb = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !keySb) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const leagueIds = String(process.env.LEAGUE_IDS || TOP_LEAGUE_IDS.join(","))
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);

  const season = Number(process.env.SEASON || inferCurrentSeason());
  const windowSize = Math.max(5, Math.min(Number(process.env.ROLLING_WINDOW || 15), 30));

  console.log(
    `Rebuild team market rolling :: leagues=[${leagueIds.join(",")}] season=${season} window=${windowSize}\n` +
    `  throttle: ${API_DELAY_MS}ms între apeluri · retry max ${API_MAX_RETRIES} · abort după ${CONSECUTIVE_429_STOP} × 429\n`
  );

  let totalTeams = 0;
  for (const lid of leagueIds) {
    if (state.aborted) break;
    try {
      const r = await backfillLeagueSeason(lid, season, windowSize);
      totalTeams += r.teams;
    } catch (e) {
      console.error(`  league ${lid} failed: ${e.message}`);
    }
  }

  console.log(`\n=== FINAL ===`);
  console.log(`Echipe persistate: ${totalTeams}`);
  console.log(`Apeluri API totale: ${state.totalCalls} (succes ${state.totalSuccess})`);
  if (state.aborted) {
    console.log(`⚠ Oprit devreme: ${state.abortReason}`);
    console.log(`Re-rulează după ce ţi se resetează quota RapidAPI (tipic la miezul nopţii UTC).`);
  } else {
    console.log(`✅ Backfill complet.`);
  }
}

run().catch((err) => {
  console.error("rebuildTeamMarketRolling crashed:", err?.message || err);
  process.exit(1);
});
