import { Component, type ErrorInfo, type ReactNode } from "react";
import Banner from "../../design-system/Banner";
import Button from "../../design-system/Button";
import { useLocale } from "../../context/LocaleContext";

/**
 * UX-J. The workspace has no error boundary, so a render failure inside the
 * match modal unmounted the entire React root: Results vanished and nothing
 * could bring it back. This boundary wraps the modal ONLY. The list, the nav
 * and every other section keep rendering; the failure becomes a closable
 * notice where the modal would have been. Nothing is swallowed — the error is
 * reported through console.error like every other client-side failure here.
 */

type Props = { onClose: () => void; children: ReactNode };
type State = { failed: boolean };

export default class MatchModalErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[match-modal] render failed", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <MatchDetailUnavailable
          message={null}
          onClose={() => {
            this.setState({ failed: false });
            this.props.onClose();
          }}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * The degraded state for a selection whose detail cannot be shown — a failed
 * `/api/history?fixtureId=` read, or a modal that threw. Small, closable, and
 * rendered NEXT TO the Results list rather than instead of it.
 */
export function MatchDetailUnavailable({ message, onClose }: { message: string | null; onClose: () => void }) {
  const { t } = useLocale();
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label={t("match.detailUnavailableTitle")}
      data-testid="match-detail-unavailable"
      className="fixed inset-x-3 bottom-20 z-40 mx-auto max-w-md sm:inset-x-auto sm:right-6 lg:bottom-6"
    >
      <Banner tone="danger" live="alert" className="!px-4 !py-3">
        <p className="font-display text-sm font-semibold text-[var(--fp-danger)]">{t("match.detailUnavailableTitle")}</p>
        <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{message || t("match.detailUnavailableBody")}</p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={onClose}>
          {t("match.close")}
        </Button>
      </Banner>
    </div>
  );
}
