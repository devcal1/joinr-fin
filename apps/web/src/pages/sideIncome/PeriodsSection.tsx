// The Side Income page's periods (stage-3.md §6.4 item 6, §5, D57): the stacked chart by stream
// with its table, and the periods table (the provisional badge in the Period cell, the dates, one
// column per stream, the total, the note: editable on recorded periods only). Deposits outside
// every period show as a muted line.
import type {
  SideIncomeChartPointDto,
  SideIncomePageResponse,
  SideIncomePeriodDto,
} from '@joinr/schema';
import {
  BarChart,
  Button,
  ChartCard,
  ColumnTable,
  MEDIA,
  TextField,
  compactMoneyFormatter,
  formatMoney,
  moneyFormatter,
  useMediaQuery,
  type ColumnTableColumn,
  type Series,
} from '@joinr/ui';
import { useMemo, useState, type JSX } from 'react';
import { useSavePeriodNote } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { FlowCell, PeriodCell } from '../cashflow/cells';
import { dateSpan, periodLabel, toDollars } from '../cashflow/display';
import { InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { formErrorsOf, orderColumns, type EditorState } from '../cashflow/formState';
import { chartEmptyMessage } from './periodsText';
import { sideNoteActionKey, type SideIncomeEditor } from './sideIncomeEditor';

export const NO_PERIODS = 'Periods start with the first recorded month.';
export const LIVE_SIDE_NOTE = 'The last point is provisional: it runs to today.';

const dollarFormatter = moneyFormatter();

function category(point: Pick<SideIncomeChartPointDto, 'label' | 'live'>): string {
  return point.live ? `${point.label} (live)` : point.label;
}

function streamAmount(period: SideIncomePeriodDto, streamId: number): number {
  return period.byStream.find((s) => s.streamId === streamId)?.amountCents ?? 0;
}

export interface PeriodsSectionProps {
  page: SideIncomePageResponse;
  editor: EditorState<SideIncomeEditor>;
}

export function PeriodsSection({ page, editor }: PeriodsSectionProps): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const points = page.charts.points;
  const live = points.some((p) => p.live);
  const emptyMessage = chartEmptyMessage(page);
  const open = editor.editor;
  const notePeriod =
    open?.form === 'note'
      ? page.periods.find((p) => p.periodMonth === open.periodMonth)
      : undefined;

  const chart = useMemo(() => {
    const categories = points.map(category);
    const series: Series[] = page.streams.map((stream) => ({
      name: stream.name,
      data: points.map((p) => toDollars(p.byStream[String(stream.id)] ?? null)),
    }));
    return { categories, series };
  }, [points, page.streams]);

  const streamColumns: Record<string, ColumnTableColumn<SideIncomePeriodDto>> = Object.fromEntries(
    page.streams.map((stream) => [
      `stream-${stream.id}`,
      {
        id: `stream-${stream.id}`,
        header: stream.name,
        value: (p: SideIncomePeriodDto) => streamAmount(p, stream.id),
        cell: (p: SideIncomePeriodDto) => <FlowCell cents={streamAmount(p, stream.id)} />,
        numeric: true,
      } satisfies ColumnTableColumn<SideIncomePeriodDto>,
    ]),
  );
  const all: Record<string, ColumnTableColumn<SideIncomePeriodDto>> = {
    period: {
      id: 'period',
      header: 'Period',
      value: (p) => p.periodMonth,
      cell: (p) => <PeriodCell periodMonth={p.periodMonth} status={p.status} />,
      minWidth: phone ? 112 : 124,
    },
    dates: {
      id: 'dates',
      header: 'Dates',
      value: (p) => p.start,
      // Dates are figures: the mono face, right-aligned like every other table date.
      cell: (p) => (
        <span className="jf-app-num jf-app-num--inline jf-app-nowrap">
          {dateSpan(p.start, p.end)}
        </span>
      ),
      numeric: true,
    },
    ...streamColumns,
    total: {
      id: 'total',
      header: 'Total',
      value: (p) => p.totalCents,
      cell: (p) => (
        <span className="jf-app-strong">
          <FlowCell cents={p.totalCents} />
        </span>
      ),
      numeric: true,
    },
    note: {
      id: 'note',
      header: 'Note',
      minWidth: 170,
      value: (p) => p.note?.note ?? null,
      cell: (p) => (
        <span className="jf-app-note-action">
          {p.note ? <span className="jf-app-note-cell">{p.note.note}</span> : <Missing />}
          {p.status === 'closed' ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Note for ${periodLabel(p.periodMonth)}`}
              data-cf-action={sideNoteActionKey(p.periodMonth)}
              onClick={() =>
                editor.open({
                  form: 'note',
                  periodMonth: p.periodMonth,
                  opener: `[data-cf-action="${sideNoteActionKey(p.periodMonth)}"]`,
                })
              }
              disabled={open !== null}
            >
              Note
            </Button>
          ) : null}
        </span>
      ),
    },
  };
  const streamIds = page.streams.map((s) => `stream-${s.id}`);
  const order = phone
    ? ['period', 'total', ...streamIds, 'dates', 'note']
    : ['period', 'dates', ...streamIds, 'total', 'note'];

  const chartTableColumns: ColumnTableColumn<SideIncomeChartPointDto>[] = [
    {
      id: 'period',
      header: 'Period',
      value: (p) => p.period,
      cell: (p) => category(p),
      minWidth: 120,
    },
    ...page.streams.map((stream): ColumnTableColumn<SideIncomeChartPointDto> => ({
      id: `stream-${stream.id}`,
      header: stream.name,
      value: (p) => p.byStream[String(stream.id)] ?? null,
      cell: (p) => <FlowCell cents={p.byStream[String(stream.id)] ?? null} />,
      numeric: true,
    })),
    {
      id: 'total',
      header: 'Total',
      value: (p) => p.totalCents,
      cell: (p) => <FlowCell cents={p.totalCents} />,
      numeric: true,
    },
  ];

  const withLive = (content: JSX.Element): JSX.Element => (
    <div className="jf-app-block">
      {content}
      {live ? <p className="jf-app-meta">{LIVE_SIDE_NOTE}</p> : null}
    </div>
  );

  return (
    <>
      <ChartCard
        title="Side income by period"
        subtitle="Stacked by stream"
        chart={withLive(
          <BarChart
            ariaLabel="Side income per period, stacked by stream"
            categories={chart.categories}
            series={chart.series}
            stacked
            valueFormatter={dollarFormatter}
            axisFormatter={compactMoneyFormatter}
            emptyMessage={emptyMessage}
          />,
        )}
        table={withLive(
          <ColumnTable
            columns={chartTableColumns}
            rows={points}
            getRowId={(p) => p.period}
            caption="Side income by period"
            emptyMessage={emptyMessage}
          />,
        )}
      />
      {notePeriod ? (
        <SideNoteForm
          key={notePeriod.periodMonth}
          period={notePeriod}
          onDone={editor.done}
          onCancel={editor.close}
        />
      ) : null}
      <div className="jf-app-compact-table">
        <ColumnTable
          columns={orderColumns(all, order)}
          rows={page.periods}
          getRowId={(p) => p.periodMonth}
          caption="Side income periods"
          showCaption
          emptyMessage={NO_PERIODS}
        />
      </div>
      {page.outside.beforeFirstCents !== 0 ? (
        <p className="jf-app-meta" data-testid="side-before-first">
          Before the first recorded month: {formatMoney(page.outside.beforeFirstCents)}
        </p>
      ) : null}
      {page.outside.afterAsOfCents !== 0 ? (
        <p className="jf-app-meta">After today: {formatMoney(page.outside.afterAsOfCents)}</p>
      ) : null}
    </>
  );
}

function SideNoteForm({
  period,
  onDone,
  onCancel,
}: {
  period: SideIncomePeriodDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const existing = period.note;
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSavePeriodNote();
  const pristine = note.trim() === (existing?.note ?? '');
  const month = periodLabel(period.periodMonth);

  const submit = (): boolean => {
    if (note.trim().length > 500) {
      setError('Use at most 500 characters.');
      return false;
    }
    setError(undefined);
    setFormError(null);
    save.mutate(
      { kind: 'side_income', periodMonth: period.periodMonth, note: note.trim() },
      {
        onSuccess: () => onDone(note.trim() ? 'Note saved' : 'Note removed'),
        onError: (e) => {
          const split = formErrorsOf<'note'>(e, ['note']);
          setError(split.fields.note);
          setFormError(split.form);
        },
      },
    );
    return true;
  };

  return (
    <InlineForm
      title={`Note for ${month}`}
      subtitle="Side income"
      onSubmit={submit}
      onCancel={onCancel}
      pending={save.isPending}
      pristine={pristine}
      formError={formError}
      notes={
        existing?.origin === 'import' ? <WorkbookCallout /> : existing ? null : <NewAppDataNote />
      }
    >
      <TextField
        label="Note"
        value={note}
        onChange={setNote}
        maxLength={500}
        hint="Saving an empty note removes it."
        error={error}
        disabled={save.isPending}
      />
    </InlineForm>
  );
}
