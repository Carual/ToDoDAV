/** Todoist-style throbber: a red arc turning on a gray ring. The label is for screen readers only. */
export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span className={className ? `spinner ${className}` : 'spinner'} role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="spinner-track" cx="12" cy="12" r="10" />
        <circle className="spinner-arc" cx="12" cy="12" r="10" pathLength={100} strokeDasharray="30 70" />
      </svg>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
