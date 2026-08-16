type ApiStatusProps = {
  status: string;
};

export default function ApiStatus({ status }: ApiStatusProps) {
  if (!status) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 rounded-xl border border-fp-success/25 bg-fp-bg-card/50 p-3 font-mono text-xs text-fp-accent/90 shadow-inner backdrop-blur-sm"
    >
      {"> "}
      {status}
    </div>
  );
}
