import { useCallback, useEffect, useState } from "react";
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

/** Draft / published / settled — the three states the schema can actually attest. */
function TicketStateBadge({ ticket }: { ticket: GlobalTicket }) {
  if (ticket.settledAt) return <Badge tone="neutral">Închis</Badge>;
  if (ticket.publishedAt) return <Badge tone="success">Publicat</Badge>;
  return <Badge tone="warning">Draft</Badge>;
}

function TicketCard({
  ticket,
  expanded,
  onToggle,
  onPublish,
  publishing
}: {
  ticket: GlobalTicket;
  expanded: boolean;
  onToggle: () => void;
  onPublish: () => void;
  publishing: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-semibold text-[var(--fp-text)]">
              {VARIANT_LABEL[ticket.variant] || `Combo ${ticket.variant}`}
            </span>
            <TicketStateBadge ticket={ticket} />
            <Badge tone="neutral">{ticket.betDate}</Badge>
          </div>
          <div className="mt-1 text-xs text-[var(--fp-text-muted)]">
            Cotă totală {formatOdds(ticket.totalOdds)} · {ticket.selections.length} selecții · creat{" "}
            {formatDate(ticket.createdAt)}
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
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[var(--fp-text-muted)]">
                <tr>
                  <th className="pb-2 pr-3 font-semibold">Meci</th>
                  <th className="pb-2 pr-3 font-semibold">Ligă</th>
                  <th className="pb-2 pr-3 font-semibold">Selecție</th>
                  <th className="pb-2 pr-3 font-semibold">Cotă</th>
                  <th className="pb-2 font-semibold">Probabilitate</th>
                </tr>
              </thead>
              <tbody className="text-[var(--fp-text)]">
                {ticket.selections.map((s) => (
                  <tr key={`${s.fixtureId}-${s.selection}`} className="border-t border-[var(--fp-border)]">
                    {/* The stored snapshot, never a fresh join: the names a bet
                        was built from are part of what was bet. */}
                    <td className="py-2 pr-3">{s.fixtureLabel || `#${s.fixtureId}`}</td>
                    <td className="py-2 pr-3">{s.leagueName || s.leagueId}</td>
                    <td className="py-2 pr-3">{s.selection}</td>
                    <td className="py-2 pr-3">{formatOdds(s.odds)}</td>
                    <td className="py-2">{s.probability == null ? "—" : `${(s.probability * 100).toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      setTickets(await fetchGlobalTickets());
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setStatus("idle");
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

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Betting"
        title="Global Bets"
        description="Bilete generate de sistem din întregul fond de predicții eligibile — independent de ligile sau filtrele contului tău."
      />

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
              onToggle={() => setExpandedId(expandedId === ticket.id ? null : ticket.id)}
              onPublish={() => void onPublish(ticket.id)}
              publishing={publishingId === ticket.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
