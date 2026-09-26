// The assets pages' state markers (stage-4.md §6.1 UX-12, §6.8 UX-4): one component for every
// marker defined in display.ts, a group of them, and the first-cell helper that moves a row's
// markers under the name or date on a phone (the desktop cells are unchanged).
import { Pill, StatusBadge } from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import { MARKERS, type MarkerId } from './display';

/** One marker: a status badge (a word and an icon) or a pill. */
export function Marker({ id, label }: { id: MarkerId; label?: string }): JSX.Element {
  const spec = MARKERS[id];
  if (spec.kind === 'pill') {
    return (
      <span className="jf-app-marker" data-marker={id}>
        <Pill tone={spec.tone}>{label ?? spec.label}</Pill>
      </span>
    );
  }
  return (
    <span className="jf-app-marker" data-marker={id}>
      <StatusBadge status={spec.status} label={label ?? spec.label} />
    </span>
  );
}

/** Several markers side by side (wrapping); nothing when there are none. */
export function Markers({ ids }: { ids: readonly MarkerId[] }): JSX.Element | null {
  if (ids.length === 0) return null;
  return (
    <span className="jf-app-markers">
      {ids.map((id) => (
        <Marker key={id} id={id} />
      ))}
    </span>
  );
}

/**
 * A table's first cell: the name or date with, on a phone, the row's markers under it (UX-4).
 * `extra` is anything else that always sits there (a note line, a link).
 */
export function FirstCell({
  children,
  markers,
  phone,
  extra,
}: {
  children: ReactNode;
  markers: readonly MarkerId[];
  phone: boolean;
  extra?: ReactNode;
}): JSX.Element {
  return (
    <span className="jf-app-first-cell">
      <span className="jf-app-first-cell__main">{children}</span>
      {extra}
      {phone ? <Markers ids={markers} /> : null}
    </span>
  );
}
