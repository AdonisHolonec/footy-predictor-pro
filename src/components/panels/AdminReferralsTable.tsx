import Button from "../../design-system/Button";
import StatusBadge from "../../design-system/StatusBadge";
import type { IpSignal, ReferralAdminRow, ReferralState } from "../../services/referralAdminService";

/**
 * The referral review table. Presentational — every decision arrives from the server.
 *
 * MASKED BY DEFAULT. The list shows a uuid prefix and a masked email; the full
 * address is in the detail drawer, one deliberate click away. A review session is
 * often screen-shared, and a table that renders a hundred addresses at once turns
 * every screenshot into an export.
 *
 * "IP MATCH" IS NOT "FRAUD". The label says what was observed, never what it means:
 * carrier-grade NAT, offices and student halls put unrelated people behind one
 * address, and a reviewer who reads a verdict where there is only a signal will act
 * on it. Nothing here is styled as an alarm.
 */

const STATE_TONE: Record<ReferralState, "neutral" | "accent" | "success" | "danger" | "warning"> = {
  attributed: "neutral",
  qualified: "accent",
  rewarded: "success",
  expired: "neutral",
  rejected: "warning",
  reversed: "danger"
};

const STATE_LABEL: Record<ReferralState, string> = {
  attributed: "Attributed",
  qualified: "Qualified",
  rewarded: "Rewarded",
  expired: "Expired",
  rejected: "Rejected",
  reversed: "Reversed"
};

const IP_LABEL: Record<IpSignal, string> = {
  match: "IP match detected",
  different: "Different IP",
  unavailable: "No IP recorded"
};

const IP_TONE: Record<IpSignal, "neutral" | "warning"> = {
  match: "warning",
  different: "neutral",
  unavailable: "neutral"
};

function shortDate(value: string | null): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * What the inviter actually earned, which is NOT the same as the referral's state.
 *
 * A capped referral is `rewarded` — the invitee was paid — while the inviter earned
 * nothing. Showing "Rewarded" in both columns would quietly misreport the cap.
 */
function inviterRewardLabel(row: ReferralAdminRow): { label: string; tone: "success" | "neutral" | "warning" } {
  if (row.inviterRewardedAt) return { label: `+${row.inviterGrant?.days ?? 5}d`, tone: "success" };
  if (row.inviterCapped) return { label: "Capped (+0)", tone: "warning" };
  return { label: "—", tone: "neutral" };
}

type Props = {
  rows: ReferralAdminRow[];
  busyIds: Set<string>;
  onOpenDetail: (row: ReferralAdminRow) => void;
  onRetry: (row: ReferralAdminRow) => void;
  onReverse: (row: ReferralAdminRow) => void;
};

export default function AdminReferralsTable({ rows, busyIds, onOpenDetail, onRetry, onReverse }: Props) {
  return (
    // The wrapper scrolls, not the page: a wide table must never make the whole
    // admin shell scroll sideways on a narrow screen.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[62rem] text-left text-sm">
        <caption className="sr-only">
          Referral attributions with their qualification, reward and reversal status
        </caption>
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wide opacity-70">
            <th scope="col" className="py-2 pr-3">
              State
            </th>
            <th scope="col" className="py-2 pr-3">
              Inviter
            </th>
            <th scope="col" className="py-2 pr-3">
              Invitee
            </th>
            <th scope="col" className="py-2 pr-3">
              Qualified
            </th>
            <th scope="col" className="py-2 pr-3">
              Reward
            </th>
            <th scope="col" className="py-2 pr-3">
              Inviter earned
            </th>
            <th scope="col" className="py-2 pr-3">
              IP signal
            </th>
            <th scope="col" className="py-2">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const busy = busyIds.has(row.id);
            const earned = inviterRewardLabel(row);
            return (
              <tr key={row.id} className="border-b border-white/5 align-top">
                <td className="py-2 pr-3">
                  <StatusBadge tone={STATE_TONE[row.state]} label={STATE_LABEL[row.state]} />
                  {row.unrewarded ? (
                    <div className="mt-1">
                      {/* The operational queue: earned, not delivered. */}
                      <StatusBadge tone="warning" label="Earned, not delivered" />
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <div className="font-mono text-xs">{row.inviterIdShort}</div>
                  <div className="opacity-70">{row.inviterEmailMasked ?? "—"}</div>
                </td>
                <td className="py-2 pr-3">
                  <div className="font-mono text-xs">{row.inviteeIdShort}</div>
                  <div className="opacity-70">{row.inviteeEmailMasked ?? "—"}</div>
                </td>
                <td className="py-2 pr-3">{shortDate(row.qualifiedAt)}</td>
                <td className="py-2 pr-3">{shortDate(row.rewardedAt)}</td>
                <td className="py-2 pr-3">
                  <StatusBadge tone={earned.tone} label={earned.label} />
                </td>
                <td className="py-2 pr-3">
                  {/* Text as well as tone — the signal must not be conveyed by colour alone. */}
                  <StatusBadge tone={IP_TONE[row.ipSignal]} label={IP_LABEL[row.ipSignal]} />
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onOpenDetail(row)}
                      aria-label={`View referral details for ${row.idShort}`}
                    >
                      Details
                    </Button>
                    {row.unrewarded ? (
                      <Button
                        size="sm"
                        variant="primary"
                        loading={busy}
                        disabled={busy}
                        onClick={() => onRetry(row)}
                        aria-label={`Retry the reward for referral ${row.idShort}`}
                      >
                        Retry reward
                      </Button>
                    ) : null}
                    {row.state === "rewarded" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => onReverse(row)}
                        aria-label={`Reverse the reward for referral ${row.idShort}`}
                      >
                        Reverse
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
