// The Cash page's Savings section (stage-3.md §6.3 item 4, D51, §2.3): the Adjusted | Raw switch,
// the savings table (newest first; the provisional period has Details only, the baseline Note
// only), the Details card, the adjustment and note forms, orphan adjustments, the three charts
// and the foot notes.
import type {
  CashPageResponse,
  IsoMonth,
  SavingsAdjustmentDto,
  SavingsPeriodDto,
} from '@joinr/schema';
import {
  Button,
  Callout,
  Card,
  Cluster,
  ColumnTable,
  Grid,
  GridItem,
  KeyValueTable,
  MEDIA,
  MoneyField,
  TextField,
  formatMoney,
  useMediaQuery,
  type ColumnTableColumn,
  type KeyValueItem,
} from '@joinr/ui';
import { Trash2, X } from 'lucide-react';
import { useId, useState, type JSX } from 'react';
import { useDeleteAdjustment, useSaveAdjustment, useSavePeriodNote } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { Segmented } from '../investments/Segmented';
import { BalanceCell, FlowCell, PeriodCell, SavingsCell, SavingsRateCell } from '../cashflow/cells';
import { RATE_CHECK_NOTE, periodLabel, rateNeedsCheck } from '../cashflow/display';
import {
  FormError,
  InlineForm,
  KeptCallout,
  NewAppDataNote,
  WorkbookCallout,
} from '../cashflow/forms';
import {
  actionErrorText,
  formErrorsOf,
  orderColumns,
  type EditorState,
} from '../cashflow/formState';
import { isFormOpen, type CashEditor, type SavingsView } from './cashEditor';
import { periodActionKey } from './cashText';
import { SavingsCharts } from './SavingsCharts';

export const NO_SNAPSHOTS =
  'Savings start after the first recorded month. Import the workbook for past months; recording arrives in Stage 5.';
export const BASELINE_NOTE = 'The first recorded month is the baseline.';
export const RECORDING_NOTE =
  'Recording a month arrives in Stage 5; until then the current period stays provisional.';
export const ADJUSTMENT_HINT =
  "A one-off inflow that isn't income, such as an asset sale or a loan repaid. It is taken out of savings.";
export const ADJUSTMENT_KEPT = 'Adjustments are kept when you re-import the workbook.';

const VIEW_OPTIONS = [
  { value: 'adjusted', label: 'Adjusted' },
  { value: 'raw', label: 'Raw (as the sheet)' },
] as const;

const DESKTOP_ORDER = [
  'period',
  'cash',
  'cashGain',
  'added',
  'adjustment',
  'savings',
  'income',
  'rate',
  'spend',
  'note',
  'actions',
] as const;

const PHONE_ORDER = [
  'period',
  'rate',
  'savings',
  'cashGain',
  'cash',
  'added',
  'income',
  'spend',
  'adjustment',
  'note',
  'actions',
] as const;

/** The figures a view shows (adjusted: the app's, D51; raw: the sheet's). */
function figuresOf(period: SavingsPeriodDto, view: SavingsView) {
  return view === 'raw' ? period.raw : period.adjusted;
}

export interface SavingsSectionProps {
  page: CashPageResponse;
  editor: EditorState<CashEditor>;
}

export function SavingsSection({ page, editor }: SavingsSectionProps): JSX.Element {
  const [view, setView] = useState<SavingsView>('adjusted');
  const phone = useMediaQuery(MEDIA.phone);
  const checkNoteId = useId();
  const periods = page.periods;
  const open = editor.editor;
  const openPeriod =
    open && (open.form === 'details' || open.form === 'adjust' || open.form === 'note')
      ? periods.find((p) => p.periodMonth === open.periodMonth)
      : undefined;
  // The read-only Details card locks nothing: Adjust, Note or another row's Details replace it.
  const locked = isFormOpen(open);
  const rows = periods;
  const anyCheck = periods.some((p) => rateNeedsCheck(figuresOf(p, view).savingsRatio));

  const openFor = (form: 'details' | 'adjust' | 'note', periodMonth: IsoMonth): void => {
    editor.open({
      form,
      periodMonth,
      opener: `[data-cf-action="${periodActionKey(form, periodMonth)}"]`,
    });
  };

  const all: Record<string, ColumnTableColumn<SavingsPeriodDto>> = {
    period: {
      id: 'period',
      header: 'Period',
      value: (p) => p.periodMonth,
      cell: (p) => <PeriodCell periodMonth={p.periodMonth} status={p.status} />,
      minWidth: phone ? 112 : 124,
    },
    cash: {
      id: 'cash',
      header: 'Cash',
      value: (p) => p.cashCents,
      cell: (p) => <BalanceCell cents={p.cashCents} />,
      numeric: true,
    },
    cashGain: {
      id: 'cashGain',
      header: 'Cash gain',
      value: (p) => p.cashGainCents,
      cell: (p) => <FlowCell cents={p.cashGainCents} />,
      numeric: true,
    },
    added: {
      id: 'added',
      header: 'Added investments',
      value: (p) => p.addedInvestmentsCents,
      cell: (p) => <FlowCell cents={p.addedInvestmentsCents} />,
      numeric: true,
    },
    adjustment: {
      id: 'adjustment',
      header: 'Adjustment',
      value: (p) => p.adjustment?.amountCents ?? null,
      cell: (p) =>
        p.adjustment ? (
          <span className="jf-app-kv-stack jf-app-align-end">
            <FlowCell cents={p.adjustment.amountCents} />
            <span className="jf-app-muted jf-app-small jf-app-text-value">{p.adjustment.note}</span>
          </span>
        ) : (
          <Missing />
        ),
      numeric: true,
    },
    savings: {
      id: 'savings',
      header: 'Savings',
      value: (p) => figuresOf(p, view).savingsCents,
      cell: (p) => <SavingsCell cents={figuresOf(p, view).savingsCents} />,
      numeric: true,
    },
    income: {
      id: 'income',
      header: 'Income',
      value: (p) => figuresOf(p, view).incomeCents,
      cell: (p) => <FlowCell cents={figuresOf(p, view).incomeCents} />,
      numeric: true,
    },
    rate: {
      id: 'rate',
      header: 'Savings rate',
      value: (p) => figuresOf(p, view).savingsRatio,
      cell: (p) => (
        <SavingsRateCell ratio={figuresOf(p, view).savingsRatio} checkNoteId={checkNoteId} />
      ),
      numeric: true,
    },
    spend: {
      id: 'spend',
      header: 'Spend',
      value: (p) => figuresOf(p, view).spendCents,
      cell: (p) => <FlowCell cents={figuresOf(p, view).spendCents} />,
      numeric: true,
    },
    note: {
      id: 'note',
      header: 'Note',
      value: (p) => p.spendNote?.note ?? null,
      cell: (p) =>
        p.spendNote ? <span className="jf-app-note-cell">{p.spendNote.note}</span> : <Missing />,
      minWidth: phone ? 120 : 104,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (p) => {
        const month = periodLabel(p.periodMonth);
        const recorded = p.status !== 'provisional';
        return (
          // Details alone, then the two forms (Adjust · Note): the narrower pairing keeps the
          // savings table inside the 1152 px content area at 1440 px (STYLE-10).
          <span className="jf-app-row-actions jf-app-row-actions--pairs">
            {p.status === 'first' ? null : (
              <span className="jf-app-row-actions__pair">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Details of ${month}`}
                  data-cf-action={periodActionKey('details', p.periodMonth)}
                  onClick={() => openFor('details', p.periodMonth)}
                  disabled={locked}
                >
                  Details
                </Button>
              </span>
            )}
            {recorded ? (
              <span className="jf-app-row-actions__pair">
                {p.status === 'closed' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Adjust ${month}`}
                    data-cf-action={periodActionKey('adjust', p.periodMonth)}
                    onClick={() => openFor('adjust', p.periodMonth)}
                    disabled={locked}
                  >
                    Adjust
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Note for ${month}`}
                  data-cf-action={periodActionKey('note', p.periodMonth)}
                  onClick={() => openFor('note', p.periodMonth)}
                  disabled={locked}
                >
                  Note
                </Button>
              </span>
            ) : null}
          </span>
        );
      },
    },
  };
  const order = (phone ? PHONE_ORDER : DESKTOP_ORDER).filter(
    (id) => view === 'adjusted' || id !== 'adjustment',
  );

  return (
    <>
      <Segmented<SavingsView>
        label="Figures"
        options={VIEW_OPTIONS}
        value={view}
        onChange={setView}
        hint={
          view === 'adjusted'
            ? 'One-off adjustments are taken out of savings; every dividend counts as income.'
            : 'As the workbook computes them: no adjustments; only dividends not reinvested count as income.'
        }
      />
      {page.orphanAdjustments.map((adjustment) => (
        <OrphanAdjustment
          key={adjustment.periodMonth}
          adjustment={adjustment}
          onDone={editor.announce}
        />
      ))}
      {periods.length === 0 ? (
        <Callout kind="note" title="No recorded months">
          <p>{NO_SNAPSHOTS}</p>
        </Callout>
      ) : (
        <>
          <div className="jf-app-compact-table">
            <ColumnTable
              columns={orderColumns(all, order)}
              rows={rows}
              getRowId={(p) => p.periodMonth}
              caption={`Savings by period: ${plural(periods.length, 'row')}${view === 'raw' ? ' (as the sheet)' : ''}`}
              showCaption
            />
          </div>
          {anyCheck ? (
            <p id={checkNoteId} className="jf-app-meta">
              {RATE_CHECK_NOTE}
            </p>
          ) : null}
          {open?.form === 'details' && openPeriod ? (
            <PeriodDetails period={openPeriod} view={view} onClose={editor.close} />
          ) : null}
          {open?.form === 'adjust' && openPeriod ? (
            <AdjustmentForm
              key={openPeriod.periodMonth}
              period={openPeriod}
              onDone={editor.done}
              onCancel={editor.close}
            />
          ) : null}
          {open?.form === 'note' && openPeriod ? (
            <NoteForm
              key={openPeriod.periodMonth}
              period={openPeriod}
              onDone={editor.done}
              onCancel={editor.close}
            />
          ) : null}
          <SavingsCharts points={page.charts.points} view={view} />
        </>
      )}
      <div className="jf-app-footnotes">
        <p className="jf-app-meta">{BASELINE_NOTE}</p>
        <p className="jf-app-meta">{RECORDING_NOTE}</p>
      </div>
    </>
  );
}

// ─── Details (every device; §6.3 item 4) ────────────────────────────────────────────────────────

function money(cents: number | null | undefined): JSX.Element {
  return cents === null || cents === undefined ? <Missing /> : <FlowCell cents={cents} />;
}

function PeriodDetails({
  period,
  view,
  onClose,
}: {
  period: SavingsPeriodDto;
  view: SavingsView;
  onClose: () => void;
}): JSX.Element {
  const month = periodLabel(period.periodMonth);
  const added = period.added;
  const income = period.income;
  const figures = figuresOf(period, view);
  const items: KeyValueItem[] = [
    { label: 'Trades', value: money(added?.tradesCents), numeric: true },
    { label: 'Other assets', value: money(added?.otherAssetsCents), numeric: true },
    { label: 'Super', value: money(added?.superCents), numeric: true },
    { label: 'Mortgage principal', value: money(added?.mortgagePrincipalCents), numeric: true },
    // Stage 4 (§6.6, §11 fix 7, D78): money moved into an offset account counts as saved.
    { label: 'Offsets', value: money(added?.offsetsCents), numeric: true },
    { label: 'Property deposit', value: money(added?.propertyDepositCents), numeric: true },
    { label: '= Added investments', value: money(period.addedInvestmentsCents), numeric: true },
    { label: 'Salary', value: money(income?.salaryCents), numeric: true },
    { label: 'Side income', value: money(income?.sideIncomeCents), numeric: true },
    { label: 'Cash dividends', value: money(income?.cashDividendsCents), numeric: true },
    {
      label: view === 'raw' ? 'Other dividends (not counted as the sheet)' : 'Other dividends',
      value: money(income?.otherDividendsCents),
      numeric: true,
    },
    { label: '= Income', value: money(figures.incomeCents), numeric: true },
  ];
  return (
    <Card
      as="section"
      title={`Details · ${month}`}
      subtitle={period.status === 'provisional' ? 'Provisional: today’s balances' : undefined}
      actions={
        <Button variant="ghost" size="sm" icon={X} onClick={onClose}>
          Close
        </Button>
      }
    >
      <KeyValueTable caption={`Parts of ${month}`} items={items} />
    </Card>
  );
}

// ─── Adjustment (D51; an overlay, kept by a re-import) ──────────────────────────────────────────

type AdjustmentField = 'amountCents' | 'note';

function AdjustmentForm({
  period,
  onDone,
  onCancel,
}: {
  period: SavingsPeriodDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const existing = period.adjustment;
  const [amount, setAmount] = useState<number | null>(existing?.amountCents ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [errors, setErrors] = useState<Partial<Record<AdjustmentField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSaveAdjustment();
  const remove = useDeleteAdjustment();
  const pending = save.isPending || remove.isPending;
  const pristine = existing
    ? amount === existing.amountCents && note.trim() === existing.note
    : amount === null && note.trim() === '';
  const month = periodLabel(period.periodMonth);

  const submit = (): boolean => {
    const found: Partial<Record<AdjustmentField, string>> = {};
    if (amount === null) found.amountCents = 'Enter the amount.';
    else if (amount === 0) found.amountCents = 'Enter an amount other than zero.';
    if (!note.trim()) found.note = 'Say what the one-off was.';
    else if (note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || amount === null) return false;
    save.mutate(
      { periodMonth: period.periodMonth, body: { amountCents: amount, note: note.trim() } },
      {
        onSuccess: () => onDone('Adjustment saved'),
        onError: (error) => {
          const split = formErrorsOf<AdjustmentField>(error, ['amountCents', 'note']);
          setErrors(split.fields);
          setFormError(split.form);
        },
      },
    );
    return true;
  };

  return (
    <InlineForm
      title={`Adjust ${month}`}
      subtitle="One-off adjustment"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      notes={<KeptCallout>{ADJUSTMENT_KEPT}</KeptCallout>}
      extraActions={
        existing ? (
          <Button
            variant="ghost"
            icon={Trash2}
            disabled={pending}
            onClick={() =>
              remove.mutate(period.periodMonth, {
                onSuccess: () => onDone('Adjustment removed'),
                onError: (error) => setFormError(actionErrorText(error)),
              })
            }
          >
            Remove
          </Button>
        ) : null
      }
    >
      <Grid>
        <GridItem span={6}>
          <MoneyField
            label="Amount"
            value={amount}
            onChange={setAmount}
            allowNegative
            required
            hint={ADJUSTMENT_HINT}
            error={errors.amountCents}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <TextField
            label="Note"
            value={note}
            onChange={setNote}
            maxLength={200}
            required
            error={errors.note}
            disabled={pending}
          />
        </GridItem>
      </Grid>
    </InlineForm>
  );
}

// ─── Period note (recorded periods only) ────────────────────────────────────────────────────────

function NoteForm({
  period,
  onDone,
  onCancel,
}: {
  period: SavingsPeriodDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const existing = period.spendNote;
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
      { kind: 'spend', periodMonth: period.periodMonth, note: note.trim() },
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

// ─── Orphan adjustments ─────────────────────────────────────────────────────────────────────────

function OrphanAdjustment({
  adjustment,
  onDone,
}: {
  adjustment: SavingsAdjustmentDto;
  onDone: (message: string) => void;
}): JSX.Element {
  const remove = useDeleteAdjustment();
  const [error, setError] = useState<string | null>(null);
  const month = periodLabel(adjustment.periodMonth);
  return (
    <Callout kind="note" title="Adjustment without a period">
      <p>
        An adjustment for {month} has no recorded period ({formatMoney(adjustment.amountCents)}:{' '}
        {adjustment.note}).
      </p>
      <Cluster gap={3}>
        <Button
          variant="secondary"
          size="sm"
          icon={Trash2}
          disabled={remove.isPending}
          aria-busy={remove.isPending || undefined}
          aria-label={`Remove the adjustment for ${month}`}
          onClick={() => {
            // This callout unmounts once the refetch drops the orphan, and TanStack Query skips
            // the mutate() callbacks of an unmounted observer; the promise still settles.
            void remove.mutateAsync(adjustment.periodMonth).then(
              () => onDone('Adjustment removed'),
              (e: unknown) => setError(actionErrorText(e)),
            );
          }}
        >
          Remove
        </Button>
      </Cluster>
      <FormError message={error} title="Not removed" />
    </Callout>
  );
}
