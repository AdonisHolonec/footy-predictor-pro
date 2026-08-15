import test from "node:test";
import assert from "node:assert/strict";

import {
  describe as describeStats,
  sortObservations,
  validObservations,
  computeLeagueBaseline,
  refereeDelta,
  bucketForSample,
  bucketBySampleSize,
  shrinkTowardBaseline,
  splitHalves,
  stabilityForReferee,
  walkForwardEvaluate,
  errorMetrics,
  compareUnits
} from "../server-utils/analysis/refereeCardsAnalysis.js";

const obs = (fixtureId, date, referee, cardsTotal, cardsPoints) => ({
  fixtureId,
  date,
  referee,
  cardsTotal,
  cardsPoints
});

// -------------------- league baseline --------------------

test("league baseline: medie/median/sd din cardsTotal observat", () => {
  const base = computeLeagueBaseline([
    obs(1, "2026-01-01", "A", 2),
    obs(2, "2026-01-02", "B", 4),
    obs(3, "2026-01-03", "C", 6)
  ]);
  assert.equal(base.n, 3);
  assert.equal(base.mean, 4);
  assert.equal(base.median, 4);
  assert.equal(base.min, 2);
  assert.equal(base.max, 6);
  assert.equal(base.range, 4);
});

test("league baseline: median pe număr par de observaţii", () => {
  assert.equal(computeLeagueBaseline([obs(1, "d", "A", 1), obs(2, "d", "B", 4)]).median, 2.5);
});

test("league baseline: set gol → null, nu 0", () => {
  const base = computeLeagueBaseline([]);
  assert.equal(base.n, 0);
  assert.equal(base.mean, null);
  assert.equal(base.median, null);
});

// -------------------- UNKNOWN exclusion --------------------

test("UNKNOWN exclusion: null/undefined/'' nu intră în baseline", () => {
  const rows = [
    obs(1, "d", "A", 4),
    obs(2, "d", "B", null),
    obs(3, "d", "C", undefined),
    obs(4, "d", "D", ""),
    obs(5, "d", "E", 6)
  ];
  assert.equal(validObservations(rows).length, 2);
  const base = computeLeagueBaseline(rows);
  assert.equal(base.n, 2);
  assert.equal(base.mean, 5, "(4+6)/2");
  // Dacă UNKNOWN ar deveni 0, media ar fi (4+0+0+0+6)/5 = 2.
  assert.notEqual(base.mean, 2);
});

test("UNKNOWN exclusion: 0 real rămâne observaţie validă", () => {
  const base = computeLeagueBaseline([obs(1, "d", "A", 0), obs(2, "d", "B", 4)]);
  assert.equal(base.n, 2);
  assert.equal(base.mean, 2);
  assert.equal(base.min, 0);
});

test("UNKNOWN exclusion: valori negative sau ne-numerice sunt respinse", () => {
  assert.equal(validObservations([obs(1, "d", "A", -1), obs(2, "d", "B", "abc")]).length, 0);
});

// -------------------- referee delta / ratio --------------------

test("referee delta şi ratio: league 4.0, referee 5.0 → +1.0 / 1.25", () => {
  const r = refereeDelta(5.0, 4.0);
  assert.equal(r.delta, 1);
  assert.equal(r.ratio, 1.25);
});

test("referee delta: acelaşi avg în ligi diferite dă delta diferit", () => {
  // Exact motivul pentru care media brută nu este comparabilă între ligi.
  const inHeavyLeague = refereeDelta(5.0, 4.8);
  const inLightLeague = refereeDelta(5.0, 3.2);
  assert.equal(inHeavyLeague.delta, 0.2);
  assert.equal(inLightLeague.delta, 1.8);
  assert.notEqual(inHeavyLeague.delta, inLightLeague.delta);
});

test("referee delta: intrări invalide → null, nu 0", () => {
  assert.deepEqual(refereeDelta(null, 4), { delta: null, ratio: null });
  assert.deepEqual(refereeDelta(4, null), { delta: null, ratio: null });
  assert.equal(refereeDelta(4, 0).ratio, null, "fără împărţire la zero");
});

// -------------------- sample buckets --------------------

test("sample buckets: încadrare corectă pe limite", () => {
  assert.equal(bucketForSample(1).key, "n=1");
  assert.equal(bucketForSample(5).key, "n=5");
  assert.equal(bucketForSample(6).key, "n=6-9");
  assert.equal(bucketForSample(9).key, "n=6-9");
  assert.equal(bucketForSample(10).key, "n=10-14");
  assert.equal(bucketForSample(14).key, "n=10-14");
  assert.equal(bucketForSample(15).key, "n>=15");
  assert.equal(bucketForSample(500).key, "n>=15");
  assert.equal(bucketForSample(0), null);
  assert.equal(bucketForSample(null), null);
});

test("sample buckets: bucket-urile goale sunt raportate cu 0, nu omise", () => {
  const buckets = bucketBySampleSize([{ name: "A", sampleSize: 3, delta: 1 }]);
  assert.equal(buckets.length, 8, "toate cele 8 bucket-uri sunt prezente");
  assert.equal(buckets.find((b) => b.bucket === "n=3").refereeCount, 1);
  assert.equal(buckets.find((b) => b.bucket === "n>=15").refereeCount, 0);
  assert.equal(buckets.find((b) => b.bucket === "n>=15").delta.mean, null);
});

test("sample buckets: statistica delta per bucket", () => {
  const buckets = bucketBySampleSize([
    { name: "A", sampleSize: 3, delta: 1 },
    { name: "B", sampleSize: 3, delta: -1 },
    { name: "C", sampleSize: 3, delta: 3 },
    { name: "D", sampleSize: 20, delta: 0.5 }
  ]);
  const b3 = buckets.find((b) => b.bucket === "n=3");
  assert.equal(b3.refereeCount, 3);
  assert.equal(b3.delta.mean, 1);
  assert.equal(b3.delta.range, 4);
  assert.equal(buckets.find((b) => b.bucket === "n>=15").refereeCount, 1);
});

// -------------------- shrinkage --------------------

test("shrinkage: la n = k estimarea stă exact la mijloc", () => {
  assert.equal(shrinkTowardBaseline(6, 4, 5, 5), 5);
});

test("shrinkage: n=0 → complet baseline; n foarte mare → aproape media arbitrului", () => {
  assert.equal(shrinkTowardBaseline(6, 4, 0, 5), 4);
  assert.ok(Math.abs(shrinkTowardBaseline(6, 4, 1000, 5) - 6) < 0.02);
});

test("shrinkage: k mai mare trage mai tare spre baseline", () => {
  const k3 = shrinkTowardBaseline(6, 4, 3, 3);
  const k5 = shrinkTowardBaseline(6, 4, 3, 5);
  const k10 = shrinkTowardBaseline(6, 4, 3, 10);
  assert.ok(k3 > k5 && k5 > k10, `${k3} > ${k5} > ${k10}`);
  assert.equal(k3, 5, "n=3,k=3 → mijloc");
});

test("shrinkage: exemplul instabil din Increment C (6.333 la n=3) este temperat", () => {
  // Baseline ~4.0. Media brută spune +2.33; cu k=10 rămâne +0.54.
  assert.equal(shrinkTowardBaseline(6.333, 4, 3, 3), 5.167);
  assert.equal(shrinkTowardBaseline(6.333, 4, 3, 10), 4.538);
});

test("shrinkage: intrări invalide → null", () => {
  assert.equal(shrinkTowardBaseline(null, 4, 3, 5), null);
  assert.equal(shrinkTowardBaseline(6, null, 3, 5), null);
  assert.equal(shrinkTowardBaseline(6, 4, -1, 5), null);
  assert.equal(shrinkTowardBaseline(6, 4, 3, -1), null);
});

// -------------------- deterministic ordering --------------------

test("ordering determinism: aceleaşi observaţii în orice ordine dau aceeaşi secvenţă", () => {
  const rows = [
    obs(3, "2026-01-03", "A", 3),
    obs(1, "2026-01-01", "A", 1),
    obs(2, "2026-01-02", "A", 2)
  ];
  assert.deepEqual(sortObservations(rows).map((o) => o.fixtureId), [1, 2, 3]);
  assert.deepEqual(sortObservations([...rows].reverse()).map((o) => o.fixtureId), [1, 2, 3]);
});

test("ordering determinism: dată identică → tie-break pe fixtureId", () => {
  const same = "2026-01-01T12:00:00Z";
  const rows = [obs(9, same, "A", 1), obs(2, same, "A", 2), obs(5, same, "A", 3)];
  assert.deepEqual(sortObservations(rows).map((o) => o.fixtureId), [2, 5, 9]);
  assert.deepEqual(sortObservations([...rows].reverse()).map((o) => o.fixtureId), [2, 5, 9]);
});

test("ordering determinism: walk-forward dă acelaşi rezultat indiferent de ordinea de intrare", () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    obs(i + 1, `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, `Ref${i % 5}`, (i % 7) + 1)
  );
  const a = walkForwardEvaluate(rows);
  const b = walkForwardEvaluate([...rows].reverse());
  assert.deepEqual(b, a);
});

// -------------------- no temporal leakage --------------------

test("no leakage: meciul evaluat nu contribuie la propria predicţie", () => {
  // 10 meciuri de warm-up cu 2 cartonaşe, apoi un outlier de 100.
  // Dacă outlier-ul s-ar include în propria predicţie, eroarea ar fi ~0.
  const rows = [
    ...Array.from({ length: 10 }, (_, i) =>
      obs(i + 1, `2026-01-${String(i + 1).padStart(2, "0")}`, "R", 2)
    ),
    obs(11, "2026-02-01", "R", 100)
  ];
  const res = walkForwardEvaluate(rows, { minPriorLeague: 10, kValues: [3] });
  assert.equal(res.evaluated, 1, "doar meciul 11 este evaluat");
  assert.equal(res.skippedWarmup, 10);
  // Predicţia poate folosi doar cele 10 meciuri anterioare (medie 2) → eroare 98.
  assert.equal(res.metrics.league.mae, 98);
  assert.equal(res.metrics.refereeRaw.mae, 98);
});

test("no leakage: un arbitru nou primeşte baseline-ul, nu propriul rezultat", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) =>
      obs(i + 1, `2026-01-${String(i + 1).padStart(2, "0")}`, "Vechi", 4)
    ),
    obs(11, "2026-02-01", "Nou", 9)
  ];
  const res = walkForwardEvaluate(rows, { minPriorLeague: 10, kValues: [5] });
  assert.equal(res.withRefereePrior, 0, "arbitrul nou nu are istoric anterior");
  assert.equal(res.metrics.refereeRaw.mae, 5, "9 − baseline 4");
});

test("no leakage: istoricul arbitrului creşte strict în timp", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) =>
      obs(i + 1, `2026-01-${String(i + 1).padStart(2, "0")}`, "X", 2)
    ),
    obs(11, "2026-02-01", "R", 8),
    obs(12, "2026-02-02", "R", 8)
  ];
  const res = walkForwardEvaluate(rows, { minPriorLeague: 10, kValues: [3] });
  // Meciul 11: R fără istoric → baseline. Meciul 12: R are exact 1 meci anterior (8).
  assert.equal(res.evaluated, 2);
  assert.equal(res.withRefereePrior, 1);
});

// -------------------- stability --------------------

test("stability: prima jumătate vs a doua, cu extra-meciul în prima", () => {
  const rows = [
    obs(1, "2026-01-01", "R", 2),
    obs(2, "2026-01-02", "R", 2),
    obs(3, "2026-01-03", "R", 2),
    obs(4, "2026-01-04", "R", 6),
    obs(5, "2026-01-05", "R", 6),
    obs(6, "2026-01-06", "R", 6),
    obs(7, "2026-01-07", "R", 6)
  ];
  const halves = splitHalves(rows);
  assert.equal(halves.first.length, 4);
  assert.equal(halves.second.length, 3);
  const s = stabilityForReferee(rows, { minPerHalf: 3 });
  assert.equal(s.firstAvg, 3);
  assert.equal(s.secondAvg, 6);
  assert.equal(s.change, 3);
  assert.equal(s.absError, 3);
});

test("stability: null când o jumătate e sub pragul minim", () => {
  const rows = [obs(1, "2026-01-01", "R", 2), obs(2, "2026-01-02", "R", 4)];
  assert.equal(stabilityForReferee(rows, { minPerHalf: 3 }), null);
});

// -------------------- error metrics --------------------

test("errorMetrics: MAE, RMSE şi bias", () => {
  const m = errorMetrics([2, -2, 2, -2]);
  assert.equal(m.n, 4);
  assert.equal(m.mae, 2);
  assert.equal(m.rmse, 2);
  assert.equal(m.bias, 0, "erorile simetrice se anulează în bias, nu în MAE");
});

test("errorMetrics: listă goală → null, nu 0", () => {
  assert.deepEqual(errorMetrics([]), { n: 0, mae: null, rmse: null, bias: null });
});

// -------------------- cardsTotal vs cardsPoints --------------------

test("unit separation: cardsTotal şi cardsPoints rămân mărimi distincte", () => {
  const rows = [
    obs(1, "2026-01-01", "A", 4, 5), // 3 galbene + 1 roşu
    obs(2, "2026-01-02", "B", 3, 3), // fără roşu
    obs(3, "2026-01-03", "C", 5, 7) // 3 galbene + 2 roşii
  ];
  const cmp = compareUnits(rows);
  assert.equal(cmp.n, 3);
  assert.equal(cmp.cardsTotal.mean, 4);
  assert.equal(cmp.cardsPoints.mean, 5);
  assert.equal(cmp.meanDifference, 1);
  assert.equal(cmp.fixturesWithRedCard, 2);
  assert.equal(cmp.redCardRate, 0.667);
  assert.notEqual(cmp.cardsTotal.mean, cmp.cardsPoints.mean);
});

test("unit separation: un cardsPoints lipsă exclude doar din comparaţie", () => {
  const rows = [obs(1, "d", "A", 4, 5), obs(2, "d", "B", 3, null)];
  assert.equal(compareUnits(rows).n, 1, "comparaţia cere ambele unităţi");
  assert.equal(computeLeagueBaseline(rows).n, 2, "baseline-ul cardsTotal le păstrează pe ambele");
});

test("unit separation: baseline-ul de ligă foloseşte cardsTotal, niciodată cardsPoints", () => {
  const rows = [obs(1, "d", "A", 2, 99), obs(2, "d", "B", 4, 99)];
  assert.equal(computeLeagueBaseline(rows).mean, 3, "cardsPoints=99 nu are efect");
});

// -------------------- describe --------------------

test("describe: sd corectă şi stabilă la reordonare", () => {
  const a = describeStats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(a.mean, 5);
  assert.equal(a.sd, 2);
  assert.deepEqual(describeStats([9, 7, 5, 5, 4, 4, 4, 2]), a);
});
