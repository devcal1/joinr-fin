// The record form (stage-5.md §6.4 item 3, D34, D84): a fieldset of the recordable months (ticked
// per `defaultMonths`, or the months "Record them now" chose), the notes the ticked months need,
// a preview of the live figures with the prices' age, an optional note, the new-app-data note
// while nothing was entered in the app, and Record with one pending text. 409s and the import lock
// show as a "Do not" callout.
import type { HistoryPageResponse, IsoMonth, RecordResponse } from '@joinr/schema';
import { Checkbox, KeyValueTable, TextField, formatMoney, type KeyValueItem } from '@joinr/ui';
import { useState, type JSX } from 'react';
import { errorMessage, isApiError } from '../../api/client';
import { useRecordMonths } from '../../api/hooks';
import { formatTimeOrDateTime } from '../../formatting';
import { IMPORT_RUNNING_MESSAGE } from '../investments/apiErrors';
import { InlineForm } from '../cashflow/forms';
import { monthWords } from './display';
import { RECORD_APP_DATA_NOTE, RECORD_FORM_LEAD, RECORD_PENDING, recordNotes } from './historyText';

const NOTE_MAX = 200;

/** "Prices from 14:32 today; they are refreshed before recording, …" (§6.4 item 3). */
function pricesAgeText(pricesAsOf: string | null): string {
  const when = formatTimeOrDateTime(pricesAsOf, new Date());
  const from =
    when === null
      ? 'No prices yet'
      : `Prices from ${when}${/^\d\d:\d\d$/.test(when) ? ' today' : ''}`;
  return `${from}; they are refreshed before recording, so the recorded figures can differ slightly`;
}

function previewItems(page: HistoryPageResponse): KeyValueItem[] {
  const live = page.live;
  if (!live) return [];
  const money = (cents: number | null): string => (cents === null ? '—' : formatMoney(cents));
  return [
    { label: 'Net worth', value: money(live.netWorth.netWorthCents), numeric: true },
    { label: 'Liquid assets', value: money(live.netWorth.liquidCents), numeric: true },
    { label: 'Cash', value: money(live.figures.cashValueCents), numeric: true },
    { label: 'Super', value: money(live.figures.superValueCents), numeric: true },
    { label: 'Property equity', value: money(live.figures.propertyEquityCents), numeric: true },
    { label: 'Prices', value: pricesAgeText(live.pricesAsOf) },
  ];
}

export function RecordForm({
  page,
  preset,
  onDone,
  onCancel,
}: {
  page: HistoryPageResponse;
  /** The months to tick (default: the response's `defaultMonths`). */
  preset: readonly IsoMonth[] | null;
  onDone: (result: RecordResponse) => void;
  onCancel: () => void;
}): JSX.Element {
  const recordable = page.record.recordable;
  const [ticked, setTicked] = useState<ReadonlySet<IsoMonth>>(
    () => new Set((preset ?? page.record.defaultMonths).filter((m) => recordable.includes(m))),
  );
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const record = useRecordMonths();
  const notes = recordNotes(recordable, ticked, page.asOf);

  const toggle = (month: IsoMonth, on: boolean): void => {
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(month);
      else next.delete(month);
      return next;
    });
  };

  const submit = (): boolean => {
    setFormError(null);
    const periodMonths = recordable.filter((m) => ticked.has(m));
    if (periodMonths.length === 0) return false;
    // mutateAsync, not mutate's per-call callbacks: the refetch after a record can empty
    // `recordable` and unmount this form before the callbacks run, and the page must still
    // announce the recorded months (found by the Stage 5 e2e).
    record
      .mutateAsync({ periodMonths, note: note.trim() === '' ? null : note.trim() })
      .then(onDone, (error: unknown) => {
        setFormError(
          isApiError(error) && error.code === 'IMPORT_IN_PROGRESS'
            ? IMPORT_RUNNING_MESSAGE
            : errorMessage(error),
        );
      });
    return true;
  };

  const preview = previewItems(page);
  return (
    <InlineForm
      title="Record month"
      subtitle={RECORD_FORM_LEAD}
      onSubmit={submit}
      onCancel={onCancel}
      pending={record.isPending}
      pristine={ticked.size === 0}
      saveLabel={record.isPending ? RECORD_PENDING : 'Record'}
      formError={formError}
      notes={
        page.hasAppData ? null : (
          <p className="jf-app-meta" data-testid="record-app-data-note">
            {RECORD_APP_DATA_NOTE}
          </p>
        )
      }
    >
      <fieldset className="jf-app-fieldset">
        <legend className="jf-field__label">Months to record</legend>
        <div className="jf-app-month-checks">
          {recordable.map((month) => (
            <Checkbox
              key={month}
              label={monthWords(month)}
              checked={ticked.has(month)}
              disabled={record.isPending}
              onChange={(on) => toggle(month, on)}
            />
          ))}
        </div>
      </fieldset>
      {notes.length > 0 ? (
        <ul className="jf-app-record-notes" aria-label="What recording these months does">
          {notes.map((text) => (
            <li key={text} className="jf-app-meta">
              {text}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.length > 0 ? <KeyValueTable caption="Preview" items={preview} /> : null}
      <TextField
        label="Note"
        value={note}
        onChange={setNote}
        maxLength={NOTE_MAX}
        hint="Optional, up to 200 characters"
        disabled={record.isPending}
      />
    </InlineForm>
  );
}
