import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTEXT_KEYS,
  FEEDBACK_CATEGORIES,
  LIMITS,
  RATE_LIMITS,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  handleFeedback,
  handlePredictionReport,
  handleSupport,
  handleSupportApi,
  handleSupportList,
  handleSupportReply,
  normalizeContext,
  validateFeedbackPayload,
  validateReplyPayload,
  validateSupportPayload
} from "../server-utils/supportApi.js";

/**
 * The handlers take their dependencies as an argument, so everything below runs
 * against fakes: no Postgres, no KV, no network. What is actually asserted is
 * the contract the database cannot enforce on its own — that user_id comes from
 * the token, that author_role is a literal, that a rate limit refusal stops the
 * write — plus the validation the database duplicates as CHECK constraints.
 */

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";

function fakeRes() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    }
  };
}

/** Records every insert so a test can assert what would have reached Postgres. */
function fakeSupabase({ tickets = [], messages = [], failOn = null } = {}) {
  const inserts = [];
  const state = { support_tickets: [...tickets], support_messages: [...messages], feedback_entries: [] };

  function applyFilters(rows, filters) {
    return (rows || []).filter((row) =>
      Object.entries(filters).every(([column, value]) =>
        Array.isArray(value) ? value.includes(row[column]) : row[column] === value
      )
    );
  }

  function table(name) {
    const query = {
      _filters: {},
      insert(row) {
        if (failOn === name) {
          const failure = { data: null, error: { message: "boom", code: "23514" } };
          return {
            select: () => ({ single: async () => failure }),
            then: (resolve) => resolve({ error: failure.error })
          };
        }
        inserts.push({ table: name, row });
        const stored = { id: name === "support_tickets" ? TICKET_ID : `row-${inserts.length}`, ...row };
        state[name].push(stored);
        return {
          select: () => ({ single: async () => ({ data: stored, error: null }) }),
          // An insert without .select() is awaited directly.
          then: (resolve) => resolve({ error: null })
        };
      },
      select() {
        return query;
      },
      eq(column, value) {
        query._filters[column] = value;
        return query;
      },
      in(column, values) {
        query._filters[column] = values;
        return query;
      },
      order() {
        return query;
      },
      limit() {
        return Promise.resolve({ data: applyFilters(state[name], query._filters), error: null });
      },
      maybeSingle() {
        const rows = applyFilters(state[name], query._filters);
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      then(resolve) {
        return resolve({ data: applyFilters(state[name], query._filters), error: null });
      }
    };
    return query;
  }

  return { from: table, inserts, state };
}

function deps({ user = { id: USER_A }, authOk = true, authStatus = 401, limitOk = true, supabase } = {}) {
  const client = supabase || fakeSupabase();
  return {
    getRequester: async () =>
      authOk ? { ok: true, user } : { ok: false, status: authStatus, error: "Token invalid sau expirat." },
    checkUserRateLimit: async () => (limitOk ? { ok: true } : { ok: false, retryAfterSec: 3600 }),
    getSupabaseAdmin: () => client,
    assertSupabaseConfigured: () => ({ ok: true })
  };
}

const req = (overrides = {}) => ({ method: "POST", query: {}, body: {}, ...overrides });

const validTicket = {
  category: "technical",
  subject: "Aplicaţia nu încarcă",
  message: "Ecranul rămâne gol după login."
};

// ============================================================== AUTH ========

test("[auth] fără token → 401 şi nicio scriere", async () => {
  const supabase = fakeSupabase();
  const res = fakeRes();
  await handleSupport(req({ body: validTicket }), res, deps({ authOk: false, supabase }));
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);
  assert.equal(supabase.inserts.length, 0, "nimic nu trebuie scris fără autentificare");
});

test("[auth] token invalid → statusul venit de la getRequester", async () => {
  const res = fakeRes();
  await handleFeedback(req({ body: { category: "ux", message: "x" } }), res, deps({ authOk: false, authStatus: 401 }));
  assert.equal(res.statusCode, 401);
});

test("[auth] toate rutele cer autentificare", async () => {
  for (const handler of [handleSupport, handleFeedback, handlePredictionReport, handleSupportReply, handleSupportList]) {
    const res = fakeRes();
    await handler(req(), res, deps({ authOk: false }));
    assert.equal(res.statusCode, 401, `${handler.name} a răspuns ${res.statusCode}`);
  }
});

// =========================================================== SUPPORT ========

test("[support] creează tichetul şi primul mesaj", async () => {
  const supabase = fakeSupabase();
  const res = fakeRes();
  await handleSupport(req({ body: validTicket }), res, deps({ supabase }));

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
  const [ticket, message] = supabase.inserts;
  assert.equal(ticket.table, "support_tickets");
  assert.equal(ticket.row.category, "technical");
  assert.equal(ticket.row.subject, "Aplicaţia nu încarcă");
  assert.equal(message.table, "support_messages");
  assert.equal(message.row.body, "Ecranul rămâne gol după login.");
});

test("[support] user_id vine din requester, nu din body", async () => {
  const supabase = fakeSupabase();
  const res = fakeRes();
  await handleSupport(
    req({ body: { ...validTicket, user_id: USER_B, userId: USER_B } }),
    res,
    deps({ user: { id: USER_A }, supabase })
  );
  assert.equal(supabase.inserts[0].row.user_id, USER_A, "clientul a reuşit să impună alt user_id");
});

test("[support] clientul nu poate impune status sau alte coloane interne", async () => {
  const supabase = fakeSupabase();
  const res = fakeRes();
  await handleSupport(
    req({ body: { ...validTicket, status: "closed", id: "forced", updated_at: "2000-01-01" } }),
    res,
    deps({ supabase })
  );
  const row = supabase.inserts[0].row;
  assert.equal(row.status, undefined, "status trebuie lăsat pe default-ul din DB");
  assert.equal(row.id, undefined);
  assert.equal(row.updated_at, undefined);
});

test("[support] mesajul iniţial este scris ca 'user' şi niciodată ca notă internă", async () => {
  const supabase = fakeSupabase();
  await handleSupport(
    req({ body: { ...validTicket, author_role: "admin", is_internal_note: true } }),
    fakeRes(),
    deps({ supabase })
  );
  const message = supabase.inserts[1].row;
  assert.equal(message.author_role, "user");
  assert.equal(message.is_internal_note, false);
});

test("[support] category invalid → 400", async () => {
  const res = fakeRes();
  await handleSupport(req({ body: { ...validTicket, category: "hacking" } }), res, deps());
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /category invalid/);
});

test("[support] priority invalid → 400, priority absent → normal", () => {
  assert.equal(validateSupportPayload({ ...validTicket, priority: "urgent" }).ok, false);
  assert.equal(validateSupportPayload(validTicket).value.priority, "normal");
  for (const priority of SUPPORT_PRIORITIES) {
    assert.equal(validateSupportPayload({ ...validTicket, priority }).value.priority, priority);
  }
});

test("[support] subject gol sau doar spaţii → 400", () => {
  assert.equal(validateSupportPayload({ ...validTicket, subject: "" }).ok, false);
  assert.equal(validateSupportPayload({ ...validTicket, subject: "   " }).ok, false);
});

test("[support] subject supradimensionat → 400", () => {
  const result = validateSupportPayload({ ...validTicket, subject: "a".repeat(LIMITS.subject + 1) });
  assert.equal(result.ok, false);
  assert.match(result.error, /subject/);
  assert.equal(validateSupportPayload({ ...validTicket, subject: "a".repeat(LIMITS.subject) }).ok, true);
});

test("[support] message supradimensionat → 400", () => {
  const result = validateSupportPayload({ ...validTicket, message: "a".repeat(LIMITS.message + 1) });
  assert.equal(result.ok, false);
  assert.match(result.error, /message/);
});

test("[support] toate categoriile documentate sunt acceptate", () => {
  for (const category of SUPPORT_CATEGORIES) {
    assert.equal(validateSupportPayload({ ...validTicket, category }).ok, true, category);
  }
});

test("[support] GET returnează doar tichetele proprii, fără note interne", async () => {
  const supabase = fakeSupabase({
    tickets: [
      { id: TICKET_ID, user_id: USER_A, subject: "al meu" },
      { id: "other", user_id: USER_B, subject: "al altuia" }
    ],
    messages: [
      { id: "m1", ticket_id: TICKET_ID, is_internal_note: false, body: "vizibil" },
      { id: "m2", ticket_id: TICKET_ID, is_internal_note: true, body: "notă internă" }
    ]
  });
  const res = fakeRes();
  await handleSupportList(req({ method: "GET" }), res, deps({ supabase }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.tickets.length, 1);
  assert.equal(res.payload.tickets[0].id, TICKET_ID);
  const bodies = res.payload.tickets[0].messages.map((m) => m.body);
  assert.deepEqual(bodies, ["vizibil"]);
  assert.ok(!bodies.includes("notă internă"), "o notă internă a ajuns la user");
});

// ============================================================= REPLY ========

test("[reply] doar pe tichetul propriu; al altuia → 404", async () => {
  const supabase = fakeSupabase({ tickets: [{ id: TICKET_ID, user_id: USER_B, status: "open" }] });
  const res = fakeRes();
  await handleSupportReply(
    req({ query: { action: "reply" }, body: { ticketId: TICKET_ID, body: "salut" } }),
    res,
    deps({ user: { id: USER_A }, supabase })
  );
  assert.equal(res.statusCode, 404, "un tichet străin nu trebuie confirmat ca existent");
  assert.equal(supabase.inserts.length, 0);
});

test("[reply] pe tichetul propriu → 201, ca 'user', fără notă internă", async () => {
  const supabase = fakeSupabase({ tickets: [{ id: TICKET_ID, user_id: USER_A, status: "open" }] });
  const res = fakeRes();
  await handleSupportReply(
    req({ query: { action: "reply" }, body: { ticketId: TICKET_ID, body: "mai am o informaţie" } }),
    res,
    deps({ user: { id: USER_A }, supabase })
  );
  assert.equal(res.statusCode, 201);
  const row = supabase.inserts[0].row;
  assert.equal(row.author_role, "user");
  assert.equal(row.is_internal_note, false);
});

test("[reply] clientul nu poate pretinde author_role=admin sau notă internă", async () => {
  const supabase = fakeSupabase({ tickets: [{ id: TICKET_ID, user_id: USER_A, status: "open" }] });
  await handleSupportReply(
    req({
      query: { action: "reply" },
      body: { ticketId: TICKET_ID, body: "x", author_role: "admin", is_internal_note: true }
    }),
    fakeRes(),
    deps({ supabase })
  );
  const row = supabase.inserts[0].row;
  assert.equal(row.author_role, "user", "clientul a reuşit să scrie ca admin");
  assert.equal(row.is_internal_note, false, "clientul a reuşit să creeze o notă internă");
});

test("[reply] tichet închis → 409", async () => {
  const supabase = fakeSupabase({ tickets: [{ id: TICKET_ID, user_id: USER_A, status: "closed" }] });
  const res = fakeRes();
  await handleSupportReply(
    req({ query: { action: "reply" }, body: { ticketId: TICKET_ID, body: "x" } }),
    res,
    deps({ supabase })
  );
  assert.equal(res.statusCode, 409);
  assert.equal(supabase.inserts.length, 0);
});

test("[reply] ticketId care nu este uuid → 400", () => {
  assert.equal(validateReplyPayload({ ticketId: "1 OR 1=1", body: "x" }).ok, false);
  assert.equal(validateReplyPayload({ ticketId: TICKET_ID, body: "" }).ok, false);
  assert.equal(validateReplyPayload({ ticketId: TICKET_ID, body: "x" }).ok, true);
});

// ========================================================== FEEDBACK ========

test("[feedback] creează intrarea cu user_id-ul requesterului", async () => {
  const supabase = fakeSupabase();
  const res = fakeRes();
  await handleFeedback(
    req({ body: { category: "ux", message: "Butonul e prea mic", rating: 4, wouldRecommend: 9, user_id: USER_B } }),
    res,
    deps({ user: { id: USER_A }, supabase })
  );
  assert.equal(res.statusCode, 201);
  const row = supabase.inserts[0].row;
  assert.equal(row.user_id, USER_A);
  assert.equal(row.rating, 4);
  assert.equal(row.would_recommend, 9);
});

test("[feedback] category invalid → 400; toate cele documentate trec", () => {
  assert.equal(validateFeedbackPayload({ category: "spam", message: "x" }).ok, false);
  for (const category of FEEDBACK_CATEGORIES) {
    assert.equal(validateFeedbackPayload({ category, message: "x" }).ok, true, category);
  }
});

test("[feedback] rating în afara domeniului 1-5 → 400", () => {
  for (const rating of [0, 6, -1, 2.5, "many"]) {
    assert.equal(validateFeedbackPayload({ category: "ux", message: "x", rating }).ok, false, String(rating));
  }
  for (const rating of [1, 3, 5]) {
    assert.equal(validateFeedbackPayload({ category: "ux", message: "x", rating }).value.rating, rating);
  }
  assert.equal(validateFeedbackPayload({ category: "ux", message: "x" }).value.rating, null);
});

test("[feedback] wouldRecommend în afara domeniului 0-10 → 400", () => {
  for (const value of [-1, 11, 4.5, "yes"]) {
    assert.equal(
      validateFeedbackPayload({ category: "ux", message: "x", wouldRecommend: value }).ok,
      false,
      String(value)
    );
  }
  assert.equal(validateFeedbackPayload({ category: "ux", message: "x", wouldRecommend: 0 }).value.would_recommend, 0);
  assert.equal(validateFeedbackPayload({ category: "ux", message: "x", wouldRecommend: 10 }).value.would_recommend, 10);
});

test("[feedback] message gol sau supradimensionat → 400", () => {
  assert.equal(validateFeedbackPayload({ category: "ux", message: "   " }).ok, false);
  assert.equal(validateFeedbackPayload({ category: "ux", message: "a".repeat(LIMITS.message + 1) }).ok, false);
});

// ================================================= PREDICTION REPORT ========

test("[report] fără context → 400", async () => {
  const res = fakeRes();
  await handlePredictionReport(req({ body: { category: "prediction", message: "greşit" } }), res, deps());
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /context/);
});

test("[report] context care nu este obiect → 400", async () => {
  for (const context of [["fixtureId"], "fixtureId=1", 42, true]) {
    const res = fakeRes();
    await handlePredictionReport(req({ body: { category: "prediction", message: "greşit", context } }), res, deps());
    assert.equal(res.statusCode, 400, JSON.stringify(context));
  }
});

test("[report] persistă categoria şi contextul, cu subiect derivat", async () => {
  const supabase = fakeSupabase();
  const res = fakeRes();
  await handlePredictionReport(
    req({
      body: {
        category: "prediction",
        message: "Recomandarea nu se potriveşte cu cota",
        context: { fixtureId: 12345, leagueId: 283, market: "Over/Under", recommendation: "Over 2.5" }
      }
    }),
    res,
    deps({ supabase })
  );
  assert.equal(res.statusCode, 201);
  const row = supabase.inserts[0].row;
  assert.equal(row.category, "prediction");
  assert.deepEqual(row.context, {
    fixtureId: 12345,
    leagueId: 283,
    market: "Over/Under",
    recommendation: "Over 2.5"
  });
  assert.ok(row.subject.length > 0, "subiectul trebuie derivat când formularul nu are câmp");
});

test("[report] acceptă doar categoriile prediction şi gsb", async () => {
  for (const category of ["technical", "billing", "general"]) {
    const res = fakeRes();
    await handlePredictionReport(req({ body: { category, message: "x", context: { fixtureId: 1 } } }), res, deps());
    assert.equal(res.statusCode, 400, category);
  }
  const ok = fakeRes();
  await handlePredictionReport(
    req({ body: { category: "gsb", message: "x", context: { specialBetId: "abc" } } }),
    ok,
    deps()
  );
  assert.equal(ok.statusCode, 201);
});

// =========================================================== CONTEXT ========

test("[context] respinge array, string, număr şi boolean", () => {
  for (const value of [[], ["a"], "abc", 1, true]) {
    assert.equal(normalizeContext(value).ok, false, JSON.stringify(value));
  }
  assert.deepEqual(normalizeContext(null), { ok: true, value: null });
  assert.deepEqual(normalizeContext(undefined), { ok: true, value: null });
});

test("[context] respinge câmpuri care ar putea fi confundate cu metadata de încredere", () => {
  for (const key of ["userId", "user_id", "role", "isAdmin", "status", "priority"]) {
    const result = normalizeContext({ [key]: "x" });
    assert.equal(result.ok, false, key);
    assert.match(result.error, /nepermis/);
  }
});

test("[context] acceptă doar cheile din allow-list, cu valori primitive", () => {
  const result = normalizeContext({ fixtureId: 1, market: "BTTS", probability: 0.61 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { fixtureId: 1, market: "BTTS", probability: 0.61 });
  assert.equal(normalizeContext({ fixtureId: { nested: true } }).ok, false);
  assert.equal(normalizeContext({ fixtureId: [1, 2] }).ok, false);
});

test("[context] respinge valori şi obiecte supradimensionate", () => {
  assert.equal(normalizeContext({ market: "a".repeat(LIMITS.contextValue + 1) }).ok, false);
  const many = {};
  for (let i = 0; i < LIMITS.contextKeys + 1; i += 1) many[`k${i}`] = 1;
  assert.equal(normalizeContext(many).ok, false);
});

test("[context] allow-list acoperă identificatorii de predicţie şi de special bet", () => {
  for (const key of ["fixtureId", "leagueId", "market", "recommendation", "specialBetId", "variant", "odds"]) {
    assert.ok(CONTEXT_KEYS.has(key), `${key} lipseşte din allow-list`);
  }
});

// ======================================================== RATE LIMIT ========

test("[rate] refuzul limiterului opreşte scrierea şi răspunde 429", async () => {
  for (const handler of [handleSupport, handleFeedback, handlePredictionReport]) {
    const supabase = fakeSupabase();
    const res = fakeRes();
    await handler(
      req({ body: { ...validTicket, category: "prediction", context: { fixtureId: 1 } } }),
      res,
      deps({ limitOk: false, supabase })
    );
    assert.equal(res.statusCode, 429, handler.name);
    assert.equal(supabase.inserts.length, 0, `${handler.name} a scris deşi era limitat`);
    assert.equal(res.payload.retryAfterSec, 3600);
  }
});

test("[rate] limiterul primeşte id-ul requesterului, deci utilizatorii sunt izolaţi", async () => {
  const seen = [];
  const spy = {
    ...deps(),
    checkUserRateLimit: async (userId, opts) => {
      seen.push([userId, opts.namespace]);
      return { ok: true };
    }
  };

  await handleSupport(req({ body: validTicket }), fakeRes(), {
    ...spy,
    getRequester: async () => ({ ok: true, user: { id: USER_A } })
  });
  await handleSupport(req({ body: validTicket }), fakeRes(), {
    ...spy,
    getRequester: async () => ({ ok: true, user: { id: USER_B } })
  });

  assert.deepEqual(seen, [
    [USER_A, "support"],
    [USER_B, "support"]
  ]);
});

test("[rate] fiecare flux are propriul namespace şi propria cotă", async () => {
  const seen = [];
  const spy = {
    ...deps(),
    checkUserRateLimit: async (_userId, opts) => {
      seen.push(opts);
      return { ok: true };
    }
  };
  await handleSupport(req({ body: validTicket }), fakeRes(), spy);
  await handleFeedback(req({ body: { category: "ux", message: "x" } }), fakeRes(), spy);
  await handlePredictionReport(
    req({ body: { category: "prediction", message: "x", context: { fixtureId: 1 } } }),
    fakeRes(),
    spy
  );
  await handleSupportReply(req({ body: { ticketId: TICKET_ID, body: "x" } }), fakeRes(), {
    ...spy,
    getSupabaseAdmin: () => fakeSupabase({ tickets: [{ id: TICKET_ID, user_id: USER_A, status: "open" }] })
  });

  assert.deepEqual(
    seen.map((o) => o.namespace),
    ["support", "feedback", "prediction-report", "support-reply"]
  );
  assert.deepEqual(
    seen.map((o) => o.maxPerHour),
    [RATE_LIMITS.support, RATE_LIMITS.feedback, RATE_LIMITS["prediction-report"], RATE_LIMITS.reply]
  );
});

// ========================================================== DISPATCH ========

test("[dispatch] view necunoscut → 404", async () => {
  const res = fakeRes();
  await handleSupportApi(req({ query: { view: "admin" } }), res, deps());
  assert.equal(res.statusCode, 404);
});

test("[dispatch] metodă nepermisă pe fiecare view", async () => {
  for (const view of ["feedback", "prediction-report"]) {
    const res = fakeRes();
    await handleSupportApi(req({ method: "GET", query: { view } }), res, deps());
    assert.equal(res.statusCode, 405, view);
  }
  const res = fakeRes();
  await handleSupportApi(req({ method: "DELETE", query: { view: "support" } }), res, deps());
  assert.equal(res.statusCode, 405);
});

test("[dispatch] POST support cu action=reply ajunge la reply", async () => {
  const supabase = fakeSupabase({ tickets: [{ id: TICKET_ID, user_id: USER_A, status: "open" }] });
  const res = fakeRes();
  await handleSupportApi(
    req({ query: { view: "support", action: "reply" }, body: { ticketId: TICKET_ID, body: "x" } }),
    res,
    deps({ supabase })
  );
  assert.equal(res.statusCode, 201);
  assert.equal(supabase.inserts[0].table, "support_messages");
});

test("[dispatch] o eroare de DB devine 500 generic, fără detalii interne", async () => {
  const supabase = fakeSupabase({ failOn: "support_tickets" });
  const res = fakeRes();
  await handleSupportApi(req({ query: { view: "support" }, body: validTicket }), res, deps({ supabase }));
  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.error, "Nu am putut procesa cererea.");
  assert.ok(!JSON.stringify(res.payload).includes("23514"), "codul de constrângere nu trebuie expus");
});
