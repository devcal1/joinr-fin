// Super performance (stage-4.md §6.4 item 6, D69, UX-11): the periods table, newest first. Every
// valuation row adds up: Change − Employer SG (to fund) − Your contributions (to fund) − Transfers
// in = Gain; a month whose balance was not updated shows its own window's flows muted with "Merged
// into the next month", and the next valuation row says "since dd/mm/yyyy". The investment-option
// notes are a per-month log (D69) with a note form (any month up to this one; empty removes).
import type { PeriodNoteDto, SuperPageResponse, SuperPeriodDto } from '@joinr/schema';
import {
  Button,
  ColumnTable,
  Select,
  TextField,
  formatDate,
  type ColumnTableColumn,
} from '@joinr/ui';
import { NotebookPen, Pencil, Plus } from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';
import { useSaveSuperOptionNote } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { BalanceCell, FlowCell, MoneyCell, RatioCell } from '../cashflow/cells';
import { InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { formErrorsOf, orderColumns } from '../cashflow/formState';
import { monthLabel } from '../assets/display';
import { FirstCell, Markers } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { MERGED_NOTE, isMerged, noteActionKey, noteMonths, periodMarkers } from './superText';

const DESKTOP_ORDER = [
  'period',
  'value',
  'change',
  'sg',
  'yours',
  'transfers',
  'gain',
  'return',
  'note',
  'actions',
] as const;
const PHONE_ORDER = [
  'period',
  'gain',
  'value',
  'return',
  'change',
  'sg',
  'yours',
  'transfers',
  'note',
  'actions',
] as const;

/** A merged-away row's own flows, muted. */
function Muted({ cents }: { cents: number | null | undefined }): JSX.Element {
  if (cents === null || cents === undefined) return <Missing />;
  return (
    <span className="jf-app-muted">
      <FlowCell cents={cents} />
    </span>
  );
}

function flowCell(p: SuperPeriodDto, pick: (f: NonNullable<SuperPeriodDto['flows']>) => number) {
  if (p.notUpdated) return <Muted cents={p.flows ? pick(p.flows) : null} />;
  if (p.gainFlows === null) return <Missing />;
  return <FlowCell cents={pick(p.gainFlows)} />;
}

export interface PeriodsTableProps {
  page: SuperPageResponse;
  locked: boolean;
  onNote: (period: SuperPeriodDto) => void;
}

export function PeriodsTable({ page, locked, onNote }: PeriodsTableProps): JSX.Element {
  const { phone, firstMin } = useTableLayout();
  const anyTransfers = page.periods.some(
    (p) => (p.gainFlows?.transferInCents ?? 0) !== 0 || (p.flows?.transferInCents ?? 0) !== 0,
  );
  const all: Record<string, ColumnTableColumn<SuperPeriodDto>> = {
    period: {
      id: 'period',
      header: 'Period',
      value: (p) => p.periodMonth,
      cell: (p) => (
        <FirstCell
          phone={phone}
          markers={periodMarkers(p)}
          extra={
            <>
              {isMerged(p) && p.gainFrom ? (
                <span className="jf-app-muted jf-app-small">since {formatDate(p.gainFrom)}</span>
              ) : null}
              {p.notUpdated ? (
                <span className="jf-app-muted jf-app-small">{MERGED_NOTE}</span>
              ) : null}
            </>
          }
        >
          <span className="jf-app-period-cell">
            <span className="jf-app-nowrap">{monthLabel(p.periodMonth)}</span>
            {phone ? null : <Markers ids={periodMarkers(p)} />}
          </span>
        </FirstCell>
      ),
      minWidth: firstMin(150, 124),
    },
    value: {
      id: 'value',
      header: 'Value',
      value: (p) => p.valueCents,
      cell: (p) => <BalanceCell cents={p.valueCents} />,
      numeric: true,
    },
    change: {
      id: 'change',
      header: 'Change',
      value: (p) => p.changeCents,
      cell: (p) => <FlowCell cents={p.changeCents} />,
      numeric: true,
    },
    sg: {
      id: 'sg',
      header: 'Employer SG (to fund)',
      value: (p) =>
        p.notUpdated ? (p.flows?.sgFundCents ?? null) : (p.gainFlows?.sgFundCents ?? null),
      cell: (p) => flowCell(p, (f) => f.sgFundCents),
      numeric: true,
    },
    yours: {
      id: 'yours',
      header: 'Your contributions (to fund)',
      value: (p) =>
        p.notUpdated ? (p.flows?.memberFundCents ?? null) : (p.gainFlows?.memberFundCents ?? null),
      cell: (p) => flowCell(p, (f) => f.memberFundCents),
      numeric: true,
    },
    transfers: {
      id: 'transfers',
      header: 'Transfers in',
      value: (p) =>
        p.notUpdated ? (p.flows?.transferInCents ?? null) : (p.gainFlows?.transferInCents ?? null),
      cell: (p) => flowCell(p, (f) => f.transferInCents),
      numeric: true,
    },
    gain: {
      id: 'gain',
      header: 'Gain',
      value: (p) => p.gainCents,
      cell: (p) => <MoneyCell cents={p.gainCents} loss />,
      numeric: true,
    },
    return: {
      id: 'return',
      header: 'Return',
      value: (p) => (p.returnRatio === null ? null : Number(p.returnRatio)),
      cell: (p) => <RatioCell ratio={p.returnRatio} loss />,
      numeric: true,
    },
    note: {
      id: 'note',
      header: 'Option note',
      value: (p) => p.note?.note ?? null,
      cell: (p) => (p.note ? <span className="jf-app-note-cell">{p.note.note}</span> : <Missing />),
      // Room for a whole 12-letter word at every width, so a note never splits mid-word (STYLE-3).
      minWidth: 120,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (p) => (
        <Button
          variant="ghost"
          size="sm"
          icon={NotebookPen}
          aria-label={`Option note for ${monthLabel(p.periodMonth)}`}
          data-cf-action={noteActionKey(p.periodMonth)}
          onClick={() => onNote(p)}
          disabled={locked}
        >
          Note
        </Button>
      ),
    },
  };
  const order = (phone ? PHONE_ORDER : DESKTOP_ORDER).filter(
    (id) => anyTransfers || id !== 'transfers',
  );
  return (
    <div className="jf-app-compact-table jf-app-super-periods">
      <ColumnTable
        columns={orderColumns(all, order)}
        rows={page.periods}
        getRowId={(p) => p.periodMonth}
        caption={`Super by period: ${plural(page.periods.length, 'row')}`}
        showCaption
      />
    </div>
  );
}

// ─── Investment option notes (D69) ──────────────────────────────────────────────────────────────

export interface OptionNotesProps {
  page: SuperPageResponse;
  locked: boolean;
  onEdit: (note: PeriodNoteDto) => void;
  onAdd: () => void;
}

export function OptionNotes({ page, locked, onEdit, onAdd }: OptionNotesProps): JSX.Element {
  return (
    <section className="jf-app-block" aria-labelledby="super-option-notes-heading">
      <div className="jf-app-subhead">
        <h3 id="super-option-notes-heading" className="jf-app-subhead__title">
          Investment option notes
        </h3>
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          data-cf-action="super-note-add"
          onClick={onAdd}
          disabled={locked}
        >
          Add note
        </Button>
      </div>
      {page.notes.length === 0 ? (
        <p className="jf-app-meta">
          No option notes yet. Note a switch of investment option by month.
        </p>
      ) : (
        <ul className="jf-app-note-list">
          {page.notes.map((note) => (
            <li key={note.periodMonth} className="jf-app-note-list__item">
              <span className="jf-app-note-list__month">{monthLabel(note.periodMonth)}</span>
              <span className="jf-app-note-cell">{note.note}</span>
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                aria-label={`Edit the option note for ${monthLabel(note.periodMonth)}`}
                data-cf-action={noteActionKey(`list-${note.periodMonth}`)}
                onClick={() => onEdit(note)}
                disabled={locked}
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The option-note form: a month (up to this one) and the text (500 chars; empty removes it). */
export function OptionNoteForm({
  page,
  periodMonth,
  onDone,
  onCancel,
}: {
  page: SuperPageResponse;
  periodMonth?: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const months = noteMonths(page);
  const [month, setMonth] = useState(periodMonth ?? months[0] ?? page.asOf.slice(0, 7));
  const existing = page.notes.find((n) => n.periodMonth === month) ?? null;
  const [text, setText] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSaveSuperOptionNote();
  const pristine = text.trim() === (existing?.note ?? '');

  const changeMonth = (next: string): void => {
    setMonth(next);
    setText(page.notes.find((n) => n.periodMonth === next)?.note ?? '');
  };

  const submit = (): boolean => {
    if (text.trim().length > 500) {
      setError('Use at most 500 characters.');
      return false;
    }
    setError(undefined);
    setFormError(null);
    save.mutate(
      { periodMonth: month, note: text.trim() },
      {
        onSuccess: () => onDone(text.trim() ? 'Note saved' : 'Note removed'),
        onError: (e) => {
          const split = formErrorsOf<'note'>(e, ['note']);
          setError(split.fields.note);
          setFormError(split.form);
        },
      },
    );
    return true;
  };

  let notes: ReactNode = null;
  if (existing?.origin === 'import') notes = <WorkbookCallout />;
  else if (!existing) notes = <NewAppDataNote />;

  return (
    <InlineForm
      title="Investment option note"
      subtitle="Super"
      onSubmit={submit}
      onCancel={onCancel}
      pending={save.isPending}
      pristine={pristine}
      formError={formError}
      notes={notes}
    >
      <div className="jf-app-form-row">
        <Select
          label="Month"
          value={month}
          onChange={changeMonth}
          options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
          disabled={save.isPending}
        />
        <TextField
          label="Note"
          value={text}
          onChange={setText}
          maxLength={500}
          hint="Saving an empty note removes it."
          error={error}
          disabled={save.isPending}
        />
      </div>
    </InlineForm>
  );
}
