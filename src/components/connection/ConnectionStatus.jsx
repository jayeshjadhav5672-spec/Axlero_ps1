/**
 * ConnectionStatus — Avantee (React UI / Frontend Engineer)
 *
 * Pure presentational indicator. Accepts Arun's Socket.io state via the
 * `status` prop; contains no networking logic.
 */
const STATUS_META = {
  connected: { label: 'Connected', dot: 'bg-emerald-500' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-400 animate-pulse' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-amber-400 animate-pulse' },
  disconnected: { label: 'Disconnected', dot: 'bg-rose-500' },
  error: { label: 'Connection error', dot: 'bg-rose-500' },
};

export default function ConnectionStatus({ status = 'disconnected', showLabel = true, className = '' }) {
  const meta = STATUS_META[status] ?? STATUS_META.disconnected;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} role="status" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
      {showLabel && (
        <span className="text-sm font-medium text-slate-600">{meta.label}</span>
      )}
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}
