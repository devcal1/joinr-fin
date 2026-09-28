// The NAS-copy callout's words (stage-8.md §8.4; D132: no heartbeat): shown above every page while
// `/api/status` says the weekly copy to the NAS is overdue (no success for 8 days while ready),
// half set up, unusable, or locked after the NAS refused the password or module. The text comes
// from the configuration reason and the lock only, never from a run's error. The date is the
// server-local date written in `lastSuccessAt` (`2030-09-15T03:00:05+10:00`), whatever the viewer's
// zone (the Stage 7 `backupStale.ts` pattern).
import type { AppStatus } from '@joinr/schema';
import { formatDate, isIsoDate } from '@joinr/ui';

export const NAS_STALE_TITLE = 'NAS copy overdue';
export const NAS_NOT_WORKING_TITLE = 'NAS copy not working';
export const OPEN_NAS_COPY = 'Open NAS copy';
export const NAS_NEVER_SUCCEEDED = 'The weekly copy to the NAS has not succeeded yet.';

type NasCopyStatus = NonNullable<AppStatus['nasCopy']>;

const NOT_WORKING_TEXT: Record<NonNullable<NasCopyStatus['configReason']>, string> = {
  url_missing: 'The copy to the NAS is half set up, so nothing is being copied.',
  password_missing: 'The copy to the NAS is half set up, so nothing is being copied.',
  url_invalid: 'The NAS address is not usable, so nothing is being copied.',
  password_invalid: 'The NAS password file is not usable, so nothing is being copied.',
};
export const NAS_BLOCKED_TEXT =
  "The NAS refused the last copy's password or module, so nothing is copied until the NAS files are placed again.";

/** "The weekly copy to the NAS has not succeeded since 15/09/2030." (or "… not succeeded yet."). */
export function staleNasCopyText(lastSuccessAt: string | null | undefined): string {
  const day = lastSuccessAt?.slice(0, 10);
  if (!day || !isIsoDate(day)) return NAS_NEVER_SUCCEEDED;
  return `The weekly copy to the NAS has not succeeded since ${formatDate(day)}.`;
}

export interface NasCopyProblem {
  title: string;
  text: string;
}

/**
 * The callout for the header status, or null. A copy that is not working (half set up, unusable
 * or locked) is named first: it says what to fix, and while it holds nothing can succeed anyway.
 */
export function nasCopyProblem(status: AppStatus | undefined): NasCopyProblem | null {
  const nas = status?.nasCopy;
  if (!nas) return null;
  if (nas.configured === 'partial' || nas.configured === 'invalid') {
    const reason =
      nas.configReason ?? (nas.configured === 'partial' ? 'url_missing' : 'url_invalid');
    return { title: NAS_NOT_WORKING_TITLE, text: NOT_WORKING_TEXT[reason] };
  }
  if (nas.blocked) return { title: NAS_NOT_WORKING_TITLE, text: NAS_BLOCKED_TEXT };
  if (nas.stale) return { title: NAS_STALE_TITLE, text: staleNasCopyText(nas.lastSuccessAt) };
  return null;
}
