import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

/**
 * Support / feedback — DATABASE integration suite for migration 051.
 *
 * Everything asserted here lives in SQL and cannot be proven from JavaScript:
 * the RLS policies, the CHECK constraints, the internal-note invariant and the
 * FK cascades. tests/supportApi.test.js covers the API contract with fakes; this
 * covers what remains true even if that API is bypassed entirely.
 *
 * The whole migration chain 001..051 is applied to an empty schema, so a clean
 * apply of 051 in order is itself part of what this suite proves.
 *
 * Runs against a throwaway Postgres container, never a real database:
 *   node scripts/run-gsb-integration.mjs tests/integration/supportRls.db.test.js
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TICKET_A = "11111111-1111-4111-8111-111111111111";
const TICKET_B = "22222222-2222-4222-8222-222222222222";

function psql(sqlText, { expectFailure = false } = {}) {
  const res = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-f",
      "-"
    ],
    { input: sqlText, encoding: "utf8" }
  );
  if (!expectFailure && res.status !== 0) {
    throw new Error(`psql failed:\n${res.stderr}\n--- sql ---\n${sqlText}`);
  }
  // `-t -A` suppresses headers but psql still echoes a status tag for every
  // non-SELECT statement. Wrapping a query in a transaction would otherwise turn
  // "0" into "BEGIN\nSET\n0\nCOMMIT", so the tags are dropped and only result
  // rows remain.
  const stdout = (res.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(BEGIN|COMMIT|ROLLBACK|SET|INSERT \d|UPDATE \d|DELETE \d|TRUNCATE TABLE)/.test(line))
    .join("\n");
  return { status: res.status, stdout, stderr: (res.stderr || "").trim() };
}

/** Wraps in a transaction so `set local` is scoped and nothing leaks between cases. */
const tx = (body) => `begin;\n${body}\ncommit;`;

/** Runs statements as the `authenticated` role with a given auth.uid(). */
function asUser(userId, body, opts) {
  return psql(
    tx(
      `set local role authenticated;
       set local "request.jwt.claims" = '{"sub":"${userId}","role":"authenticated"}';
       ${body}`
    ),
    opts
  );
}

before(() => {
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  const migrations = fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    psql(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  psql(`insert into auth.users (id, email) values
        ('${USER_A}', 'a@test.local'), ('${USER_B}', 'b@test.local')
        on conflict (id) do nothing;`);
  psql(`insert into public.profiles (user_id) values ('${USER_A}'), ('${USER_B}')
        on conflict (user_id) do nothing;`);
});

beforeEach(() => {
  psql(`truncate table public.support_tickets, public.feedback_entries cascade;
        insert into public.profiles (user_id) values ('${USER_A}'), ('${USER_B}')
        on conflict (user_id) do nothing;`);
});

/** One ticket per user, plus a visible reply and an internal note on A's. */
function seed() {
  psql(`insert into public.support_tickets (id, user_id, category, subject)
        values ('${TICKET_A}', '${USER_A}', 'technical', 'A ticket'),
               ('${TICKET_B}', '${USER_B}', 'billing', 'B ticket');
        insert into public.support_messages (ticket_id, author_role, body, is_internal_note)
        values ('${TICKET_A}', 'user', 'A vizibil', false),
               ('${TICKET_A}', 'admin', 'nota interna', true);
        insert into public.feedback_entries (user_id, category, message)
        values ('${USER_A}', 'ux', 'A feedback'), ('${USER_B}', 'feature', 'B feedback');`);
}

// ---------------------------------------------------------------- schema ---

test("[schema] cele trei tabele exista cu RLS activ", () => {
  const out = psql(`select c.relname || '|' || c.relrowsecurity
                    from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public'
                      and c.relname in ('support_tickets','support_messages','feedback_entries')
                    order by c.relname;`).stdout;
  assert.equal(
    out,
    ["feedback_entries|true", "support_messages|true", "support_tickets|true"].join("\n"),
    "un tabel lipseste sau are RLS dezactivat"
  );
});

test("[schema] politicile asteptate exista, si NICIUNA pentru update/delete", () => {
  const out = psql(`select tablename || '|' || cmd from pg_policies
                    where schemaname = 'public'
                      and tablename in ('support_tickets','support_messages','feedback_entries')
                    order by tablename, cmd;`).stdout;
  const rows = out.split("\n").filter(Boolean).sort();
  assert.deepEqual(rows, [
    "feedback_entries|INSERT",
    "feedback_entries|SELECT",
    "support_messages|INSERT",
    "support_messages|SELECT",
    "support_tickets|INSERT",
    "support_tickets|SELECT"
  ]);
  assert.ok(!out.includes("UPDATE"), "exista o politica de UPDATE — userul ar putea rescrie date");
  assert.ok(!out.includes("DELETE"), "exista o politica de DELETE");
});

test("[schema] trigger-ul updated_at misca support_tickets", () => {
  psql(`insert into public.support_tickets (id, user_id, category, subject)
        values ('44444444-4444-4444-8444-444444444444', '${USER_A}', 'general', 'x');`);
  const changed = psql(`update public.support_tickets set subject = 'y'
                        where id = '44444444-4444-4444-8444-444444444444';
                        select updated_at > created_at from public.support_tickets
                        where id = '44444444-4444-4444-8444-444444444444';`).stdout;
  assert.equal(changed, "t", "updated_at nu a fost actualizat de trigger");
});

// ------------------------------------------------------------ constraints ---

test("[check] category, status, priority si intervalele numerice sunt impuse", () => {
  const bad = [
    `insert into public.support_tickets (user_id, category, subject) values ('${USER_A}', 'hacking', 's');`,
    `insert into public.support_tickets (user_id, category, subject, status) values ('${USER_A}', 'general', 's', 'escalated');`,
    `insert into public.support_tickets (user_id, category, subject, priority) values ('${USER_A}', 'general', 's', 'urgent');`,
    `insert into public.feedback_entries (user_id, category, message) values ('${USER_A}', 'spam', 'm');`,
    `insert into public.feedback_entries (user_id, category, message, rating) values ('${USER_A}', 'ux', 'm', 6);`,
    `insert into public.feedback_entries (user_id, category, message, would_recommend) values ('${USER_A}', 'ux', 'm', 11);`
  ];
  for (const sql of bad) {
    assert.notEqual(psql(sql, { expectFailure: true }).status, 0, `a fost acceptat: ${sql}`);
  }
});

test("[check] subject gol sau supradimensionat este respins", () => {
  assert.notEqual(
    psql(`insert into public.support_tickets (user_id, category, subject) values ('${USER_A}', 'general', '   ');`, {
      expectFailure: true
    }).status,
    0
  );
  assert.notEqual(
    psql(
      `insert into public.support_tickets (user_id, category, subject) values ('${USER_A}', 'general', '${"a".repeat(201)}');`,
      { expectFailure: true }
    ).status,
    0
  );
});

test("[check] o nota interna nu poate fi autorul unui user, nici prin acces direct", () => {
  psql(`insert into public.support_tickets (id, user_id, category, subject)
        values ('55555555-5555-4555-8555-555555555555', '${USER_A}', 'general', 'x');`);
  const res = psql(
    `insert into public.support_messages (ticket_id, author_role, body, is_internal_note)
     values ('55555555-5555-4555-8555-555555555555', 'user', 'b', true);`,
    { expectFailure: true }
  );
  assert.notEqual(res.status, 0, "constrangerea internal_note_is_admin nu a prins");
  assert.match(res.stderr, /support_messages_internal_note_is_admin/);
});

test("[fk] stergerea tichetului cascadeaza mesajele", () => {
  seed();
  psql(`delete from public.support_tickets where id = '${TICKET_A}';`);
  assert.equal(psql(`select count(*) from public.support_messages where ticket_id = '${TICKET_A}';`).stdout, "0");
});

test("[fk] stergerea profilului cascadeaza tichetele si feedback-ul", () => {
  seed();
  psql(`delete from public.profiles where user_id = '${USER_A}';`);
  assert.equal(psql(`select count(*) from public.support_tickets where user_id = '${USER_A}';`).stdout, "0");
  assert.equal(psql(`select count(*) from public.feedback_entries where user_id = '${USER_A}';`).stdout, "0");
});

// -------------------------------------------------------------------- RLS ---

test("[rls] A nu vede tichetele lui B", () => {
  seed();
  assert.equal(asUser(USER_A, "select count(*) from public.support_tickets;").stdout, "1");
  assert.equal(
    asUser(USER_A, `select count(*) from public.support_tickets where user_id = '${USER_B}';`).stdout,
    "0"
  );
});

test("[rls] A nu vede feedback-ul lui B", () => {
  seed();
  assert.equal(asUser(USER_A, "select count(*) from public.feedback_entries;").stdout, "1");
});

test("[rls] A nu vede mesajele de pe tichetul lui B", () => {
  seed();
  psql(`insert into public.support_messages (ticket_id, author_role, body)
        values ('${TICKET_B}', 'user', 'al lui B');`);
  const out = asUser(USER_A, "select body from public.support_messages;").stdout;
  assert.ok(!out.includes("al lui B"), "A a citit mesajul lui B");
});

test("[rls] userul nu vede notele interne de pe propriul tichet", () => {
  seed();
  const out = asUser(USER_A, "select body from public.support_messages;").stdout;
  assert.ok(out.includes("A vizibil"), "mesajul propriu ar trebui vizibil");
  assert.ok(!out.includes("nota interna"), "nota interna a fost expusa proprietarului");
});

test("[rls] userul nu poate face UPDATE sau DELETE pe propriul tichet", () => {
  seed();
  // Fara politica, comanda reuseste sintactic dar nu atinge niciun rand.
  asUser(USER_A, "update public.support_tickets set status = 'closed';");
  assert.equal(
    psql(`select status from public.support_tickets where user_id = '${USER_A}';`).stdout,
    "open",
    "userul a reusit sa schimbe statusul"
  );
  asUser(USER_A, "delete from public.support_tickets;");
  assert.equal(psql("select count(*) from public.support_tickets;").stdout, "2", "userul a reusit sa stearga");
});

test("[rls] userul nu poate deschide un tichet in numele altcuiva", () => {
  const res = asUser(
    USER_A,
    `insert into public.support_tickets (user_id, category, subject) values ('${USER_B}', 'general', 'furat');`,
    { expectFailure: true }
  );
  assert.notEqual(res.status, 0, "politica de INSERT a permis un user_id strain");
});

test("[rls] userul poate raspunde doar pe tichetul propriu", () => {
  seed();
  const own = asUser(
    USER_A,
    `insert into public.support_messages (ticket_id, author_role, body) values ('${TICKET_A}', 'user', 'raspunsul meu');`
  );
  assert.equal(own.status, 0, "raspunsul pe tichetul propriu a fost refuzat");

  const foreign = asUser(
    USER_A,
    `insert into public.support_messages (ticket_id, author_role, body) values ('${TICKET_B}', 'user', 'intrus');`,
    { expectFailure: true }
  );
  assert.notEqual(foreign.status, 0, "A a scris pe tichetul lui B");
});

test("[rls] userul nu poate scrie ca admin si nici nota interna", () => {
  seed();
  const asAdmin = asUser(
    USER_A,
    `insert into public.support_messages (ticket_id, author_role, body) values ('${TICKET_A}', 'admin', 'sunt admin');`,
    { expectFailure: true }
  );
  assert.notEqual(asAdmin.status, 0, "userul a reusit sa scrie ca admin");

  const note = asUser(
    USER_A,
    `insert into public.support_messages (ticket_id, author_role, body, is_internal_note)
     values ('${TICKET_A}', 'admin', 'nota', true);`,
    { expectFailure: true }
  );
  assert.notEqual(note.status, 0, "userul a reusit sa creeze o nota interna");
});

test("[rls] userul nu poate modifica feedback-ul trimis", () => {
  seed();
  asUser(USER_A, "update public.feedback_entries set message = 'rescris';");
  assert.equal(
    psql(`select message from public.feedback_entries where user_id = '${USER_A}';`).stdout,
    "A feedback",
    "feedback-ul a fost editat"
  );
});

test("[rls] anon nu vede nimic", () => {
  seed();
  const out = psql(
    tx(`set local role anon;
        select (select count(*) from public.support_tickets)
             + (select count(*) from public.support_messages)
             + (select count(*) from public.feedback_entries);`)
  ).stdout;
  assert.equal(out, "0", "anon a citit date de support");
});

test("[grants] service_role vede tot, inclusiv notele interne", () => {
  seed();
  const out = psql(
    tx(`set local role service_role;
        select count(*) from public.support_messages where is_internal_note;`)
  ).stdout;
  assert.equal(out, "1", "service_role nu vede nota interna de care are nevoie inbox-ul admin");
});
