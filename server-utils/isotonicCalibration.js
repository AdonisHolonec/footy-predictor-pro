import { getSupabaseAdmin } from "./supabaseAdmin.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedMaps = { data: null, fetchedAt: 0, version: null };

/**
 * Pool Adjacent Violators (PAV) — fit monotone non-decreasing calibration from raw → empirical.
 * Input: array of {x: rawProb, y: outcome∈{0,1}} pairs, sorted by x ascending.
 * Returns: { xPoints, yPoints } for piecewise-linear interpolation.
 */
export function fitIsotonicPav(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { xPoints: [], yPoints: [] };
  }
  const sorted = samples
    .filter((s) => Number.isFinite(s?.x) && Number.isFinite(s?.y))
    .slice()
    .sort((a, b) => a.x - b.x);
  if (sorted.length === 0) return { xPoints: [], yPoints: [] };

  // Bucketize by x with 2 decimals to stabilize with sample sizes 100-5000.
  const bucketed = new Map();
  for (const s of sorted) {
    const key = Math.round(s.x * 1000) / 1000;
    if (!bucketed.has(key)) bucketed.set(key, { x: key, sumY: 0, n: 0 });
    const b = bucketed.get(key);
    b.sumY += s.y;
    b.n += 1;
  }
  const groups = Array.from(bucketed.values())
    .map((b) => ({ x: b.x, y: b.sumY / b.n, w: b.n }))
    .sort((a, b) => a.x - b.x);

  // PAV: merge adjacent blocks while monotonicity violated (y decreasing).
  const stack = [];
  for (const g of groups) {
    let curr = { x: g.x, y: g.y, w: g.w };
    while (stack.length > 0 && stack[stack.length - 1].y >= curr.y) {
      const prev = stack.pop();
      const w = prev.w + curr.w;
      curr = {
        x: (prev.x * prev.w + curr.x * curr.w) / w,
        y: (prev.y * prev.w + curr.y * curr.w) / w,
        w
      };
    }
    stack.push(curr);
  }

  return {
    xPoints: stack.map((s) => Number(s.x.toFixed(4))),
    yPoints: stack.map((s) => Number(Math.max(0, Math.min(1, s.y)).toFixed(4)))
  };
}

/**
 * Piecewise-linear interpolation through (xPoints, yPoints). Clamps outside range.
 */
export function applyIsotonicMap(rawProb, xPoints, yPoints) {
  if (!Array.isArray(xPoints) || xPoints.length === 0) return rawProb;
  const n = xPoints.length;
  if (n === 1) return yPoints[0];
  if (rawProb <= xPoints[0]) return yPoints[0];
  if (rawProb >= xPoints[n - 1]) return yPoints[n - 1];
  // binary search
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xPoints[mid] <= rawProb) lo = mid;
    else hi = mid;
  }
  const x0 = xPoints[lo];
  const x1 = xPoints[hi];
  const y0 = yPoints[lo];
  const y1 = yPoints[hi];
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (rawProb - x0)) / (x1 - x0);
}

/**
 * Calibrează vectorul [p1, pX, p2] folosind 3 hărţi per outcome, apoi renormalizează la 1.
 */
export function applyCalibratedTriple(pRaw, maps) {
  const p1 = applyIsotonicMap(pRaw.p1, maps?.["1"]?.xPoints, maps?.["1"]?.yPoints);
  const pX = applyIsotonicMap(pRaw.pX, maps?.["X"]?.xPoints, maps?.["X"]?.yPoints);
  const p2 = applyIsotonicMap(pRaw.p2, maps?.["2"]?.xPoints, maps?.["2"]?.yPoints);
  const s = p1 + pX + p2;
  if (!Number.isFinite(s) || s <= 0) return { ...pRaw, calibrationApplied: false };
  return {
    p1: p1 / s,
    pX: pX / s,
    p2: p2 / s,
    calibrationApplied: true
  };
}

/**
 * Apply binary isotonic map when present; otherwise return rawProb unchanged.
 */
export function applyCalibratedBinary(rawProb, map) {
  const x = Number(rawProb);
  if (!Number.isFinite(x)) return rawProb;
  if (!map?.xPoints?.length || !map?.yPoints?.length) return Math.max(0, Math.min(1, x));
  return Math.max(0, Math.min(1, applyIsotonicMap(x, map.xPoints, map.yPoints)));
}

/**
 * Calibrate side markets (O1.5 / O2.5 / U3.5 / GG) after 1X2 fusion.
 * Complements are derived (not separately calibrated) to keep pairs coherent.
 *
 * @param {object} probsPct - percent fields (pO15, pO25, pU35, pGG, …)
 * @param {object|null} maps - league calibration maps including O15/O25/U35/GG
 */
export function applySideMarketCalibration(probsPct, maps) {
  const toFrac = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return n > 1.5 ? n / 100 : n;
  };
  const toPct = (f) => Math.max(0, Math.min(100, f * 100));

  const applied = {};
  let any = false;

  const o15 = toFrac(probsPct?.pO15);
  const o25 = toFrac(probsPct?.pO25);
  const u35 = toFrac(probsPct?.pU35);
  const gg = toFrac(probsPct?.pGG);

  let pO15 = o15;
  let pO25 = o25;
  let pU35 = u35;
  let pGG = gg;

  if (o15 != null && maps?.O15?.xPoints?.length) {
    pO15 = applyCalibratedBinary(o15, maps.O15);
    applied.O15 = true;
    any = true;
  }
  if (o25 != null && maps?.O25?.xPoints?.length) {
    pO25 = applyCalibratedBinary(o25, maps.O25);
    applied.O25 = true;
    any = true;
  }
  if (u35 != null && maps?.U35?.xPoints?.length) {
    pU35 = applyCalibratedBinary(u35, maps.U35);
    applied.U35 = true;
    any = true;
  }
  if (gg != null && maps?.GG?.xPoints?.length) {
    pGG = applyCalibratedBinary(gg, maps.GG);
    applied.GG = true;
    any = true;
  }

  const out = { ...probsPct, sideCalibrationApplied: applied, sideCalibrationAny: any };
  if (pO15 != null) {
    out.pO15 = toPct(pO15);
    out.pU15 = toPct(1 - pO15);
  }
  if (pO25 != null) {
    out.pO25 = toPct(pO25);
    out.pU25 = toPct(1 - pO25);
  }
  if (pU35 != null) {
    out.pU35 = toPct(pU35);
    out.pO35 = toPct(1 - pU35);
  }
  if (pGG != null) {
    out.pGG = toPct(pGG);
    out.pNGG = toPct(1 - pGG);
  }
  return out;
}

/**
 * Încărcare single-flight cu cache in-memory. Returnează map { leagueId: { '1':{...}, 'X':{...}, '2':{...} } }.
 */
export async function loadCalibrationMaps(modelVersion) {
  const now = Date.now();
  if (
    cachedMaps.data &&
    cachedMaps.version === modelVersion &&
    now - cachedMaps.fetchedAt < CACHE_TTL_MS
  ) {
    return cachedMaps.data;
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    cachedMaps = { data: {}, fetchedAt: now, version: modelVersion };
    return {};
  }
  try {
    const { data, error } = await supabase
      .from("calibration_maps")
      .select("league_id, outcome, x_points, y_points, sample_size")
      .eq("model_version", modelVersion);
    if (error) {
      cachedMaps = { data: {}, fetchedAt: now, version: modelVersion };
      return {};
    }
    const map = {};
    for (const row of data || []) {
      const leagueKey = row.league_id != null ? String(row.league_id) : "*";
      if (!map[leagueKey]) map[leagueKey] = {};
      map[leagueKey][row.outcome] = {
        xPoints: row.x_points || [],
        yPoints: row.y_points || [],
        sampleSize: row.sample_size || 0
      };
    }
    cachedMaps = { data: map, fetchedAt: now, version: modelVersion };
    return map;
  } catch {
    cachedMaps = { data: {}, fetchedAt: now, version: modelVersion };
    return {};
  }
}

export function pickCalibrationMapForLeague(allMaps, leagueId) {
  if (!allMaps || typeof allMaps !== "object") return null;
  const key = leagueId != null ? String(leagueId) : null;
  if (key && allMaps[key]) return allMaps[key];
  // Global maps are stored as league_id = -1 by daily-ml; "*" is a legacy alias.
  return allMaps["-1"] || allMaps["*"] || null;
}

/** Hard-reset pentru testare / trigger manual după refit. */
export function invalidateCalibrationCache() {
  cachedMaps = { data: null, fetchedAt: 0, version: null };
}
