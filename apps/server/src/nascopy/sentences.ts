// Classifying an rsync refusal and choosing the sentence (stage-8.md §4.4, §5.7; pure).
//
// stderr is read ONLY against the fixed patterns below; no part of it is ever returned, stored or
// logged. The sentence of a run is built from its reason and numbers alone.
import {
  nasCopyFailureMessage,
  type NasCopyFailureReason,
  type NasCopyJobDetail,
} from '@joinr/schema';

export type RsyncPhase = 'list' | 'send' | 'relist';

const MAX_CONNECTIONS_RE = /max connections/i;
const READ_OR_WRITE_ONLY_RE = /read only|write only/i;
const AUTH_FAILED_RE = /auth failed/i;
const UNKNOWN_MODULE_RE = /unknown module/i;
const NO_SUCH_FILE_RE = /No such file or directory/;

/**
 * The first listing's one exception (§5.5 step 3): exit 23 with a configured subfolder and
 * "No such file or directory" means the subfolder does not exist yet, i.e. the remote is empty.
 */
export function listingMeansEmpty(code: number, stderr: string, hasSubfolder: boolean): boolean {
  return code === 23 && hasSubfolder && NO_SUCH_FILE_RE.test(stderr);
}

/** A non-zero exit → the reason (§5.7). The send's 23 and 24 go to the proof, never here. */
export function classify(phase: RsyncPhase, code: number, stderr: string): NasCopyFailureReason {
  if (phase === 'relist') return 'readback_failed';
  if (MAX_CONNECTIONS_RE.test(stderr)) return 'other';
  if (READ_OR_WRITE_ONLY_RE.test(stderr)) return 'nas_io';
  switch (code) {
    case 5:
      if (AUTH_FAILED_RE.test(stderr)) return 'auth';
      if (UNKNOWN_MODULE_RE.test(stderr)) return 'unknown_module';
      return 'refused';
    case 35:
      return 'unreachable';
    case 10:
      return phase === 'list' ? 'unreachable' : 'broken';
    case 12:
      return 'broken';
    case 30:
      return 'timeout';
    case 11:
      return phase === 'list' ? 'other' : 'nas_io';
    default:
      return 'other';
  }
}

/** The §4.4 sentence of a failed run's detail (numbers only). */
export function sentenceFor(
  detail: Partial<Pick<NasCopyJobDetail, 'reason' | 'exitCode' | 'sent' | 'missingAfter'>>,
): string {
  const reason = detail.reason ?? 'other';
  const missing = detail.missingAfter ?? undefined;
  return nasCopyFailureMessage(reason, {
    code: detail.exitCode,
    missing,
    total: missing === undefined ? undefined : (detail.sent ?? 0) + missing,
  });
}
