/**
 * Extract comparable golden fields from a post-pipeline context.fixture.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} context
 * @returns {{
 *   lambdaHome: number|null,
 *   lambdaAway: number|null,
 *   pRaw: { p1: number|null, pX: number|null, p2: number|null },
 *   probs1x2: { p1: number|null, pX: number|null, p2: number|null },
 *   pick: string,
 *   method: string,
 *   aborted: boolean,
 *   silentSkip: boolean,
 *   insufficientReason: string|null
 * }}
 */
export function extractGoldenSnapshot(context) {
  const f = context?.fixture || {};
  const row = f.row || null;
  const pOut = row?.probs || f.pOut || null;
  const pRaw = f.pRaw || row?.evaluation?.rawPoissonProbs1x2Pct || null;

  return {
    lambdaHome: num(f.lambdaHome ?? row?.lambdas?.home),
    lambdaAway: num(f.lambdaAway ?? row?.lambdas?.away),
    pRaw: {
      p1: num(pRaw?.p1),
      pX: num(pRaw?.pX),
      p2: num(pRaw?.p2)
    },
    probs1x2: {
      p1: num(pOut?.p1 ?? f.p1Adj),
      pX: num(pOut?.pX ?? f.pXAdj),
      p2: num(pOut?.p2 ?? f.p2Adj)
    },
    pick: String(row?.recommended?.pick ?? f.topPick ?? ""),
    method: String(row?.modelMeta?.method ?? f.method ?? ""),
    aborted: Boolean(f.aborted),
    silentSkip: Boolean(f.silentSkip),
    insufficientReason: row?.insufficientReason ? String(row.insufficientReason) : null
  };
}

/**
 * @param {object} actual
 * @param {object} expected
 * @param {number} [tol=0.1]
 */
export function assertGoldenSnapshot(actual, expected, tol = 0.1) {
  const errors = [];
  const checkNum = (label, a, e) => {
    if (e == null) return;
    if (a == null || !Number.isFinite(a)) {
      errors.push(`${label}: actual missing (expected ${e})`);
      return;
    }
    if (Math.abs(a - e) >= tol) {
      errors.push(`${label}: ${a} vs ${e} (tol ${tol})`);
    }
  };

  checkNum("lambdaHome", actual.lambdaHome, expected.lambdaHome);
  checkNum("lambdaAway", actual.lambdaAway, expected.lambdaAway);
  checkNum("pRaw.p1", actual.pRaw?.p1, expected.pRaw?.p1);
  checkNum("pRaw.pX", actual.pRaw?.pX, expected.pRaw?.pX);
  checkNum("pRaw.p2", actual.pRaw?.p2, expected.pRaw?.p2);
  checkNum("probs1x2.p1", actual.probs1x2?.p1, expected.probs1x2?.p1);
  checkNum("probs1x2.pX", actual.probs1x2?.pX, expected.probs1x2?.pX);
  checkNum("probs1x2.p2", actual.probs1x2?.p2, expected.probs1x2?.p2);

  if (expected.pick != null && String(actual.pick) !== String(expected.pick)) {
    errors.push(`pick: "${actual.pick}" vs "${expected.pick}"`);
  }
  if (expected.method != null && String(actual.method) !== String(expected.method)) {
    errors.push(`method: "${actual.method}" vs "${expected.method}"`);
  }
  if (expected.aborted != null && Boolean(actual.aborted) !== Boolean(expected.aborted)) {
    errors.push(`aborted: ${actual.aborted} vs ${expected.aborted}`);
  }
  if (
    expected.insufficientReason != null &&
    String(actual.insufficientReason || "") !== String(expected.insufficientReason)
  ) {
    errors.push(
      `insufficientReason: "${actual.insufficientReason}" vs "${expected.insufficientReason}"`
    );
  }

  return errors;
}

export default { extractGoldenSnapshot, assertGoldenSnapshot };
