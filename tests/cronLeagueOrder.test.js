import test from "node:test";
import assert from "node:assert/strict";

import { parseCronLeagueIds } from "../server-utils/cronLeagueIds.js";
import { TOP_LEAGUE_IDS } from "../server-utils/modelConstants.js";

/** The order an operator would set for an August refresh: domestic first, UEFA last. */
const DOMESTIC_FIRST = "39,140,135,78,61,88,283,253,2,3,848";
const UEFA = [2, 3, 848];

// -------------------- A. toate cele 11 ligi raman disponibile --------------------

test("[A] ordinea recomandata contine exact aceleasi 11 competitii ca lista canonica", () => {
  const ordered = parseCronLeagueIds(DOMESTIC_FIRST);
  assert.equal(ordered.length, 11);
  assert.deepEqual([...ordered].sort((a, b) => a - b), [...TOP_LEAGUE_IDS].sort((a, b) => a - b));
});

test("[A] lista canonica are 11 competitii — daca se schimba, ordinea din env trebuie revizuita", () => {
  assert.equal(TOP_LEAGUE_IDS.length, 11);
});

// -------------------- B. ordinea configurata este respectata --------------------

test("[B] ordinea din env este pastrata exact", () => {
  assert.deepEqual(parseCronLeagueIds(DOMESTIC_FIRST), [39, 140, 135, 78, 61, 88, 283, 253, 2, 3, 848]);
});

test("[B] ligile domestice sunt procesate INAINTEA competitiilor UEFA", () => {
  const ordered = parseCronLeagueIds(DOMESTIC_FIRST);
  const firstUefaAt = ordered.findIndex((id) => UEFA.includes(id));
  const lastDomesticAt = ordered.reduce((acc, id, i) => (UEFA.includes(id) ? acc : i), -1);
  assert.ok(firstUefaAt > lastDomesticAt, "o competitie UEFA apare inaintea unei ligi domestice");
  assert.equal(ordered[0], 39, "Premier League este prima");
  assert.equal(ordered.at(-1), 848, "Conference League este ultima");
});

test("[B] spatiile din valoarea env nu strica ordinea", () => {
  assert.deepEqual(parseCronLeagueIds(" 39 , 140 ,135 "), [39, 140, 135]);
});

// -------------------- C. fara env override → comportament canonic --------------------

test("[C] variabila nesetata → lista canonica COMPLETA, in ordinea ei", () => {
  assert.deepEqual(parseCronLeagueIds(undefined), TOP_LEAGUE_IDS);
  assert.equal(parseCronLeagueIds(undefined).length, 11);
});

test("[C] variabila goala sau doar spatii → lista canonica completa", () => {
  for (const raw of ["", "   ", "\n", ",", ",,,", " , , "]) {
    assert.deepEqual(parseCronLeagueIds(raw), TOP_LEAGUE_IDS, `a esuat pentru ${JSON.stringify(raw)}`);
  }
});

test("[C] valoare complet invalida → lista canonica, NU o lista trunchiata", () => {
  for (const raw of ["abc", "abc,def", "39;140", "null", "undefined", "-5", "0", "0,0"]) {
    assert.deepEqual(parseCronLeagueIds(raw), TOP_LEAGUE_IDS, `a esuat pentru ${JSON.stringify(raw)}`);
  }
});

test("[C] regresie: liga 0 nu mai poate aparea in lista procesata", () => {
  // `Number("") === 0` si 0 este finit — asa producea versiunea anterioara `[0]` dintr-o
  // variabila nesetata, iar fallback-ul nu se mai declansa. Aici sunt toate formele.
  for (const raw of [undefined, "", "39,140,,135", "39,140,135,", ",39", "0,39"]) {
    assert.ok(!parseCronLeagueIds(raw).includes(0), `liga 0 a intrat pentru ${JSON.stringify(raw)}`);
  }
});

test("[C] un segment gol nu mai injecteaza o liga fantoma si nu pierde ligile valide", () => {
  assert.deepEqual(parseCronLeagueIds("39,140,,135"), [39, 140, 135]);
  assert.deepEqual(parseCronLeagueIds("39,140,135,"), [39, 140, 135]);
  assert.deepEqual(parseCronLeagueIds(",39,140"), [39, 140]);
});

test("[C] fallback-ul returneaza o COPIE — apelantul nu poate muta lista canonica", () => {
  const first = parseCronLeagueIds(undefined);
  first.push(9999);
  first.sort((a, b) => b - a);
  assert.equal(TOP_LEAGUE_IDS.length, 11, "lista canonica a fost mutata");
  assert.deepEqual(parseCronLeagueIds(undefined), TOP_LEAGUE_IDS);
});

// -------------------- D. duplicatele sunt eliminate --------------------

test("[D] duplicatele sunt eliminate, prima aparitie decide pozitia", () => {
  assert.deepEqual(parseCronLeagueIds("39,140,39,135,140"), [39, 140, 135]);
  assert.deepEqual(parseCronLeagueIds("39,39,39"), [39]);
});

test("[D] duplicatele scrise diferit sunt tot duplicate", () => {
  assert.deepEqual(parseCronLeagueIds("39, 39 ,39"), [39]);
});

// -------------------- E. ID-uri necunoscute --------------------

test("[E] un id valid dar necunoscut listei canonice trece mai departe, ca inainte", () => {
  // Validarea aici ar fi o a doua opinie despre ce competitii exista. Nu o dam.
  assert.deepEqual(parseCronLeagueIds("39,99999,140"), [39, 99999, 140]);
  assert.ok(!TOP_LEAGUE_IDS.includes(99999), "99999 chiar este necunoscut");
});

test("[E] doar id-urile MALFORMATE sunt eliminate, nu cele necunoscute", () => {
  assert.deepEqual(parseCronLeagueIds("39,abc,140"), [39, 140]);
  assert.deepEqual(parseCronLeagueIds("39,-5,140"), [39, 140], "id negativ eliminat");
  assert.deepEqual(parseCronLeagueIds("39,39.7,140"), [39, 140], "id non-intreg eliminat");
  assert.deepEqual(parseCronLeagueIds("39,0,140"), [39, 140], "liga 0 eliminata");
});

// -------------------- F. UEFA nu este eliminata --------------------

test("[F] toate cele trei competitii UEFA raman in lista procesata", () => {
  const ordered = parseCronLeagueIds(DOMESTIC_FIRST);
  for (const id of UEFA) assert.ok(ordered.includes(id), `competitia UEFA ${id} lipseste`);
});

test("[F] UEFA este mutata mai tarziu, nu scoasa — si ramane in fallback", () => {
  for (const id of UEFA) assert.ok(parseCronLeagueIds(undefined).includes(id));
});

// -------------------- G. consumatorul din aval primeste leagueId-ul corect --------------------
//
// Bucla cron face `for (const leagueId of leagueIds)` si trimite fiecare leagueId mai
// departe. Ce se poate afirma AICI este ca parserul livreaza exact un id valid per
// iteratie, nemodificat de pozitie. Asertiunea end-to-end — ca filtrarea rolling chiar
// pastreaza doar competitia primita — traieste in tests/leagueScopedRolling.test.js,
// impreuna cu functia pe care o verifica.

test("[G] fiecare iteratie primeste un id pozitiv, intreg, distinct — in ambele ordini", () => {
  for (const order of [parseCronLeagueIds(DOMESTIC_FIRST), parseCronLeagueIds(undefined)]) {
    assert.equal(new Set(order).size, order.length, "un id se repeta intre iteratii");
    for (const leagueId of order) {
      assert.ok(Number.isInteger(leagueId) && leagueId > 0, `id invalid livrat: ${leagueId}`);
      assert.equal(Number(leagueId), leagueId, "id-ul nu este deja numeric");
    }
  }
});

test("[G] pozitia in lista nu schimba id-ul livrat pentru o liga", () => {
  const early = parseCronLeagueIds("283,39,2");
  const late = parseCronLeagueIds("39,2,283");
  assert.equal(early.indexOf(283), 0);
  assert.equal(late.indexOf(283), 2, "aceeasi liga, alta pozitie");
  assert.equal(early[0], late[2], "acelasi id, indiferent de pozitie");
  assert.deepEqual([...early].sort((a, b) => a - b), [...late].sort((a, b) => a - b));
});

// -------------------- H. bugetul schimba doar cat se ajunge, nu setul --------------------

test("[H] setul procesat este identic cu cel canonic — difera doar ordinea", () => {
  const ordered = parseCronLeagueIds(DOMESTIC_FIRST);
  assert.deepEqual(new Set(ordered), new Set(TOP_LEAGUE_IDS), "setul de competitii s-a schimbat");
  assert.notDeepEqual(ordered, TOP_LEAGUE_IDS, "ordinea chiar difera de cea canonica");
});

test("[H] cu buget limitat, prefixul atins este domestic — UEFA ramane in lista, doar mai tarziu", () => {
  // Bucla cron consuma bugetul in ordinea listei. Modelam doar prefixul atins: nicio liga
  // nu este eliminata din lista, doar amanata pentru o rulare urmatoare.
  const ordered = parseCronLeagueIds(DOMESTIC_FIRST);
  const reachedWithSmallBudget = ordered.slice(0, 3);
  assert.deepEqual(reachedWithSmallBudget, [39, 140, 135]);
  assert.ok(
    reachedWithSmallBudget.every((id) => !UEFA.includes(id)),
    "bugetul mic ajunge tot la UEFA"
  );
  assert.equal(ordered.length, 11, "lista completa ramane disponibila pentru rularile urmatoare");
});
