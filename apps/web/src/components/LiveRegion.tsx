// A persistent live region for the outcome of an async action (a refresh, a save, an import).
// It stays mounted and only its content changes, so screen readers announce the new content;
// `status` is polite (results), `alert` is assertive (failures).
import type { JSX, ReactNode } from 'react';

export interface LiveRegionProps {
  kind: 'status' | 'alert';
  /** Names the region, e.g. "Refresh result" (there can be several on a page). */
  label: string;
  className?: string;
  children?: ReactNode;
}

export function LiveRegion({ kind, label, className, children }: LiveRegionProps): JSX.Element {
  return (
    <div
      role={kind}
      aria-live={kind === 'alert' ? 'assertive' : 'polite'}
      aria-label={label}
      className={['jf-app-live', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
