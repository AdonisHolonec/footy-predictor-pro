type ApiStatusProps = {
  status: string;
};

export default function ApiStatus({ status }: ApiStatusProps) {
  if (!status) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 rounded-xl border border-signal-sage/25 bg-signal-panel/50 p-3 font-mono text-xs text-signal-petrol/90 shadow-inner backdrop-blur-sm"
    >
      {"> "}
      {status}
    </div>
  );
}
