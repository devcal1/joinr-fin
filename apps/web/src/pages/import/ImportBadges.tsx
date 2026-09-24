// Status badges and pills for import runs and checks (stage-1.md §6.4).
import type { CheckStatus, RunStatus } from '@joinr/schema';
import { Pill, StatusBadge } from '@joinr/ui';
import type { JSX } from 'react';

/** match → go · explained → recorded · suspect → check · unexplained → stop · info → an n/a pill. */
export function CheckStatusBadge({ status }: { status: CheckStatus }): JSX.Element {
  switch (status) {
    case 'match':
      return <StatusBadge status="go" label="Match" />;
    case 'explained':
      return <StatusBadge status="recorded" label="Explained" />;
    case 'suspect':
      return <StatusBadge status="check" label="Suspect" />;
    case 'unexplained':
      return <StatusBadge status="stop" label="Unexplained" />;
    default:
      return <Pill tone="na">Info</Pill>;
  }
}

/** A finished run with unexplained checks (D33): the run badge and the Unexplained tile's hint. */
export const NEEDS_REVIEW_LABEL = 'Needs review';
/** The Unexplained tile's hint when every check matched, is explained or is info. */
export const RECONCILED_HINT = 'Everything reconciles';

/**
 * succeeded → go (or an orange "Needs review" when checks are unexplained, D33) · failed → stop ·
 * running → pending.
 */
export function RunStatusBadge({
  status,
  unexplained = 0,
}: {
  status: RunStatus;
  /** The run's unexplained checks (null or absent: none known). */
  unexplained?: number | null;
}): JSX.Element {
  switch (status) {
    case 'succeeded':
      return (unexplained ?? 0) > 0 ? (
        <StatusBadge status="check" label={NEEDS_REVIEW_LABEL} />
      ) : (
        <StatusBadge status="go" label="Succeeded" />
      );
    case 'failed':
      return <StatusBadge status="stop" label="Failed" />;
    default:
      return <StatusBadge status="pending" label="Running" />;
  }
}

export function RunKindPill({ dryRun }: { dryRun: boolean }): JSX.Element {
  return dryRun ? <Pill tone="violet">Dry run</Pill> : <Pill>Import</Pill>;
}
