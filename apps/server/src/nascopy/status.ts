// The NAS copy's configuration state and its status block (stage-8.md §4.3, §5.2, §5.9). This is
// the ONLY place the configuration state is decided and the ONLY builder of `NasCopyStatusDto`.
// It sees the password file as `usable` or `unusable`, never its value; nothing it returns can
// carry an address, an account, a module, a subfolder or a password (the DTO has no field for one).
import {
  checkNasUrl,
  NAS_COPY_FAILURE_REASONS,
  NAS_COPY_HOUR,
  NAS_COPY_MINUTE,
  NAS_COPY_WEEKDAY,
  NAS_SECRET_FILES,
  nasCopyFailureMessage,
  type AppStatus,
  type JobRunSummary,
  type NasCopyConfigReason,
  type NasCopyConfigState,
  type NasCopyStatusDto,
} from '@joinr/schema';
import { localIsoWithOffset } from '../backups/names';
import { readDetail } from './schedule';
import type { NasFiles } from './secrets';
import { sentenceFor } from './sentences';

export interface NasConfiguration {
  configured: NasCopyConfigState;
  configReason: NasCopyConfigReason | null;
  missing: Array<'nas-url' | 'nas-password'>;
}

/** §5.2: off / partial / invalid / ready, with the reason (the URL checked first) and `missing`. */
export function decideConfiguration(files: NasFiles): NasConfiguration {
  const urlAbsent = files.url.state === 'absent';
  const passwordAbsent = files.password.state === 'absent';
  if (urlAbsent && passwordAbsent) return { configured: 'off', configReason: null, missing: [] };
  if (urlAbsent) {
    return { configured: 'partial', configReason: 'url_missing', missing: [NAS_SECRET_FILES.url] };
  }
  if (passwordAbsent) {
    return {
      configured: 'partial',
      configReason: 'password_missing',
      missing: [NAS_SECRET_FILES.password],
    };
  }
  const urlOk = files.url.state === 'present' && checkNasUrl(files.url.line).ok;
  if (!urlOk) return { configured: 'invalid', configReason: 'url_invalid', missing: [] };
  if (files.password.state !== 'usable') {
    return { configured: 'invalid', configReason: 'password_invalid', missing: [] };
  }
  return { configured: 'ready', configReason: null, missing: [] };
}

const REASONS = new Set<string>(NAS_COPY_FAILURE_REASONS);
const STOPPED_SENTENCE = nasCopyFailureMessage('stopped');

/**
 * `lastRun.error` is always a §4.4 sentence (§4.4): a failed run with a reason gets its sentence
 * rebuilt from its numbers; any other error text (`interrupted`, left by a crash) reads as the
 * `stopped` sentence.
 */
export function withNasSentence(run: JobRunSummary | null): JobRunSummary | null {
  if (run === null || run.error === null) return run;
  const reason = run.detail?.['reason'];
  if (run.status === 'failed' && typeof reason === 'string' && REASONS.has(reason)) {
    const detail = readDetail(run.detail);
    if (detail !== null) return { ...run, error: sentenceFor(detail) };
  }
  return { ...run, error: STOPPED_SENTENCE };
}

export interface NasStatusInput {
  config: NasConfiguration;
  enabled: boolean;
  timeZone: string;
  blocked: boolean;
  running: boolean;
  nextRunAt: Date | null;
  lastRun: JobRunSummary | null;
  /** finishedAt (UTC) of the newest succeeded run. */
  lastSuccessAt: string | null;
  stale: boolean;
}

/** The `nasCopy` block of `GET /api/backups`. */
export function buildNasCopyStatus(i: NasStatusInput): NasCopyStatusDto {
  const ready = i.config.configured === 'ready';
  return {
    configured: i.config.configured,
    configReason: i.config.configReason,
    missing: i.config.configured === 'partial' ? [...i.config.missing] : [],
    blockedUntilFilesChange: ready && i.blocked,
    schedule: {
      enabled: i.enabled,
      weekday: NAS_COPY_WEEKDAY,
      hour: NAS_COPY_HOUR,
      minute: NAS_COPY_MINUTE,
      timeZone: i.timeZone,
      nextRunAt:
        i.enabled && ready && !i.blocked && i.nextRunAt !== null
          ? localIsoWithOffset(i.nextRunAt)
          : null,
    },
    running: i.running,
    lastRun: withNasSentence(i.lastRun),
    lastSuccessAt: i.lastSuccessAt,
    stale: i.stale,
  };
}

/** The `/api/status` block (§3.4): `lastSuccessAt` local ISO with the server's offset. */
export function buildNasCopyProblem(i: {
  config: NasConfiguration;
  blocked: boolean;
  stale: boolean;
  lastSuccessAt: string | null;
}): NonNullable<AppStatus['nasCopy']> {
  const t = i.lastSuccessAt === null ? NaN : Date.parse(i.lastSuccessAt);
  return {
    configured: i.config.configured,
    configReason: i.config.configReason,
    blocked: i.config.configured === 'ready' && i.blocked,
    stale: i.stale,
    lastSuccessAt: Number.isNaN(t) ? null : localIsoWithOffset(new Date(t)),
  };
}
