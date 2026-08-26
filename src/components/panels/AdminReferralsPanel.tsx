import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import Dialog from "../../design-system/Dialog";
import EmptyState from "../../design-system/EmptyState";
import FilterChip from "../../design-system/FilterChip";
import SectionHeader from "../../design-system/SectionHeader";
import Skeleton from "../../design-system/Skeleton";
import Textarea from "../../design-system/Textarea";
import {
  ReferralAdminError,
  fetchReferralPage,
  retryReferralReward,
  reverseReferral,
  type ReferralAdminRow,
  type ReferralFilter
} from "../../services/referralAdminService";
import AdminReferralsTable from "./AdminReferralsTable";

/**
 * Admin referral review. Self-contained, like AdminInboxPanel — it fetches its own
 * data rather than being fed through the admin shell's prop chain.
 *
 * NOTHING IS COMPUTED HERE. The cap, the IP verdict, eligibility and every state
 * transition arrive already decided from the server. This renders them and offers
 * two actions, both of which resolve everything server-side from an attribution id.
 *
 * REVERSAL IS DELIBERATELY AWKWARD. It takes a reward away from two people and
 * cannot be undone from this screen, so it requires an explicit typed reason and a
 * confirmation that spells out all three consequences. A one-click reverse would be
 * a one-click mistake.
 *
 * Strings are English literals, matching every other admin surface (AdminShell's
 * sections, AdminInboxPanel). The admin console is internal and has never been
 * localised; the user-facing referral strings belong to PR3d2.
 */

/** The 500-character ceiling migration 064 enforces. Mirrored so the UI can count. */
const REASON_MAX = 500;

const FILTERS: { id: ReferralFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attributed", label: "Attributed" },
  { id: "qualified", label: "Qualified" },
  { id: "unrewarded", label: "Earned, not delivered" },
  { id: "rewarded", label: "Rewarded" },
  { id: "expired", label: "Expired" },
  { id: "rejected", label: "Rejected" },
  { id: "reversed", label: "Reversed" }
];

/**
 * Stable reason codes to sentences. A server message is never rendered directly:
 * it can carry a Postgres detail, and a reviewer cannot act on one anyway.
 */
function describeError(err: unknown): string {
  if (err instanceof ReferralAdminError) {
    if (err.status === 403) return "You do not have admin access.";
    if (err.status === 401) return "Your session expired. Sign in again.";
    switch (err.reason) {
      case "not_found":
        return "That referral no longer exists.";
      case "not_rewarded":
        return "Only a rewarded referral can be reversed.";
      case "not_qualified":
        return "That referral is not qualified yet, so there is nothing to deliver.";
      case "reason_required":
        return "A reason is required.";
      case "reason_too_long":
        return `A reason must be ${REASON_MAX} characters or fewer.`;
      default:
        return "The action could not be completed. Try again.";
    }
  }
  return "The action could not be completed. Try again.";
}

export default function AdminReferralsPanel() {
  const [filter, setFilter] = useState<ReferralFilter>("all");
  const [rows, setRows] = useState<ReferralAdminRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const [detailRow, setDetailRow] = useState<ReferralAdminRow | null>(null);
  const [reverseRow, setReverseRow] = useState<ReferralAdminRow | null>(null);
  const [reason, setReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const load = useCallback(async (next: ReferralFilter) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchReferralPage({ filter: next });
      setRows(page.referrals);
      setTotal(page.total);
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Loads on mount and on filter change only. No polling: a review screen that
  // re-fetches on a timer fights the reviewer's scroll position for no benefit.
  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleRetry = useCallback(
    async (row: ReferralAdminRow) => {
      markBusy(row.id, true);
      setNotice(null);
      setError(null);
      try {
        const result = await retryReferralReward(row.id);
        setNotice(
          result.reason === "already_rewarded"
            ? "That referral was already delivered — nothing changed."
            : "Reward delivered."
        );
        await load(filter);
      } catch (err) {
        setError(describeError(err));
      } finally {
        markBusy(row.id, false);
      }
    },
    [filter, load, markBusy]
  );

  const handleReverse = useCallback(async () => {
    if (!reverseRow) return;
    const trimmed = reason.trim();
    if (!trimmed) return;
    setReversing(true);
    setNotice(null);
    setError(null);
    try {
      await reverseReferral(reverseRow.id, trimmed);
      setNotice("Referral reversed. Both grants were revoked and the cap slot is free again.");
      setReverseRow(null);
      setReason("");
      await load(filter);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setReversing(false);
    }
  }, [filter, load, reason, reverseRow]);

  const unrewardedCount = useMemo(() => rows.filter((r) => r.unrewarded).length, [rows]);

  return (
    <Card className="space-y-4">
      <SectionHeader
        as="h2"
        size="section"
        title="Referrals"
        description="Attribution, qualification and reward review. The IP column is a soft signal, never a verdict."
        meta={`${total} record${total === 1 ? "" : "s"}`}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter referrals by state">
        {FILTERS.map((f) => (
          <FilterChip
            key={f.id}
            selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
          >
            {f.label}
          </FilterChip>
        ))}
      </div>

      {/* Both messages are announced: a reviewer who just revoked someone's bonus
          must not have to guess whether it worked. */}
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm opacity-80">
          {notice}
        </p>
      ) : null}

      {unrewardedCount > 0 && filter !== "unrewarded" ? (
        <p role="status" className="text-sm opacity-80">
          {unrewardedCount} referral{unrewardedCount === 1 ? " is" : "s are"} earned but not delivered on this page.
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading referrals">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No referrals"
          description={
            filter === "all"
              ? "No referral has been claimed yet. This list fills once the first invite is accepted."
              : "No referral matches this filter."
          }
          actionLabel={filter === "all" ? undefined : "Show all"}
          onAction={filter === "all" ? undefined : () => setFilter("all")}
        />
      ) : (
        <AdminReferralsTable
          rows={rows}
          busyIds={busyIds}
          onOpenDetail={setDetailRow}
          onRetry={handleRetry}
          onReverse={(row) => {
            setReason("");
            setReverseRow(row);
          }}
        />
      )}

      {/* ------------------------------------------------------------ detail */}
      <Dialog
        open={Boolean(detailRow)}
        onClose={() => setDetailRow(null)}
        title="Referral detail"
        description={detailRow ? `Attribution ${detailRow.id}` : ""}
      >
        {detailRow ? (
          <dl className="space-y-2 text-sm">
            {/* Full addresses live here and only here — see the table's header. */}
            <div>
              <dt className="opacity-70">Inviter</dt>
              <dd className="font-mono text-xs">{detailRow.inviterId}</dd>
              <dd>{detailRow.inviterEmail ?? "—"}</dd>
            </div>
            <div>
              <dt className="opacity-70">Invitee</dt>
              <dd className="font-mono text-xs">{detailRow.inviteeId}</dd>
              <dd>{detailRow.inviteeEmail ?? "—"}</dd>
            </div>
            <div>
              <dt className="opacity-70">Timeline</dt>
              <dd>
                attributed {detailRow.attributedAt ?? "—"} · expires {detailRow.expiresAt ?? "—"} · qualified{" "}
                {detailRow.qualifiedAt ?? "—"} · rewarded {detailRow.rewardedAt ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="opacity-70">Inviter grant</dt>
              <dd>
                {detailRow.inviterGrant
                  ? `${detailRow.inviterGrant.grantId} · ${detailRow.inviterGrant.days}d · until ${
                      detailRow.inviterGrant.effectiveUntil ?? "—"
                    }${detailRow.inviterGrant.revoked ? " · REVOKED" : ""}`
                  : detailRow.inviterCapped
                    ? "None — the inviter was at their lifetime cap"
                    : "None"}
              </dd>
            </div>
            <div>
              <dt className="opacity-70">Invitee grant</dt>
              <dd>
                {detailRow.inviteeGrant
                  ? `${detailRow.inviteeGrant.grantId} · ${detailRow.inviteeGrant.days}d · until ${
                      detailRow.inviteeGrant.effectiveUntil ?? "—"
                    }${detailRow.inviteeGrant.revoked ? " · REVOKED" : ""}`
                  : "None"}
              </dd>
            </div>
            <div>
              <dt className="opacity-70">IP signal</dt>
              {/* The hash itself is never sent to this browser. */}
              <dd>
                {detailRow.ipSignal === "match"
                  ? "IP match detected — a shared address is common and is not evidence of fraud."
                  : detailRow.ipSignal === "different"
                    ? "Different IP"
                    : "No IP recorded"}
              </dd>
            </div>
            {detailRow.reason ? (
              <div>
                <dt className="opacity-70">Reason on record</dt>
                <dd>{detailRow.reason}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Dialog>

      {/* ---------------------------------------------------------- reversal */}
      <Dialog
        open={Boolean(reverseRow)}
        onClose={() => {
          if (!reversing) setReverseRow(null);
        }}
        title="Reverse this referral?"
        description={
          reverseRow
            ? `Both bonus grants will be revoked, the referral becomes reversed, and ${
                reverseRow.inviterCapped
                  ? "the inviter earned nothing to revoke"
                  : "the inviter's cap slot becomes available again"
              }.`
            : ""
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={reversing} onClick={() => setReverseRow(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={reversing}
              // Empty reason or in-flight: the database refuses a blank reason
              // anyway, but the button should not invite the round trip.
              disabled={reversing || reason.trim().length === 0}
              onClick={() => void handleReverse()}
            >
              Reverse referral
            </Button>
          </div>
        }
      >
        {/*
          The design-system Textarea owns its own <label> and description wiring, so
          the count goes through `description` rather than a hand-rolled
          aria-describedby — otherwise the field would carry two descriptions and a
          screen reader would read the label twice.
        */}
        <Textarea
          label="Reason"
          description={`Required. Stored on both grants and on the referral. ${reason.trim().length}/${REASON_MAX}`}
          required
          value={reason}
          maxLength={REASON_MAX}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
        />
      </Dialog>
    </Card>
  );
}
