import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSeasonTransitionWindow,
  DEFAULT_TRANSITION_TARGET
} from "../server-utils/rolling/seasonTransitionWindow.js";

/** Provider-shaped fixture. `day` orders them; higher day = more recent. */
const fx = (id, day, season) => ({
  fixture: {
    id,
    date: `20${season}-${String(Math.floor(day / 28) + 1).padStart(2, "0")}-${String((day % 28) + 1).padStart(2, "0")}T15:00:00Z`
  },
  league: { id: 283, season: 2000 + season }
});
/** n current-season matches, most recent last. */
const current = (n) => Array.from({ length: n }, (_, i) => fx(1000 + i, i + 1, 26));
/** n previous-season matches, most recent last. */
const previous = (n) => Array.from({ length: n }, (_, i) => fx(2000 + i, i + 1, 25));
const ids = (r) => r.matches.map((m) => m.fixture.id);

// -------------------- 1-11. tabelul aprobat --------------------

for (let cur = 0; cur <= 10; cur += 1) {
  const prevNeeded = 10 - cur;
  test(`[${cur + 1}] ${cur} actual + ${prevNeeded} anterior = 10`, () => {
    const r = buildSeasonTransitionWindow(current(cur), previous(10));
    assert.equal(r.fromCurrent, cur);
    assert.equal(r.fromPrevious, prevNeeded);
    assert.equal(r.matches.length, 10);
    assert.equal(r.fromCurrent + r.fromPrevious, r.matches.length);
  });
}

// -------------------- 12. 11 actual → ultimele 10 --------------------

test("[12] 11 actual + 0 anterior → cele mai recente 10 actuale", () => {
  const r = buildSeasonTransitionWindow(current(11), previous(10));
  assert.equal(r.fromCurrent, 10);
  assert.equal(r.fromPrevious, 0);
  assert.equal(r.matches.length, 10);
  assert.ok(!ids(r).includes(1000), "cel mai vechi meci actual trebuia exclus");
  assert.ok(ids(r).includes(1010), "cel mai recent meci actual trebuie inclus");
});

// -------------------- 13. current >= target --------------------

test("[13] current >= target → fromPrevious === 0", () => {
  for (const n of [10, 11, 15, 40]) {
    const r = buildSeasonTransitionWindow(current(n), previous(15));
    assert.equal(r.fromPrevious, 0, `n=${n}`);
    assert.equal(r.fromCurrent, 10);
    assert.equal(r.source, "current_only");
  }
});

// -------------------- 14-16. liste goale --------------------

test("[14] previous gol → fereastra scurta, fara fabricare", () => {
  const r = buildSeasonTransitionWindow(current(4), []);
  assert.equal(r.matches.length, 4);
  assert.equal(r.fromCurrent, 4);
  assert.equal(r.fromPrevious, 0);
  assert.equal(r.source, "current_only");
});

test("[15] current gol → previous-only", () => {
  const r = buildSeasonTransitionWindow([], previous(10));
  assert.equal(r.fromCurrent, 0);
  assert.equal(r.fromPrevious, 10);
  assert.equal(r.source, "previous_only");
});

test("[16] ambele goale → []", () => {
  const r = buildSeasonTransitionWindow([], []);
  assert.deepEqual(r.matches, []);
  assert.equal(r.fromCurrent, 0);
  assert.equal(r.fromPrevious, 0);
  assert.equal(r.source, "insufficient");
});

test("[16] intrari invalide sunt tratate ca liste goale", () => {
  assert.deepEqual(buildSeasonTransitionWindow(null, undefined).matches, []);
  assert.equal(buildSeasonTransitionWindow("nu-i array", 42).source, "insufficient");
});

// -------------------- 17. echipa nou-promovata --------------------

test("[17] echipa noua, fara istoric in liga → doar meciurile actuale, nimic fabricat", () => {
  const r = buildSeasonTransitionWindow(current(4), []);
  assert.equal(r.matches.length, 4, "exact cele 4 meciuri reale, niciunul in plus");
  assert.equal(r.fromPrevious, 0);
  const inputIds = new Set(current(4).map((m) => m.fixture.id));
  for (const m of r.matches) assert.ok(inputIds.has(m.fixture.id), "meci care nu era in input");
});

// -------------------- 18. invarianta de numarare --------------------

test("[18] fromCurrent + fromPrevious === matches.length, pe toate combinatiile", () => {
  for (let c = 0; c <= 14; c += 1) {
    for (let p = 0; p <= 14; p += 1) {
      const r = buildSeasonTransitionWindow(current(c), previous(p));
      assert.equal(r.fromCurrent + r.fromPrevious, r.matches.length, `c=${c} p=${p}`);
      assert.ok(r.matches.length <= DEFAULT_TRANSITION_TARGET, `c=${c} p=${p} depaseste target`);
    }
  }
});

// -------------------- 19-20. determinism --------------------

test("[19] ordonare determinista: acelasi input in orice ordine → acelasi rezultat", () => {
  const c = current(4);
  const p = previous(10);
  const a = buildSeasonTransitionWindow(c, p);
  const b = buildSeasonTransitionWindow([...c].reverse(), [...p].reverse());
  assert.deepEqual(ids(b), ids(a));
  assert.equal(a.matches[0].fixture.id, 1003, "cel mai recent meci actual este primul");
});

test("[20] tie-break pe fixtureId cand data este identica", () => {
  const same = "2026-08-01T15:00:00Z";
  const c = [
    { fixture: { id: 5, date: same } },
    { fixture: { id: 9, date: same } },
    { fixture: { id: 2, date: same } }
  ];
  const r = buildSeasonTransitionWindow(c, [], { target: 3 });
  assert.deepEqual(ids(r), [9, 5, 2], "descrescator dupa id la data egala");
  assert.deepEqual(ids(buildSeasonTransitionWindow([...c].reverse(), [], { target: 3 })), [9, 5, 2]);
});

// -------------------- 21. previous mai lung decat necesarul --------------------

test("[21] previous mai lung → doar cele mai recente necesare", () => {
  const r = buildSeasonTransitionWindow(current(3), previous(40));
  assert.equal(r.fromPrevious, 7);
  const prevIds = ids(r).slice(3);
  assert.deepEqual(prevIds, [2039, 2038, 2037, 2036, 2035, 2034, 2033]);
});

// -------------------- 22. monotonie --------------------

test("[22] monotonie: ponderea actualului creste, a anteriorului scade", () => {
  let lastCur = -1;
  let lastPrev = Infinity;
  for (let c = 0; c <= 10; c += 1) {
    const r = buildSeasonTransitionWindow(current(c), previous(10));
    assert.ok(r.fromCurrent > lastCur, `fromCurrent nu creste la c=${c}`);
    assert.ok(r.fromPrevious < lastPrev, `fromPrevious nu scade la c=${c}`);
    lastCur = r.fromCurrent;
    lastPrev = r.fromPrevious;
  }
  assert.equal(lastCur, 10);
  assert.equal(lastPrev, 0);
});

test("[22] source urmeaza aceeasi progresie", () => {
  assert.equal(buildSeasonTransitionWindow(current(0), previous(10)).source, "previous_only");
  assert.equal(buildSeasonTransitionWindow(current(5), previous(10)).source, "transition");
  assert.equal(buildSeasonTransitionWindow(current(10), previous(10)).source, "current_only");
  assert.equal(buildSeasonTransitionWindow(current(0), []).source, "insufficient");
});

// -------------------- 23. target custom --------------------

test("[23] target custom respecta aceeasi regula", () => {
  const r5 = buildSeasonTransitionWindow(current(2), previous(10), { target: 5 });
  assert.equal(r5.fromCurrent, 2);
  assert.equal(r5.fromPrevious, 3);
  assert.equal(r5.matches.length, 5);

  const r15 = buildSeasonTransitionWindow(current(4), previous(20), { target: 15 });
  assert.equal(r15.fromCurrent, 4);
  assert.equal(r15.fromPrevious, 11);
  assert.equal(r15.matches.length, 15);
});

test("[23] target invalid cade pe implicit, nu pe zero", () => {
  for (const bad of [0, -5, null, undefined, "abc", NaN]) {
    const r = buildSeasonTransitionWindow(current(0), previous(20), { target: bad });
    assert.equal(r.matches.length, DEFAULT_TRANSITION_TARGET, `target=${String(bad)}`);
  }
});

// -------------------- 24. fara mutatie a intrarilor --------------------

test("[24] array-urile de intrare nu sunt mutate", () => {
  const c = current(4);
  const p = previous(10);
  const cBefore = c.map((m) => m.fixture.id);
  const pBefore = p.map((m) => m.fixture.id);
  buildSeasonTransitionWindow(c, p);
  assert.deepEqual(c.map((m) => m.fixture.id), cBefore, "lista actuala a fost reordonata");
  assert.deepEqual(p.map((m) => m.fixture.id), pBefore, "lista anterioara a fost reordonata");
  assert.equal(c.length, 4);
  assert.equal(p.length, 10);
});

// -------------------- forma alternativa de intrare --------------------

test("accepta si forma {fixtureId, date} folosita de modulele de analiza", () => {
  const c = [
    { fixtureId: 1, date: "2026-08-01T15:00:00Z" },
    { fixtureId: 2, date: "2026-08-08T15:00:00Z" }
  ];
  const p = [
    { fixtureId: 100, date: "2025-05-01T15:00:00Z" },
    { fixtureId: 101, date: "2025-05-08T15:00:00Z" }
  ];
  const r = buildSeasonTransitionWindow(c, p, { target: 3 });
  assert.equal(r.fromCurrent, 2);
  assert.equal(r.fromPrevious, 1);
  assert.equal(r.matches[0].fixtureId, 2, "cel mai recent actual primul");
  assert.equal(r.matches[2].fixtureId, 101, "cel mai recent anterior completeaza");
});

// -------------------- separarea listelor --------------------

test("listele nu sunt amestecate inainte de selectie", () => {
  // Un meci din sezonul anterior cu o data artificial mai recenta nu are voie sa
  // inlocuiasca un meci actual — actualul are intotdeauna prioritate.
  const cur = [{ fixture: { id: 1, date: "2026-01-01T00:00:00Z" } }];
  const prev = [{ fixture: { id: 99, date: "2030-01-01T00:00:00Z" } }];
  const r = buildSeasonTransitionWindow(cur, prev, { target: 1 });
  assert.equal(r.fromCurrent, 1);
  assert.equal(r.fromPrevious, 0);
  assert.equal(r.matches[0].fixture.id, 1, "meciul actual are prioritate, oricare ar fi data");
});
