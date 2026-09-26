// Contributions (stage-4.md §6.4 item 5, UX-23, D71): Date · Fund · Type · Pre-tax · Fund receives ·
// Take-home cost · Toward the cap · Period · Note · Actions (phone: status-first, the Estimate and
// Provisional markers in the first cell). Imported rows carry the Estimate marker; a take-home cost
// without a marginal rate is "—" with the reason.
import type { SuperContributionDto, SuperPageResponse } from '@joinr/schema';
import { Amount, Button, ColumnTable, Pill, formatDate, type ColumnTableColumn } from '@joinr/ui';
import { Pencil, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import { useDeleteSuperContribution } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { FlowCell } from '../cashflow/cells';
import { DeleteConfirm, FormError, WorkbookCallout } from '../cashflow/forms';
import { actionSelector, orderColumns, useRowDelete } from '../cashflow/formState';
import { DashWithReason } from '../investments/cells';
import { CONTRIBUTION_KIND_LABELS, monthLabel, sumCents } from '../assets/display';
import { FirstCell, Markers } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { contributionActionKey, contributionMarkers } from './superText';

const DESKTOP_ORDER = [
  'date',
  'fund',
  'type',
  'preTax',
  'fundReceives',
  'netPay',
  'cap',
  'period',
  'note',
  'actions',
] as const;
const PHONE_ORDER = [
  'date',
  'type',
  'preTax',
  'fundReceives',
  'netPay',
  'fund',
  'cap',
  'period',
  'note',
  'actions',
] as const;

export interface ContributionsTableProps {
  page: SuperPageResponse;
  locked: boolean;
  onEdit: (contribution: SuperContributionDto) => void;
  onDeleted: (message: string) => void;
}

export function ContributionsTable({
  page,
  locked,
  onEdit,
  onDeleted,
}: ContributionsTableProps): JSX.Element {
  const { phone, firstMin } = useTableLayout();
  const remove = useDeleteSuperContribution();
  const rowDelete = useRowDelete<number>((id) =>
    actionSelector(contributionActionKey('delete', id)),
  );
  const rows = page.contributions;
  const confirming = rows.find((c) => c.id === rowDelete.confirming);

  const all: Record<string, ColumnTableColumn<SuperContributionDto>> = {
    date: {
      id: 'date',
      header: 'Date',
      value: (c) => c.date,
      cell: (c) => (
        <FirstCell phone={phone} markers={contributionMarkers(c)}>
          <span className="jf-app-nowrap">{formatDate(c.date)}</span>
        </FirstCell>
      ),
      minWidth: firstMin(104, 112),
    },
    fund: {
      id: 'fund',
      header: 'Fund',
      value: (c) => c.fundName,
      cell: (c) =>
        c.fundName ? (
          <span className="jf-app-note-cell">{c.fundName}</span>
        ) : (
          <span className="jf-app-muted">Not assigned</span>
        ),
    },
    type: {
      id: 'type',
      header: 'Type',
      value: (c) => CONTRIBUTION_KIND_LABELS[c.kind],
      cell: (c) => (
        <span className="jf-app-period-cell">
          <Pill tone={c.kind === 'voluntary_contribution' ? 'na' : 'teal'}>
            {CONTRIBUTION_KIND_LABELS[c.kind]}
          </Pill>
          {c.estimate && !phone ? <Markers ids={['estimate']} /> : null}
        </span>
      ),
    },
    preTax: {
      id: 'preTax',
      header: 'Pre-tax',
      value: (c) => c.preTaxCents,
      cell: (c) =>
        c.preTaxCents === null ? (
          <DashWithReason reason="After-tax: not pre-tax" />
        ) : (
          <FlowCell cents={c.preTaxCents} />
        ),
      numeric: true,
    },
    fundReceives: {
      id: 'fundReceives',
      header: 'Fund receives',
      value: (c) => c.fundReceivesCents,
      cell: (c) => <FlowCell cents={c.fundReceivesCents} />,
      numeric: true,
    },
    netPay: {
      id: 'netPay',
      header: 'Take-home cost',
      value: (c) => c.netPayCostCents,
      cell: (c) =>
        c.netPayCostCents === null ? (
          <DashWithReason reason="No marginal rate" />
        ) : (
          <FlowCell cents={c.netPayCostCents} />
        ),
      numeric: true,
    },
    cap: {
      id: 'cap',
      header: 'Toward the cap',
      value: (c) => (c.concessional ? 'Concessional' : 'Non-concessional'),
      // A short status word, kept whole (STYLE-3).
      cell: (c) => (
        <span className="jf-app-nowrap">
          {c.concessional ? 'Concessional' : 'Non-concessional'}
        </span>
      ),
    },
    period: {
      id: 'period',
      header: 'Period',
      value: (c) => c.periodMonth,
      cell: (c) =>
        c.periodMonth === null ? (
          <DashWithReason reason="No recorded month yet" />
        ) : (
          <span className="jf-app-period-cell">
            <span className="jf-app-nowrap">{monthLabel(c.periodMonth)}</span>
            {c.provisional && !phone ? <Markers ids={['provisional']} /> : null}
          </span>
        ),
    },
    note: {
      id: 'note',
      header: 'Note',
      value: (c) => c.note,
      cell: (c) => (c.note ? <span className="jf-app-note-cell">{c.note}</span> : <Missing />),
      // Room for a whole 12-letter word, so a note never splits mid-word (768–1199 px, STYLE-3).
      minWidth: 120,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (c) => {
        const label = `contribution of ${formatDate(c.date)}`;
        if (rowDelete.confirming === c.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(c.id, {
                  onSuccess: () => {
                    rowDelete.finish();
                    onDeleted('Contribution deleted');
                  },
                  onError: rowDelete.fail,
                })
              }
              onCancel={rowDelete.cancel}
            />
          );
        }
        return (
          <span className="jf-app-row-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              aria-label={`Edit the ${label}`}
              data-cf-action={contributionActionKey('edit', c.id)}
              onClick={() => onEdit(c)}
              disabled={locked || rowDelete.confirming !== null}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              aria-label={`Delete the ${label}`}
              data-cf-action={contributionActionKey('delete', c.id)}
              onClick={() => rowDelete.ask(c.id)}
              disabled={locked || rowDelete.confirming !== null}
            >
              Delete
            </Button>
          </span>
        );
      },
    },
  };

  return (
    <div className="jf-app-block jf-app-contributions-table">
      {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error} title="Not deleted" />
      <ColumnTable
        columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
        rows={rows}
        getRowId={(c) => String(c.id)}
        caption={`Contributions: ${plural(rows.length, 'contribution')}`}
        showCaption
        emptyMessage="No contributions yet."
        total={
          rows.length > 0
            ? {
                label: 'Total',
                cells: {
                  fundReceives: <Amount cents={sumCents(rows.map((c) => c.fundReceivesCents))} />,
                  // A take-home cost unknown on any row (no marginal rate) leaves no total.
                  netPay: rows.some((c) => c.netPayCostCents === null) ? null : (
                    <Amount cents={sumCents(rows.map((c) => c.netPayCostCents))} />
                  ),
                },
              }
            : undefined
        }
      />
    </div>
  );
}
