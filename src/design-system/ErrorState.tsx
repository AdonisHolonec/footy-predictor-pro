import Button from "./Button";

type Props = {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
};

/** Readable error with optional retry — no jargon. */
export default function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Retry"
}: Props) {
  return (
    <div
      role="alert"
      className="rounded-[var(--fp-radius)] border border-fp-danger/35 bg-fp-danger/10 px-4 py-4"
    >
      <p className="font-display text-sm font-semibold text-[var(--fp-danger)]">{title}</p>
      <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{message}</p>
      {onRetry && (
        <Button className="mt-3" variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
