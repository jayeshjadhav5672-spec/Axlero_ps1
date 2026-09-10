/**
 * PresenceList — Avantee (React UI / Frontend Engineer)
 *
 * Renders collaborator avatars from an external `users` array.
 * Shape: { id, name, color?, isActive? } — ready for Shree's Yjs
 * awareness data. No hardcoded production users inside this component.
 */
const FALLBACK_COLORS = [
  'bg-teal-600',
  'bg-indigo-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-sky-600',
];

function initialsFor(name) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function colorClassFor(user, index) {
  if (user.colorClass) return user.colorClass;
  if (user.color) return null; // applied via inline style
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export default function PresenceList({ users = [], maxVisible = 4, className = '' }) {
  const visible = users.slice(0, maxVisible);
  const overflow = users.length - visible.length;

  if (users.length === 0) {
    return <span className={`text-sm text-slate-400 ${className}`}>No collaborators</span>;
  }

  return (
    <div
      className={`flex items-center ${className}`}
      role="list"
      aria-label={`${users.length} collaborator${users.length === 1 ? '' : 's'} in room`}
    >
      {visible.map((user, index) => (
        <span
          key={user.id}
          role="listitem"
          title={`${user.name}${user.isActive === false ? ' (away)' : ''}`}
          aria-label={user.name}
          className={`relative -ml-1 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white first:ml-0 ${colorClassFor(user, index) ?? 'bg-slate-500'}`}
          style={user.color && !user.colorClass ? { backgroundColor: user.color } : undefined}
        >
          {initialsFor(user.name)}
          {user.isActive !== false && (
            <span
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
              aria-hidden="true"
            />
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-2 ring-white"
          aria-label={`${overflow} more collaborator${overflow === 1 ? '' : 's'}`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
