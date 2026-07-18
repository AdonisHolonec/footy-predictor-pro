export default function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--fp-radius-sm)] bg-[var(--fp-bg-muted)] motion-reduce:animate-none ${className}`}
      aria-hidden
    />
  );
}
