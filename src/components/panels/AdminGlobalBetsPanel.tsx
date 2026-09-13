import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Banner, Button, Card, EmptyState, ErrorState, SectionHeader, Skeleton } from "../../design-system";
import {
  GLOBAL_VARIANTS,
  GlobalTicketAdminError,
  fetchGlobalTickets,
  generateGlobalTicket,
  isUnavailable,
  publishGlobalTicket,
  type GlobalTicket,
  type PoolState,
  type GlobalVariant
} from "../../services/globalTicketAdminService";
import {
  describeLifecycle,
  describeSettlement,
  oddsBucketLabel,
  summarizeWonGlobalTickets,
  type GlobalBetsKpi
} from "../../utils/adminGlobalBetsView";
import { fetchFixtureStates, normalizeFixtureIds, type FixtureState } from "../../services/fixtureStateService";
import { describeFixture } from "../../utils/fixtureStateView";

/**
 * Admin → Betting → Global Bets.
 *
 * The FIRST production surface for Global Tickets. A Global Ticket is the
 * product's own ticket: built from every league the model has predicted, owned
 * by nobody, and released to users only by an explicit publish step.
 *
 * ── WHAT THIS COMPONENT DOES NOT DO ──────────────────────────────────────────
 * It does not decide anything. No eligibility rule, no league filter, no
 * selection logic and no variant-availability check lives here — the server owns
 * all four, and duplicating any of them would create a second copy free to
 * drift. The panel sends a variant and renders the answer.
 *
 * In particular it never sends the admin's own leagues or favourites. A Global
 * Ticket that narrowed to whoever pressed the button would be a different
 * product wearing the same name.
 *
 * ── THE STATES THAT MATTER ───────────────────────────────────────────────────
 * "Nothing was built" has two distinct causes calling for different actions, so
 * they are never collapsed into one message:
 *
 *   no_populated_predictions   nothing carries a candidate projection yet — the
 *                              historical backfill has not been run
 *   insufficient_candidates    the pool exists but is thinner than the variant
 *                              needs — wait for more fixtures
 *
 * A thin pool is NOT an error: the server answers 200 and this renders it as
 * information. Padding a ticket, substituting a smaller variant or retrying with
 * fewer legs are all refused server-side, and nothing here works around that.
 */

type Status = "idle" | "loading" | "generating" | "publishing";

/**
 * How many legs the generator builds. A SIZE, not a price.
 *
 * Still "Combo N" and deliberately so: this labels the control that chooses
 * `variant`, a smallint the database constrains to (3,5,8) and checks against
 * the selection count. The card's category headline is the ODDS bucket, read
 * from `total_odds`; the two are never swapped, because an eight-leg ticket at
 * short prices and a three-leg ticket at long ones are the same size and
 * completely different bets.
 */
const VARIANT_LABEL: Record<number, string> = { 3: "Combo 3", 5: "Combo 5", 8: "Combo 8" };

/** Server error code -> what an operator should read. No server prose reaches the screen. */
const ERROR_COPY: Record<string, string> = {
  invalid_variant: "Varianta cerută nu este disponibilă.",
  unsupported_bet_kind: "Biletele Sistem nu sunt încă disponibile pentru Global Bets.",
  already_published: "Biletul a fost deja publicat.",
  not_global: "Biletul nu este un bilet Global.",
  not_found: "Biletul nu a fost găsit.",
  missing_id: "Lipsește identificatorul biletului."
};

function errorCopy(err: unknown): string {
  if (err instanceof GlobalTicketAdminError) {
    if (err.status === 401) return "Sesiune expirată. Autentifică-te din nou.";
    if (err.status === 403) return "Este necesar acces de administrator.";
    if (err.code && ERROR_COPY[err.code]) return ERROR_COPY[err.code];
  }
  return "Nu am putut contacta serverul. Încearcă din nou.";
}

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ro-RO") : "—");
const formatOdds = (odds: number | null) => (odds == null ? "—" : odds.toFixed(2));

/**
 * What the ticket RETURNED, from `special_bets.status` and nothing else.
 *
 * This badge used to not exist, and its absence was the defect: the card showed
 * only the lifecycle badge below, so a won ticket and a lost one both read
 * "Închis" and an operator could not tell them apart without opening Details and
 * grading eight legs by eye. Migration 068 is explicit that the two are separate
 * ("VISIBILITY IS NOT STATUS… `status` means settlement and a draft is not a
 * settlement state"), so the card now states both, separately.
 *
 * Renders nothing when the row carries a status this app does not model — an
 * unknown value is not evidence of a result, and the lifecycle badge still shows.
 */
function TicketSettlementBadge({ status }: { status: string }) {
  const settlement = describeSettlement(status);
  if (!settlement) return null;
  // Wrapped rather than adding a test hook to Badge: the design-system component
  // takes children, tone and className only, and widening its props for a test
  // anchor would change a shared primitive to suit one panel.
  return (
    <span data-testid="ticket-settlement">
      <Badge tone={settlement.tone}>{settlement.label}</Badge>
    </span>
  );
}

/** Draft / published / settled — where the ticket sits in its RELEASE lifecycle. */
function TicketStateBadge({ ticket }: { ticket: GlobalTicket }) {
  const lifecycle = describeLifecycle(ticket);
  return (
    <span data-testid="ticket-lifecycle">
      <Badge tone={lifecycle.tone}>{lifecycle.label}</Badge>
    </span>
  );
}

/**
 * The real match state for one leg — status, live minute and score.
 *
 * SEPARATE FROM THE SETTLEMENT CELL BELOW, and that separation is the whole
 * point of this column. `FT 2 – 1` describes the pitch; `CÂȘTIGAT` describes the
 * bet. Two legs can share a status and a score shape and settle opposite ways:
 *
 *   FT  Liverpool 2 – 1 Fulham   pick Home  → CÂȘTIGAT
 *   FT  Liverpool 1 – 1 Fulham   pick Home  → PIERDUT
 *
 * So nothing here reads `selection.status`, and the settlement cell never reads
 * this. When the fixture is unknown the cell says so rather than defaulting to
 * a status or a 0 – 0.
 */
function FixtureStateCell({ state, loading }: { state: FixtureState | undefined; loading: boolean }) {
  const display = describeFixture(state);
  if (!display) {
    return (
      <span className="text-[var(--fp-text-muted)]" data-testid="fixture-state-unknown">
        {loading ? "Se încarcă…" : "—"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2" data-testid="fixture-state">
      <Badge tone={display.tone}>{display.statusLabel}</Badge>
      {display.scoreLabel && (
        <span className="font-mono font-semibold text-[var(--fp-text)]" data-testid="fixture-score">
          {display.scoreLabel}
        </span>
      )}
    </span>
  );
}

/** One leg's settlement, or an explicit "unknown" — never a fabricated result. */
function SelectionSettlementCell({ status }: { status: string | null }) {
  const settlement = describeSettlement(status);
  if (!settlement) {
    return (
      <span className="text-[var(--fp-text-muted)]" data-testid="selection-settlement-unknown">
        —
      </span>
    );
  }
  return <Badge tone={settlement.tone}>{settlement.label}</Badge>;
}

/**
 * Won tickets this week and this month, plus the cumulative price breakdown.
 *
 * READS THE LIST ALREADY ON SCREEN. No second endpoint, no per-card request and
 * no history download: the cards below need these rows anyway, so the counters
 * are a fold over them rather than new traffic.
 *
 * The honesty rule is `complete`. The list is a bounded page, so a window can
 * extend past its oldest row; when that happens the number is a floor and the
 * card says "cel puțin" instead of printing a quietly undercounted total as if
 * it were the truth.
 */
function WonTicketsKpi({ kpi }: { kpi: GlobalBetsKpi }) {
  const windows: { key: string; label: string; window: GlobalBetsKpi["week"] }[] = [
    { key: "week", label: "Săptămâna aceasta", window: kpi.week },
    { key: "month", label: "Luna aceasta", window: kpi.month }
  ];

  return (
    <Card className="p-4" data-testid="global-bets-kpi">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-[var(--fp-text-muted)]">
        Bilete câștigate
      </h3>
      {/* A definition list, matching the threshold breakdown below: these are the
          same kind of label/number pair, and pairing them only in one of the two
          places leaves the more prominent stat the less navigable one. */}
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {windows.map(({ key, label, window }) => (
          <div key={key} data-testid={`kpi-${key}`}>
            <dd className="font-display text-2xl font-semibold text-[var(--fp-text)]">
              {window.complete ? window.count : `≥ ${window.count}`}
            </dd>
            <dt className="text-xs text-[var(--fp-text-muted)]">{label}</dt>
            {!window.complete && (
              <dd className="mt-1 text-[11px] text-[var(--fp-text-muted)]">
                Lista afișată nu acoperă intervalul complet (din {window.since}).
              </dd>
            )}
          </div>
        ))}
      </dl>

      <div className="mt-4 border-t border-[var(--fp-border)] pt-3">
        <div className="text-[11px] text-[var(--fp-text-muted)]">
          {/* Stated, not implied: these thresholds nest, so a Cota 8+ winner is
              counted in all three rows. Without this line the three numbers look
              like a partition and an operator would add them up. */}
          Praguri cumulative — un bilet Cota 8+ este numărat și la 4+ și la 2+. Luna aceasta.
        </div>
        {/* Bounded width: at 1440 an unconstrained justify-between row throws the
            label and its number to opposite edges of the card, and the pair stops
            reading as one fact. */}
        <dl className="mt-2 max-w-sm space-y-1">
          {kpi.monthByOddsThreshold.map((bucket) => (
            <div key={bucket.id} className="flex items-center justify-between text-xs" data-testid={`kpi-${bucket.id}`}>
              <dt className="text-[var(--fp-text-muted)]">{bucket.label}</dt>
              <dd className="font-mono font-semibold text-[var(--fp-text)]">{bucket.count} câștigate</dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

function TicketCard({
  ticket,
  expanded,
  onToggle,
  onPublish,
  publishing,
  fixtureStates,
  fixturesLoading,
  fixturesUnavailable
}: {
  ticket: GlobalTicket;
  expanded: boolean;
  onToggle: () => void;
  onPublish: () => void;
  publishing: boolean;
  fixtureStates: Map<number, FixtureState>;
  fixturesLoading: boolean;
  fixturesUnavailable: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* The category headline is the PRICE band — one label only, the
                highest threshold this ticket clears, so a 16.08 ticket reads
                "Cota 8+" rather than carrying three overlapping badges. A ticket
                priced under 2.00 gets no bucket and falls back to its size. */}
            <span className="font-display text-sm font-semibold text-[var(--fp-text)]" data-testid="ticket-category">
              {oddsBucketLabel(ticket.totalOdds) || VARIANT_LABEL[ticket.variant] || `Combo ${ticket.variant}`}
            </span>
            <TicketSettlementBadge status={ticket.status} />
            <TicketStateBadge ticket={ticket} />
            <Badge tone="neutral">{ticket.betDate}</Badge>
          </div>
          <div className="mt-1 text-xs text-[var(--fp-text-muted)]">
            {/* Size stays stated, and stays separate from the price above:
                `selections.length` is what the ticket holds, `variant` is what
                the database promised it would hold, and the schema makes them
                equal. Naming both is how the card keeps "how many legs" and
                "what it pays" from collapsing into one word again. */}
            Cotă totală {formatOdds(ticket.totalOdds)} · {ticket.selections.length}{" "}
            {ticket.selections.length === 1 ? "selecție" : "selecții"} (
            {VARIANT_LABEL[ticket.variant] || `Combo ${ticket.variant}`}) · creat {formatDate(ticket.createdAt)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? "Ascunde" : "Detalii"}
          </Button>
          {/* Publishing is the only state change this panel can make, and only
              from draft. A published ticket offers no control at all rather than
              a disabled one that invites a second click. */}
          {!ticket.publishedAt && (
            <Button size="sm" onClick={onPublish} disabled={publishing}>
              {publishing ? "Se publică…" : "Publică"}
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 overflow-x-auto border-t border-[var(--fp-border)] pt-3">
          {ticket.selections.length === 0 ? (
            <p className="text-xs text-[var(--fp-text-muted)]">Nicio selecție stocată.</p>
          ) : (
            // min-w widened with the new column so the existing overflow-x
            // wrapper scrolls the table instead of squeezing team names.
            <table className="w-full min-w-[660px] text-left text-xs">
              <thead className="text-[var(--fp-text-muted)]">
                <tr>
                  <th className="pb-2 pr-3 font-semibold">Meci</th>
                  {/* The real fixture, kept adjacent to the match and far from
                      "Rezultat": one is the scoreboard, the other is the bet. */}
                  <th className="pb-2 pr-3 font-semibold">Stare meci</th>
                  <th className="pb-2 pr-3 font-semibold">Ligă</th>
                  <th className="pb-2 pr-3 font-semibold">Selecție</th>
                  <th className="pb-2 pr-3 font-semibold">Cotă</th>
                  <th className="pb-2 pr-3 font-semibold">Probabilitate</th>
                  <th className="pb-2 font-semibold">Rezultat</th>
                </tr>
              </thead>
              <tbody className="text-[var(--fp-text)]">
                {ticket.selections.map((s) => (
                  <tr key={`${s.fixtureId}-${s.selection}`} className="border-t border-[var(--fp-border)]">
                    {/* The stored snapshot, never a fresh join: the names a bet
                        was built from are part of what was bet. */}
                    <td className="py-2 pr-3">{s.fixtureLabel || `#${s.fixtureId}`}</td>
                    <td className="py-2 pr-3">
                      <FixtureStateCell state={fixtureStates.get(Number(s.fixtureId))} loading={fixturesLoading} />
                    </td>
                    <td className="py-2 pr-3">{s.leagueName || s.leagueId}</td>
                    <td className="py-2 pr-3">{s.selection}</td>
                    <td className="py-2 pr-3">{formatOdds(s.odds)}</td>
                    <td className="py-2 pr-3">
                      {s.probability == null ? "—" : `${(s.probability * 100).toFixed(1)}%`}
                    </td>
                    {/* The LEG's own settlement, never inferred from the ticket's
                        and never from the fixture having finished. A finished
                        match says nothing about whether this pick came in, and a
                        lost ticket still contains won legs. When the row carries
                        no status we model, it says so instead of guessing. */}
                    <td className="py-2">
                      <SelectionSettlementCell status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Stated once per ticket, not per row: the request was made and came
              back with nothing. Saying so is the honest alternative to leaving
              eight dashes that look like a rendering bug. */}
          {fixturesUnavailable && (
            <p className="mt-2 text-[11px] text-[var(--fp-text-muted)]" data-testid="fixtures-unavailable">
              Starea meciurilor este indisponibilă momentan. Rezultatele selecțiilor rămân cele înregistrate.
            </p>
          )}
          <div className="mt-3 text-[11px] text-[var(--fp-text-muted)]">
            Model {ticket.modelVersion || "—"} · sursă {ticket.betSource}
            {ticket.publishedAt ? ` · publicat ${formatDate(ticket.publishedAt)}` : ""}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function AdminGlobalBetsPanel() {
  const [tickets, setTickets] = useState<GlobalTicket[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "success" | "warning"; text: string } | null>(null);
  const [variant, setVariant] = useState<GlobalVariant>(3);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  /*
    Real fixture state, hydrated on demand.

    Held in a ref ALONGSIDE the state, not derived from it: the toggle handler
    needs to know which ids are already cached at the moment it runs, and reading
    that from `fixtureStates` would close over whichever value existed when the
    callback was created — the classic stale-closure miss that re-fetches ids it
    already holds. The ref is the source of truth for "do I need this?", the
    state exists to trigger the re-render.

    Never persisted: this is a display-time snapshot of somebody else's data.
  */
  const fixtureStatesRef = useRef<Map<number, FixtureState>>(new Map());
  /** Ticket id of the newest hydration request — see onToggleDetails. */
  const fixtureRequestRef = useRef<string | null>(null);
  const [fixtureStates, setFixtureStates] = useState<Map<number, FixtureState>>(new Map());
  const [fixturesLoading, setFixturesLoading] = useState(false);
  const [fixturesUnavailable, setFixturesUnavailable] = useState(false);

  /**
   * Expand or collapse one ticket, hydrating its fixtures exactly once.
   *
   * Collapsing fetches nothing. Expanding asks only for ids not already held, so
   * reopening a ticket — or opening a second ticket that shares a fixture — costs
   * no request at all. Ids are deduplicated before the call, so eight legs on one
   * fixture are one id, and the whole ticket is ONE batched request, never one
   * per selection.
   */
  const onToggleDetails = useCallback(async (ticket: GlobalTicket) => {
    const opening = expandedId !== ticket.id;
    setExpandedId(opening ? ticket.id : null);
    if (!opening) return;

    const missing = normalizeFixtureIds(ticket.selections.map((s) => s.fixtureId)).filter(
      (id) => !fixtureStatesRef.current.has(id)
    );
    if (!missing.length) return;

    // Which request the shared flags belong to. `fixturesLoading` and
    // `fixturesUnavailable` describe the OPEN ticket, but a request outlives the
    // expansion that started it: open A, open B before A answers, and A's late
    // failure would otherwise paint "indisponibil" underneath B. The banner
    // would be reporting a ticket the operator can no longer see.
    fixtureRequestRef.current = ticket.id;
    setFixturesLoading(true);
    setFixturesUnavailable(false);

    const isCurrent = () => fixtureRequestRef.current === ticket.id;
    try {
      const fetched = await fetchFixtureStates(missing);
      // The cache merge is NOT gated: fixture state is additive and keyed by id,
      // so a superseded request's data is still correct and worth keeping — it
      // just must not move the flags.
      if (fetched.size) {
        const merged = new Map(fixtureStatesRef.current);
        fetched.forEach((value, key) => merged.set(key, value));
        fixtureStatesRef.current = merged;
        setFixtureStates(merged);
      }
      // Asked and got nothing back: say so, rather than leaving a row of dashes
      // that reads like a bug. A PARTIAL answer is not flagged — those rows show
      // their own neutral cell.
      if (isCurrent()) setFixturesUnavailable(fetched.size === 0);
    } catch {
      if (isCurrent()) setFixturesUnavailable(true);
    } finally {
      if (isCurrent()) setFixturesLoading(false);
    }
  }, [expandedId]);

  /**
   * Whether a list has ever come back.
   *
   * Separate from `status` because `load()` sets "loading" on EVERY call, and it
   * is re-called after a successful generate and after a publish. Gating the KPI
   * card on `status` alone would unmount and remount it on each of those — the
   * flash the gate exists to prevent, just repeated. Once the card is on screen
   * it stays, and its numbers update in place.
   */
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      setTickets(await fetchGlobalTickets());
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setStatus("idle");
      setHasLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * One sentence an operator can act on.
   *
   * Takes the three values it reads rather than the union member, so the caller
   * does the narrowing at the `if` where it is obvious, and this stays a pure
   * string function with nothing to discriminate.
   */
  const describeUnavailable = (poolState: PoolState, candidatesAvailable: number, required: number) =>
    poolState === "no_populated_predictions"
      ? "Niciun meci viitor nu are încă date de candidați. Backfill-ul istoric nu a fost rulat."
      : `Doar ${candidatesAvailable} selecții îndeplinesc criteriile de siguranță — sunt necesare ${required}.`;

  const onGenerate = async () => {
    setStatus("generating");
    setError(null);
    setNotice(null);
    try {
      const result = await generateGlobalTicket(variant);
      if (isUnavailable(result)) {
        setNotice({
          tone: "warning",
          text: describeUnavailable(result.poolState, result.candidatesAvailable, result.required)
        });
        return;
      }
      setNotice({
        tone: result.duplicate ? "info" : "success",
        text: result.duplicate
          ? "Există deja un bilet Global pentru această zi și variantă. L-am afișat pe cel existent."
          : `Bilet Global creat ca draft din ${result.fixturesConsidered} meciuri și ${result.leaguesConsidered} ligi.`
      });
      setExpandedId(result.ticket.id);
      await load();
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setStatus("idle");
    }
  };

  const onPublish = async (id: string) => {
    setPublishingId(id);
    setStatus("publishing");
    setError(null);
    setNotice(null);
    try {
      await publishGlobalTicket(id);
      setNotice({ tone: "success", text: "Bilet publicat. Este acum vizibil pentru utilizatorii autentificați." });
      await load();
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setPublishingId(null);
      setStatus("idle");
    }
  };

  const busy = status === "generating" || status === "publishing";

  /*
    Recomputed only when the list changes. `Date.now()` is read here rather than
    inside the helper so the pure function stays deterministic under test; the
    week boundary moving while an admin stares at the panel is not worth a timer,
    and the next load picks it up.
  */
  const kpi = useMemo(() => summarizeWonGlobalTickets(tickets, Date.now()), [tickets]);

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Betting"
        title="Global Bets"
        description="Bilete generate de sistem din întregul fond de predicții eligibile — independent de ligile sau filtrele contului tău."
      />

      {/* Hidden until the first list arrives: a KPI that reads 0 and then jumps
          to 12 is worse than one that appears a moment later. Every refresh after
          that updates the numbers in place rather than removing the card. */}
      {hasLoadedOnce && <WonTicketsKpi kpi={kpi} />}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="gb-variant" className="mb-1 block text-xs font-semibold text-[var(--fp-text-muted)]">
              Variantă
            </label>
            {/* Only the variants the backend actually builds. System tickets are
                absent rather than disabled — an option that cannot succeed is
                worse than no option. */}
            <select
              id="gb-variant"
              value={variant}
              onChange={(e) => setVariant(Number(e.target.value) as GlobalVariant)}
              disabled={busy}
              className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-3 py-2 text-sm text-[var(--fp-text)]"
            >
              {GLOBAL_VARIANTS.map((v) => (
                <option key={v} value={v}>
                  {VARIANT_LABEL[v]}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={onGenerate} disabled={busy}>
            {status === "generating" ? "Se generează…" : "Generează bilet Global"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-[var(--fp-text-muted)]">
          Serverul alege selecțiile. Biletul se creează ca <strong>draft</strong> și devine vizibil utilizatorilor
          doar după publicare.
        </p>
      </Card>

      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {error && <ErrorState title="Eroare" message={error} onRetry={() => void load()} retryLabel="Reîncearcă" />}

      {status === "loading" ? (
        <div className="space-y-3" data-testid="global-bets-loading">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : tickets.length === 0 ? (
        <EmptyState
          title="Niciun bilet Global"
          description="Generează primul bilet Global din fondul de predicții eligibile."
        />
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              expanded={expandedId === ticket.id}
              onToggle={() => void onToggleDetails(ticket)}
              onPublish={() => void onPublish(ticket.id)}
              publishing={publishingId === ticket.id}
              fixtureStates={fixtureStates}
              fixturesLoading={fixturesLoading && expandedId === ticket.id}
              fixturesUnavailable={fixturesUnavailable && expandedId === ticket.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
