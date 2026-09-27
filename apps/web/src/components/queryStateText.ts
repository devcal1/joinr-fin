// The words of the shared page states (stage-6.md §6.9 B), kept out of the component module.
import { errorMessage } from '../api/client';
import { formatTimeOrDateTime } from '../formatting';

export const REFRESH_ERROR_TITLE = "Couldn't refresh";

/**
 * The refresh callout's body under its "Couldn't refresh" title: "<message>. Showing the figures
 * from 14:32." (with the date when the figures are from an earlier day).
 */
export function refreshErrorText(error: unknown, updatedAt: number, now: Date): string {
  const message = errorMessage(error).replace(/[.\s]+$/, '');
  const when = updatedAt > 0 ? formatTimeOrDateTime(new Date(updatedAt).toISOString(), now) : null;
  return when
    ? `${message}. Showing the figures from ${when}.`
    : `${message}. Showing the last figures loaded.`;
}
