// Employer SG by month (stage-4.md §6.4 item 5, D69, D75): Month (earned) · Source · Before tax ·
// Fund receives · Fund · Cap year · Actions (Enter statement / Edit / Remove). When every month is an
// estimate the column carries one foot-noted marker instead of a badge per row (UX-12). Statement
// months are an overlay: import-safe, kept by a re-import.
import type { SuperPageResponse, SuperSgMonthDto } from '@joinr/schema';
import {
  Button,
  ColumnTable,
  Grid,
  GridItem,
  MoneyField,
  TextField,
  formatFinancialYear,
  type ColumnTableColumn,
} from '@joinr/ui';
import { FileText, Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useDeleteSgOverride, useSaveSgOverride } from '../../api/hooks';
import { FlowCell } from '../cashflow/cells';
import { FormError, InlineForm, KeptCallout } from '../cashflow/forms';
import { actionErrorText, formErrorsOf, orderColumns } from '../cashflow/formState';
import { monthLabel } from '../assets/display';
import { FirstCell, Marker, Markers } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { STATEMENT_KEPT, allEstimates, sgActionKey, sgMarkers } from './superText';

const DESKTOP_ORDER = ['month', 'source', 'gross', 'fundReceives', 'fund', 'capYear', 'actions'];
const PHONE_ORDER = ['month', 'source', 'fundReceives', 'gross', 'fund', 'capYear', 'actions'];

export const ALL_ESTIMATES_NOTE =
  'Every month here is an estimate: your gross salary × the SG rate. Enter a statement to replace one.';

export interface SgMonthsTableProps {
  page: SuperPageResponse;
  locked: boolean;
  onStatement: (month: SuperSgMonthDto) => void;
  onRemoved: (message: string) => void;
}

export function SgMonthsTable({
  page,
  locked,
  onStatement,
  onRemoved,
}: SgMonthsTableProps): JSX.Element {
  const { phone, firstMin } = useTableLayout();
  const remove = useDeleteSgOverride();
  const [error, setError] = useState<string | null>(null);
  const estimatesOnly = allEstimates(page.sgMonths);
  const fundName = (id: number | null): string | null =>
    id === null ? null : (page.funds.find((f) => f.id === id)?.name ?? null);
  // One foot-noted marker for the column when every month shares it.
  const markersOf = (m: SuperSgMonthDto) => (estimatesOnly ? [] : sgMarkers(m));

  const all: Record<string, ColumnTableColumn<SuperSgMonthDto>> = {
    month: {
      id: 'month',
      header: 'Month (earned)',
      value: (m) => m.month,
      cell: (m) => (
        <FirstCell phone={phone} markers={markersOf(m)}>
          <span className="jf-app-nowrap">{monthLabel(m.month)}</span>
        </FirstCell>
      ),
      minWidth: firstMin(128, 112),
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (m) => m.source,
      cell: (m) => {
        if (m.source === 'none') return <span className="jf-app-muted">None</span>;
        if (estimatesOnly) return <span className="jf-app-muted">Estimate</span>;
        return phone ? (
          <span className="jf-app-muted">
            {m.source === 'statement' ? 'Statement' : 'Estimate'}
          </span>
        ) : (
          <Markers ids={sgMarkers(m)} />
        );
      },
    },
    gross: {
      id: 'gross',
      header: 'Before tax',
      value: (m) => m.grossCents,
      cell: (m) => <FlowCell cents={m.grossCents} />,
      numeric: true,
    },
    fundReceives: {
      id: 'fundReceives',
      header: 'Fund receives',
      value: (m) => m.fundReceivesCents,
      cell: (m) => <FlowCell cents={m.fundReceivesCents} />,
      numeric: true,
    },
    fund: {
      id: 'fund',
      header: 'Fund',
      value: (m) => fundName(m.fundId),
      cell: (m) =>
        fundName(m.fundId) ?? <span className="jf-app-muted jf-app-nowrap">No SG fund</span>,
      // Fund names wrap only at spaces (768–1199 px, UX-20; STYLE-3).
      minWidth: phone ? undefined : 120,
    },
    capYear: {
      id: 'capYear',
      header: 'Cap year',
      value: (m) => m.capFinancialYear,
      // An FY label never splits at its dash (STYLE-3).
      cell: (m) => <span className="jf-app-nowrap">{formatFinancialYear(m.capFinancialYear)}</span>,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (m) => {
        const month = monthLabel(m.month);
        const statement = m.source === 'statement';
        return (
          <span className="jf-app-row-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={FileText}
              aria-label={`${statement ? 'Edit the statement for' : 'Enter a statement for'} ${month}`}
              data-cf-action={sgActionKey('statement', m.month)}
              onClick={() => onStatement(m)}
              disabled={locked}
            >
              {statement ? 'Edit' : 'Enter statement'}
            </Button>
            {statement ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                aria-label={`Remove the statement for ${month}`}
                data-cf-action={sgActionKey('remove', m.month)}
                onClick={() => {
                  setError(null);
                  remove.mutate(m.month, {
                    onSuccess: () => onRemoved('Statement removed'),
                    onError: (e) => setError(actionErrorText(e)),
                  });
                }}
                disabled={locked || remove.isPending}
              >
                Remove
              </Button>
            ) : null}
          </span>
        );
      },
    },
  };

  return (
    <div className="jf-app-block jf-app-sg-table">
      <FormError message={error} title="Not removed" />
      <ColumnTable
        columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
        rows={page.sgMonths}
        getRowId={(m) => m.month}
        caption="Employer SG by month"
        showCaption
        emptyMessage="No months yet."
      />
      {estimatesOnly ? (
        <p className="jf-app-meta jf-app-footnote-marker">
          <Marker id="estimate" /> {ALL_ESTIMATES_NOTE}
        </p>
      ) : null}
    </div>
  );
}

type StatementField = 'grossCents' | 'note';

/** Enter or edit a statement month: the employer SG before tax for the month earned (overlay). */
export function StatementForm({
  month,
  onDone,
  onCancel,
}: {
  month: SuperSgMonthDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const existing = month.source === 'statement';
  const [gross, setGross] = useState<number | null>(existing ? month.grossCents : null);
  const [note, setNote] = useState(existing ? (month.note ?? '') : '');
  const [errors, setErrors] = useState<Partial<Record<StatementField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSaveSgOverride();
  const pristine = existing
    ? gross === month.grossCents && (note.trim() || null) === month.note
    : gross === null && note.trim() === '';

  const submit = (): boolean => {
    const found: Partial<Record<StatementField, string>> = {};
    if (gross === null) found.grossCents = 'Enter the employer contribution.';
    if (note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || gross === null) return false;
    save.mutate(
      { periodMonth: month.month, body: { grossCents: gross, note: note.trim() || null } },
      {
        onSuccess: () => onDone('Statement saved'),
        onError: (error) => {
          const split = formErrorsOf<StatementField>(error, ['grossCents', 'note']);
          setErrors(split.fields);
          setFormError(split.form);
        },
      },
    );
    return true;
  };

  return (
    <InlineForm
      title={`Statement · ${monthLabel(month.month)}`}
      subtitle="Employer SG"
      onSubmit={submit}
      onCancel={onCancel}
      pending={save.isPending}
      pristine={pristine}
      formError={formError}
      notes={<KeptCallout>{STATEMENT_KEPT}.</KeptCallout>}
    >
      <Grid>
        <GridItem span={6}>
          <MoneyField
            label="Employer contribution before tax for the month it was earned (as on your payslip)"
            value={gross}
            onChange={setGross}
            required
            error={errors.grossCents}
            disabled={save.isPending}
          />
        </GridItem>
        <GridItem span={6}>
          <TextField
            label="Note"
            value={note}
            onChange={setNote}
            maxLength={200}
            hint="Optional"
            error={errors.note}
            disabled={save.isPending}
          />
        </GridItem>
      </Grid>
    </InlineForm>
  );
}
