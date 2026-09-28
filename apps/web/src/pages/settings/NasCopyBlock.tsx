// The Settings "Copy to the NAS" block (stage-8.md §8.2; D126, D128; D132: no heartbeat), inside the
// Backups section after "Back up now": a small subheading (`#nas-copy`), one dense KV table (Copy,
// Next, Last copy, Last success), "Copy to NAS now" with its result, and the adds-only line. The
// button is unavailable unless the NAS files are ready and the refusal lock does not hold: it then
// carries `aria-disabled` (it stays focusable and is described by the Copy row, which says why) and
// a click sends nothing. A started copy is followed by its `job_runs` id (the §8.1 rule).
// Nothing here shows or asks for an address, an account, a module or a password (D126).
import type { NasCopyStatusDto } from '@joinr/schema';
import { Button, Callout, KeyValueTable, StatusBadge, type KeyValueItem } from '@joinr/ui';
import { useQueryClient } from '@tanstack/react-query';
import { HardDriveUpload } from 'lucide-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import { errorMessage } from '../../api/client';
import { queryKeys, useNasCopyNow } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import {
  COPY_BUSY_LABEL,
  COPY_NOW_LABEL,
  NAS_COPY_ADDS_ONLY,
  NAS_COPY_SECTION_ID,
  NAS_COPY_STATE_ID,
  NAS_COPY_TABLE_CAPTION,
  NAS_COPY_TITLE,
  NAS_COPY_WAITING_TEXT,
  NO_COPY_YET,
  copyDoneText,
  copyRowView,
  copyStartedText,
  followedCopyDone,
  lastCopyView,
  lastSuccessText,
  nasCopyAvailable,
  nasNextText,
} from './nasCopyDisplay';

/** `visible`: a shorter text on screen when the live region's `text` would repeat the page. */
type CopyResult = {
  kind: 'started' | 'copied' | 'failed' | 'error';
  text: string;
  visible?: string;
} | null;

function LastCopy({ status }: { status: NasCopyStatusDto }): JSX.Element {
  const view = lastCopyView(status.lastRun, status.schedule.timeZone);
  if (!view) return <span data-testid="nas-copy-last">{NO_COPY_YET}</span>;
  return (
    <span className="jf-app-backups-run" data-testid="nas-copy-last">
      <span>{view.at}</span>
      <StatusBadge status={view.status} label={view.label} />
      {view.text ? <span>{view.text}</span> : null}
      {view.error ? <span className="jf-app-backups-error">{view.error}</span> : null}
    </span>
  );
}

function items(status: NasCopyStatusDto): KeyValueItem[] {
  const copy = copyRowView(status);
  const next = nasNextText(status.schedule);
  const lastSuccess = lastSuccessText(status);
  return [
    {
      label: 'Copy',
      value: (
        <span
          id={NAS_COPY_STATE_ID}
          data-testid="nas-copy-state"
          className={copy.stop ? 'jf-app-backups-error' : undefined}
        >
          {copy.text}
        </span>
      ),
    },
    ...(next === null
      ? []
      : [{ label: 'Next', value: <span data-testid="nas-copy-next">{next}</span> }]),
    { label: 'Last copy', value: <LastCopy status={status} /> },
    ...(lastSuccess === null
      ? []
      : [
          {
            label: 'Last success',
            value: <span data-testid="nas-copy-last-success">{lastSuccess}</span>,
          },
        ]),
  ];
}

function ResultCallout({ result }: { result: CopyResult }): JSX.Element | null {
  if (!result) return null;
  switch (result.kind) {
    case 'started':
      return (
        <Callout kind="note" title="Copying to the NAS">
          <p>{result.text}</p>
        </Callout>
      );
    case 'copied':
      return (
        <Callout kind="note" title="Copied to the NAS">
          <p>{result.text}</p>
        </Callout>
      );
    case 'failed':
    case 'error':
      return (
        <Callout kind="do-not" title="Not copied">
          {result.visible === undefined || result.visible === result.text ? (
            <p>{result.text}</p>
          ) : (
            <p>
              <span aria-hidden="true">{result.visible}</span>
              <span className="jf-visually-hidden">{result.text}</span>
            </p>
          )}
        </Callout>
      );
  }
}

/**
 * The block's subheading alone, while the backups list loads or failed: `#nas-copy` (the index,
 * the every-page callout's link, a direct URL) always has its target, as `#backups` does.
 */
export function NasCopyPlaceholder(): JSX.Element {
  return (
    <div
      className="jf-app-block jf-app-nas-copy"
      role="group"
      aria-labelledby={NAS_COPY_SECTION_ID}
      data-testid="nas-copy-placeholder"
    >
      <h3 id={NAS_COPY_SECTION_ID} className="jf-app-subhead__title">
        {NAS_COPY_TITLE}
      </h3>
      <p className="jf-app-meta">{NAS_COPY_WAITING_TEXT}</p>
    </div>
  );
}

export function NasCopyBlock({ status }: { status: NasCopyStatusDto }): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useNasCopyNow();
  const [result, setResult] = useState<CopyResult>(null);
  /** The `job_runs` id of the copy this page started or joined (§8.1), until it is done. */
  const [followId, setFollowId] = useState<number | null>(null);
  const available = nasCopyAvailable(status);
  const busy = mutation.isPending || status.running || followId !== null;
  const inert = !available || busy;
  const actionsRef = useRef<HTMLDivElement>(null);
  /** The button had the keyboard focus when it was pressed. */
  const refocus = useRef(false);

  /** Counts the followed copies that have ended (each one refetches the two queries once). */
  const [finished, setFinished] = useState(0);

  // The §8.1 follow rule, applied while rendering (state derived from the list, no effect): done
  // when the list shows the followed id finished, or a newer id. On done, the result text.
  if (followId !== null) {
    const done = followedCopyDone(status, followId);
    if (done) {
      setFollowId(null);
      setFinished((count) => count + 1);
      if (done.run) {
        const outcome = copyDoneText(done.run);
        setResult({
          kind: outcome.ok ? 'copied' : 'failed',
          text: outcome.text,
          visible: outcome.visible,
        });
      } else {
        setResult(null);
      }
    }
  }

  // After a followed copy ends, both queries refetch so the every-page callout updates at once.
  useEffect(() => {
    if (finished === 0) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.backups }),
      queryClient.invalidateQueries({ queryKey: queryKeys.status }),
    ]);
  }, [finished, queryClient]);

  // The button is never natively disabled (aria-disabled keeps it focusable), so the focus stays
  // on it; should the browser have moved it to <body>, give it back when the copy ends.
  useEffect(() => {
    if (busy || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      actionsRef.current?.querySelector('button')?.focus();
    }
  }, [busy]);

  const run = (): void => {
    if (inert) return;
    refocus.current = actionsRef.current?.contains(document.activeElement) ?? false;
    setResult(null);
    mutation.mutate(undefined, {
      onSuccess: (response) => {
        setResult({ kind: 'started', text: copyStartedText(response) });
        setFollowId(response.nasCopy.lastRun?.id ?? null);
      },
      onError: (error) => setResult({ kind: 'error', text: errorMessage(error) }),
    });
  };

  return (
    <div
      className="jf-app-block jf-app-nas-copy"
      role="group"
      aria-labelledby={NAS_COPY_SECTION_ID}
      data-testid="nas-copy"
    >
      <h3 id={NAS_COPY_SECTION_ID} className="jf-app-subhead__title">
        {NAS_COPY_TITLE}
      </h3>
      <KeyValueTable caption={NAS_COPY_TABLE_CAPTION} items={items(status)} />
      <div className="jf-app-block jf-app-backups-now">
        <div className="jf-app-backups-actions" ref={actionsRef}>
          <Button
            variant="secondary"
            icon={HardDriveUpload}
            className="jf-app-nas-copy__button"
            aria-disabled={inert ? true : undefined}
            aria-busy={busy}
            aria-describedby={available ? undefined : NAS_COPY_STATE_ID}
            onClick={run}
          >
            {busy ? COPY_BUSY_LABEL : COPY_NOW_LABEL}
          </Button>
        </div>
        <LiveRegion kind="status" label="NAS copy result">
          <ResultCallout result={result} />
        </LiveRegion>
      </div>
      <p className="jf-app-meta jf-app-nas-copy__note" data-testid="nas-copy-note">
        {NAS_COPY_ADDS_ONLY}
      </p>
    </div>
  );
}
