import { useEffect } from "react";

type Props = {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
};

/** Subtle toast for copy/share feedback. */
export default function Toast({ message, onDismiss, durationMs = 2200 }: Props) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(t);
  }, [message, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 left-1/2 z-[var(--fp-z-toast)] max-w-[min(92vw,24rem)] -translate-x-1/2 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-elevated)] px-4 py-3 text-sm text-[var(--fp-text)] shadow-lg lg:bottom-8"
    >
      {message}
    </div>
  );
}
