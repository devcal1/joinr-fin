// The History page (stage-5.md §6.4, §6.9, D81–D84, D92, D94): the lead, the status card, the
// record form (opened by Record month, "Record them now" or `/history#record`), the live row, the
// recorded months with Details, Correct and Delete, what you own over time, the consistency check
// and the audit trail. One form is open at a time; each mutation is announced.
import type {
  CorrectionResponse,
  HistoryPageResponse,
  IsoMonth,
  RecordResponse,
  SnapshotDto,
} from '@joinr/schema';
import {
  Button,
  Callout,
  Card,
  KeyValueTable,
  PageHeader,
  SectionBar,
  formatMoney,
} from '@joinr/ui';
import { CalendarPlus } from 'lucide-react';
import { useEffect, useRef, useState, type JSX } from 'react';
import { useHistoryPage } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { LIVE_FIRST_LABEL } from '../assets/display';
import { Marker } from '../assets/markers';
import { actionSelector, useEditor, type EditorBase } from '../cashflow/formState';
import { AuditTrail } from './AuditTrail';
import { ConsistencySection } from './ConsistencySection';
import { CorrectForm } from './CorrectForm';
import { monthWords } from './display';
import { HistoryStatusCard } from './HistoryStatusCard';
import {
  HISTORY_LEAD,
  NO_SNAPSHOTS_TEXT,
  blockedMonths,
  historyBlockedCallout,
  liveNotRecordedText,
  nothingToRecordText,
  recordedAnnouncement,
  rowActionKey,
} from './historyText';
import { RecordForm } from './RecordForm';
import { RecordedMonthsTable } from './RecordedMonths';
import { SnapshotDetails } from './SnapshotDetails';
import { useHashTarget, useLocationHash } from './useHashTarget';
import { WhatYouOwn } from './WhatYouOwn';

const RECORD_ACTION = 'history-record';

type RowEditor = EditorBase & { form: 'details' | 'correct'; snapshot: SnapshotDto };

export function HistoryPage(): JSX.Element {
  const query = useHistoryPage();
  const page = query.data;
  const hash = useLocationHash();
  // The record form: open (with the months to tick, or null for the defaults) or closed.
  const [recordOpen, setRecordOpen] = useState<{ preset: IsoMonth[] | null; key: number } | null>(
    null,
  );
  const opened = useRef(false);
  useEffect(() => {
    if (page && hash === 'record' && !opened.current && page.record.recordable.length > 0) {
      opened.current = true;
      setRecordOpen({ preset: null, key: 0 });
    }
  }, [page, hash]);
  // #record waits for the form it opens, so its heading (not the first month) takes the focus.
  useHashTarget(
    page !== undefined &&
      (hash !== 'record' || recordOpen !== null || page.record.recordable.length === 0),
  );

  const running = page?.recorder.running ?? false;
  const nothing = page !== undefined && page.record.recordable.length === 0;
  const actions = page ? (
    <span className="jf-app-kv-stack jf-app-align-end">
      <Button
        variant="primary"
        icon={CalendarPlus}
        data-cf-action={RECORD_ACTION}
        onClick={() => setRecordOpen({ preset: null, key: Date.now() })}
        disabled={running || nothing || recordOpen !== null}
        aria-describedby={nothing ? 'history-nothing-to-record' : undefined}
      >
        {running ? 'Recording…' : 'Record month'}
      </Button>
      {nothing ? (
        <span id="history-nothing-to-record" className="jf-app-meta">
          {nothingToRecordText(page)}
        </span>
      ) : null}
    </span>
  ) : undefined;

  return (
    <>
      <PageHeader title="History" subtitle="Overview" actions={actions} />
      <QueryStates
        query={query}
        loading="Loading history…"
        layout="dashboard"
        errorTitle="Could not load history"
      />
      {page ? (
        <HistoryContent page={page} recordOpen={recordOpen} onRecordOpen={setRecordOpen} />
      ) : null}
    </>
  );
}

function HistoryContent({
  page,
  recordOpen,
  onRecordOpen,
}: {
  page: HistoryPageResponse;
  recordOpen: { preset: IsoMonth[] | null; key: number } | null;
  onRecordOpen: (next: { preset: IsoMonth[] | null; key: number } | null) => void;
}): JSX.Element {
  const editor = useEditor<RowEditor>();
  const open = editor.editor;
  const [notice, setNotice] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const blocked = historyBlockedCallout(page.recorder.blocked);

  // Details and Correct open after the table: focus moves to the card's heading (§6.4 item 5).
  useEffect(() => {
    if (open?.form !== 'details') return;
    const heading = cardRef.current?.querySelector<HTMLElement>('h3');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }, [open]);

  const closeRecord = (): void => {
    onRecordOpen(null);
    document.querySelector<HTMLElement>(actionSelector(RECORD_ACTION))?.focus();
  };
  const recorded = (result: RecordResponse): void => {
    onRecordOpen(null);
    setNotice(recordedAnnouncement(result.recorded.map((s) => s.periodMonth)));
  };
  // An unsaved audit entry (id 0) means every figure already had its value: nothing changed.
  const corrected = (result: CorrectionResponse): void => {
    const message = result.audit.id === 0 ? 'Nothing changed' : 'Correction saved';
    editor.done(message);
    setNotice(message);
  };
  const openRow = (form: 'details' | 'correct', snapshot: SnapshotDto): void => {
    setNotice(null);
    editor.open({
      form,
      snapshot,
      opener: actionSelector(rowActionKey(form, snapshot.periodMonth)),
    });
    if (form === 'details') setNotice(`Showing ${monthWords(snapshot.periodMonth)} details`);
  };
  // A month that disappeared (deleted, re-imported) closes its card.
  const current = open
    ? (page.snapshots.find((s) => s.periodMonth === open.snapshot.periodMonth) ?? null)
    : null;

  return (
    <>
      <p className="jf-app-lead" data-testid="history-lead">
        {HISTORY_LEAD}
      </p>
      <LiveRegion kind="status" label="History updates">
        {notice ? (
          <Callout kind="note" title="Done">
            <p>{notice}.</p>
          </Callout>
        ) : null}
      </LiveRegion>
      {blocked && page.recorder.blocked ? (
        // D94: auto-record waits for an earlier month; the button opens the form with it ticked
        // (it never records by itself). Fixer round 1, STYLE-7.
        <Callout kind="important" title="Auto-record is waiting">
          <p data-testid="history-blocked-callout">{blocked}</p>
          <Button
            variant="secondary"
            size="sm"
            icon={CalendarPlus}
            data-cf-action="record-blocked"
            onClick={() =>
              onRecordOpen({ preset: blockedMonths(page.recorder.blocked!), key: Date.now() })
            }
          >
            {blockedMonths(page.recorder.blocked).length === 1
              ? 'Record it now'
              : 'Record them now'}
          </Button>
        </Callout>
      ) : null}
      <HistoryStatusCard
        page={page}
        onRecordMissing={(months) => onRecordOpen({ preset: months, key: Date.now() })}
      />
      <div id="record">
        {recordOpen && page.record.recordable.length > 0 ? (
          <RecordForm
            key={recordOpen.key}
            page={page}
            preset={recordOpen.preset}
            onDone={recorded}
            onCancel={closeRecord}
          />
        ) : null}
      </div>
      {page.live ? <LiveRowCard page={page} /> : null}

      <section className="jf-app-block" aria-labelledby="history-months-heading">
        <SectionBar id="history-months-heading" title="Recorded months" role="primary" />
        {page.snapshots.length === 0 ? (
          <Callout kind="note" title="No recorded months">
            <p>{NO_SNAPSHOTS_TEXT}</p>
          </Callout>
        ) : (
          <RecordedMonthsTable
            page={page}
            locked={open?.form === 'correct'}
            onDetails={(s) => openRow('details', s)}
            onCorrect={(s) => openRow('correct', s)}
            onDeleted={(message) => {
              editor.close();
              setNotice(message);
            }}
          />
        )}
        <div ref={cardRef}>
          {open?.form === 'details' && current ? (
            <SnapshotDetails snapshot={current} audit={page.audit} onClose={editor.close} />
          ) : null}
          {open?.form === 'correct' && current ? (
            <CorrectForm
              key={current.periodMonth}
              snapshot={current}
              onDone={corrected}
              onCancel={editor.close}
            />
          ) : null}
        </div>
      </section>

      <WhatYouOwn page={page} />
      <ConsistencySection page={page} />
      <AuditTrail audit={page.audit} />
    </>
  );
}

/** The live row (§6.4 item 4): "Sep 2026 — Live (provisional)" with its figures. */
function LiveRowCard({ page }: { page: HistoryPageResponse }): JSX.Element | null {
  const live = page.live;
  if (!live) return null;
  return (
    <Card as="section" title={`${monthWords(live.periodMonth)}: today's position`}>
      <div className="jf-app-block jf-app-block--tight">
        <span>
          <Marker id="live" label={LIVE_FIRST_LABEL} />
        </span>
        <KeyValueTable
          caption="Live position"
          items={[
            {
              label: 'Net worth',
              value: formatMoney(live.netWorth.netWorthCents),
              numeric: true,
            },
            {
              label: 'Liquid assets',
              value: formatMoney(live.netWorth.liquidCents),
              numeric: true,
            },
          ]}
        />
        <p className="jf-app-meta" data-testid="live-row-note">
          {liveNotRecordedText(page)}
        </p>
      </div>
    </Card>
  );
}
