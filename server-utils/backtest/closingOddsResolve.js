/**
 * Resolve closing odds for a staked selection from payload blob + history columns.
 */

/** Closing odds for the staked selection, when the payload stored them (else null). */
export function selectionClosingOdd(payload, row, type) {
  const closing =
    payload?.closingOdds ||
    payload?.oddsClosing ||
    (payload?.marketOdds && payload.marketOdds.closing) ||
    null;
  const t = String(type || "").trim().toUpperCase();
  const pickKey = t === "1" ? "home" : t === "2" ? "away" : t === "X" ? "draw" : null;
  if (closing && pickKey) {
    const v = Number(closing[pickKey] ?? closing[t]);
    if (Number.isFinite(v) && v > 1) return v;
  }
  if (closing) {
    const aliases = {
      GG: [closing.gg, closing.GG, closing.yes],
      NGG: [closing.ngg, closing.NGG, closing.no],
      "1X": [closing.dc1x, closing["1X"], closing.homeDraw],
      "12": [closing.dc12, closing["12"], closing.homeAway],
      X2: [closing.dcx2, closing.X2, closing.drawAway]
    };
    for (const v of aliases[t] || []) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 1) return n;
    }
    const over = t.match(/^(?:PESTE|OVER)\s*(\d+(?:[.,]\d+)?)/);
    const under = t.match(/^(?:SUB|UNDER)\s*(\d+(?:[.,]\d+)?)/);
    if (over) {
      const line = over[1].replace(",", ".");
      const key = `over${line.replace(".", "")}`;
      const n = Number(closing[key] ?? closing[`o${line}`]);
      if (Number.isFinite(n) && n > 1) return n;
    }
    if (under) {
      const line = under[1].replace(",", ".");
      const key = `under${line.replace(".", "")}`;
      const n = Number(closing[key] ?? closing[`u${line}`]);
      if (Number.isFinite(n) && n > 1) return n;
    }
  }
  const col =
    t === "1"
      ? row?.closing_odds_home
      : t === "2"
        ? row?.closing_odds_away
        : t === "X"
          ? row?.closing_odds_draw
          : null;
  const cv = Number(col);
  return Number.isFinite(cv) && cv > 1 ? cv : null;
}
