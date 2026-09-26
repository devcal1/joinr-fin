// A mortgage card (stage-4.md §6.5 item 5, D66, D67, UX-21): the loan's facts (a KeyValueTable),
// its balance log (the start point first, labelled "Loan start"; default repayments carry the
// Estimate marker; a repayments-below-principal row carries a Check badge tied to a visible foot
// note) and its charts. Balances owed are positive "balance" figures in body text; interest and
// fees are flows in body text (§6.1).
import type { LoanBalanceEntryDto, LoanDto, PropertyPageResponse } from '@joinr/schema';
import {
  Button,
  Card,
  ColumnTable,
  KeyValueTable,
  StatusBadge,
  formatDate,
  formatMoney,
  type ColumnTableColumn,
  type KeyValueItem,
} from '@joinr/ui';
import { Link2, Pencil, Trash2, Wallet } from 'lucide-react';
import { useId, type JSX, type ReactNode } from 'react';
import { useDeleteLoanBalanceEntry } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { BalanceCell, FlowCell, SourceCell } from '../cashflow/cells';
import { DeleteConfirm, FormError, WorkbookCallout } from '../cashflow/forms';
import { actionSelector, orderColumns, useRowDelete } from '../cashflow/formState';
import { DashWithReason } from '../investments/cells';
import {
  interestRateText,
  monthsSoonerText,
  payoffMissingText,
  payoffText,
  repaymentText,
} from '../assets/display';
import { FirstCell, Marker, Markers } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { LoanCharts } from './LoanCharts';
import {
  BALANCE_INCREASED_NOTE,
  CHECK_FOOTNOTE,
  isEstimatedRepayment,
  loanActionKey,
  loanEntryActionKey,
  loanEntryMarkers,
  loanLog,
} from './propertyText';

const DESKTOP_ORDER = [
  'asOf',
  'balance',
  'payments',
  'repayments',
  'principal',
  'interest',
  'note',
  'source',
  'actions',
] as const;
const PHONE_ORDER = [
  'asOf',
  'balance',
  'interest',
  'repayments',
  'principal',
  'payments',
  'note',
  'source',
  'actions',
] as const;

export const ALL_ESTIMATED_NOTE =
  'Every repayment here is an estimate: the regular payment × the payments due. Enter the actual repayments on an entry to replace one.';

function rowKey(entry: LoanBalanceEntryDto): string {
  return entry.id === null ? `start-${entry.loanId}` : String(entry.id);
}

/** The facts of a loan (§6.5 item 5). */
function loanFacts(
  page: PropertyPageResponse,
  loan: LoanDto,
  estimated: boolean,
  offsetsButton: ReactNode,
): KeyValueItem[] {
  const offsets = page.offsetAccounts.filter((a) => loan.offsetAccountIds.includes(a.id));
  const schedule = loan.schedule;
  const withOffset = loan.offsetCents > 0 && loan.scheduleWithoutOffset !== null;
  const noPayoff = payoffMissingText(schedule?.flag ? [schedule.flag] : loan.flags);
  const items: KeyValueItem[] = [
    {
      label: 'Property',
      value: loan.propertyName ?? <span className="jf-app-muted">Not linked to a property</span>,
    },
    { label: 'Lender', value: loan.lender ?? <Missing /> },
    {
      label: 'Started',
      value:
        loan.startDate === null && loan.startBalanceCents === null ? (
          <DashWithReason reason="No start date or balance" />
        ) : (
          <span className="jf-app-text-value">
            {[
              loan.startDate ? formatDate(loan.startDate) : null,
              loan.startBalanceCents !== null ? formatMoney(loan.startBalanceCents) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ),
    },
    {
      label: 'Interest rate',
      value: interestRateText(loan.annualRate, loan.compoundingPerYear) ?? (
        <DashWithReason reason="No interest rate" />
      ),
    },
    {
      label: 'Repayment',
      value: repaymentText(loan.paymentCents, loan.paymentFrequency) ?? (
        <DashWithReason reason="No repayment amount" />
      ),
    },
    {
      label: 'Balance',
      value: (
        <span className="jf-app-kv-stack jf-app-align-end">
          <BalanceCell cents={loan.balanceCents} />
          <span className="jf-app-muted jf-app-small">as of {formatDate(loan.balanceAsOf)}</span>
        </span>
      ),
      numeric: true,
    },
    {
      label: 'Offset accounts',
      value: (
        <span className="jf-app-kv-stack jf-app-kv-stack--start">
          {offsets.length === 0 ? (
            <span className="jf-app-muted jf-app-text-value">None linked</span>
          ) : (
            <span className="jf-app-text-value">
              {offsets.map((a) => a.name).join(', ')} · {formatMoney(loan.offsetCents)}
            </span>
          )}
          {offsetsButton}
        </span>
      ),
    },
    {
      label: 'Net balance',
      value: <BalanceCell cents={loan.netBalanceCents} />,
      numeric: true,
    },
    {
      label: 'Principal paid',
      value: <FlowCell cents={loan.principalPaidCents} />,
      numeric: true,
    },
    {
      label: estimated ? 'Interest and fees (estimated)' : 'Interest and fees',
      value: <FlowCell cents={loan.interestFeesCents} />,
      numeric: true,
    },
    {
      label: 'Next repayment’s interest',
      value:
        loan.nextPeriodInterestCents === null || schedule === null ? (
          <DashWithReason reason={noPayoff ?? 'No schedule'} />
        ) : (
          <span className="jf-app-kv-stack jf-app-align-end">
            <FlowCell cents={loan.nextPeriodInterestCents} />
            <span className="jf-app-muted jf-app-small jf-app-text-value">
              on {formatDate(schedule.firstPaymentDate)}, from the balance at{' '}
              {formatDate(loan.balanceAsOf)}
            </span>
          </span>
        ),
      numeric: true,
    },
    {
      label: withOffset ? 'Paid off (with the offset)' : 'Paid off',
      value: schedule?.payoffDate ? (
        <span className="jf-app-kv-stack">
          <span>{payoffText(schedule.payoffDate, page.asOf).month}</span>
          <span className="jf-app-muted jf-app-small">
            {payoffText(schedule.payoffDate, page.asOf).inText}
          </span>
        </span>
      ) : (
        <span className="jf-app-muted jf-app-text-value">{noPayoff ?? 'No payoff date'}</span>
      ),
    },
    {
      label: 'Total interest to come',
      value:
        schedule?.totalInterestCents === null || schedule === null ? (
          <DashWithReason reason={noPayoff ?? 'No schedule'} />
        ) : (
          <FlowCell cents={schedule.totalInterestCents} />
        ),
      numeric: true,
    },
  ];
  if (withOffset && loan.scheduleWithoutOffset) {
    const without = loan.scheduleWithoutOffset;
    items.push(
      {
        label: 'Without the offset',
        value: without.payoffDate ? (
          <span className="jf-app-text-value">
            Paid off {payoffText(without.payoffDate, page.asOf).month} ·{' '}
            {without.totalInterestCents !== null
              ? `${formatMoney(without.totalInterestCents)} interest`
              : 'interest not known'}
          </span>
        ) : (
          <span className="jf-app-muted jf-app-text-value">
            {payoffMissingText(without.flag ? [without.flag] : []) ?? 'No payoff date'}
          </span>
        ),
      },
      {
        label: 'Interest saved',
        value:
          loan.interestSavedCents === null ? (
            <Missing />
          ) : (
            <span className="jf-app-kv-stack jf-app-align-end">
              <FlowCell cents={loan.interestSavedCents} />
              {loan.monthsSaved !== null && loan.monthsSaved > 0 ? (
                <span className="jf-app-muted jf-app-small jf-app-text-value">
                  {monthsSoonerText(loan.monthsSaved)}
                </span>
              ) : null}
            </span>
          ),
        numeric: true,
      },
    );
  }
  if (loan.imported && loan.imported.paymentsPaidCents !== null) {
    items.push({
      label: 'Imported “payments paid”',
      value: (
        <span className="jf-app-muted jf-app-text-value">
          The workbook’s figure: {formatMoney(loan.imported.paymentsPaidCents)},{' '}
          {loan.imported.paymentsPaidDerived ? 'principal only' : 'as entered in the workbook'}
        </span>
      ),
    });
  }
  return items;
}

export interface LoanCardProps {
  page: PropertyPageResponse;
  loan: LoanDto;
  locked: boolean;
  onEdit: (loan: LoanDto) => void;
  onUpdate: (loan: LoanDto) => void;
  onOffsets: (loan: LoanDto) => void;
  onEditEntry: (loan: LoanDto, entry: LoanBalanceEntryDto) => void;
  onDeleted: (message: string) => void;
  /** An inline form for this loan, shown under its facts. */
  children?: ReactNode;
}

export function LoanCard({
  page,
  loan,
  locked,
  onEdit,
  onUpdate,
  onOffsets,
  onEditEntry,
  onDeleted,
  children,
}: LoanCardProps): JSX.Element {
  const { phone, firstMin } = useTableLayout();
  const checkNoteId = useId();
  const remove = useDeleteLoanBalanceEntry();
  const rowDelete = useRowDelete<number>((id) => actionSelector(loanEntryActionKey('delete', id)));
  const log = loanLog(page, loan.id);
  const stored = log.filter((e) => e.id !== null);
  const estimatedRows = log.filter(isEstimatedRepayment);
  const allEstimated = stored.length > 0 && estimatedRows.length === stored.length;
  const anyCheck = log.some((e) => e.flags.includes('repayments_below_principal'));
  const confirming = log.find((e) => e.id !== null && e.id === rowDelete.confirming);
  const onlyStored = stored.length <= 1;

  const offsetsButton = (
    <Button
      variant="ghost"
      size="sm"
      icon={Link2}
      aria-label={`Link offset accounts to ${loan.name}`}
      data-cf-action={loanActionKey('offsets', loan.id)}
      onClick={() => onOffsets(loan)}
      disabled={locked}
    >
      Link accounts
    </Button>
  );

  const all: Record<string, ColumnTableColumn<LoanBalanceEntryDto>> = {
    asOf: {
      id: 'asOf',
      header: 'As of',
      value: (e) => e.asOf,
      cell: (e) => {
        const markers = loanEntryMarkers(e, allEstimated);
        const check = e.flags.includes('repayments_below_principal');
        return (
          <FirstCell
            phone={phone}
            markers={markers.filter((m) => m !== 'check')}
            extra={
              <>
                {!phone && e.start ? <Markers ids={['loanStart']} /> : null}
                {check ? (
                  <span className="jf-app-rate-check" aria-describedby={checkNoteId}>
                    <StatusBadge status="check" label="Check" />
                  </span>
                ) : null}
                {e.flags.includes('balance_increased') ? (
                  <span className="jf-app-muted jf-app-small">{BALANCE_INCREASED_NOTE}</span>
                ) : null}
              </>
            }
          >
            <span className="jf-app-nowrap">{formatDate(e.asOf)}</span>
          </FirstCell>
        );
      },
      minWidth: firstMin(132, 124),
    },
    balance: {
      id: 'balance',
      header: 'Balance',
      value: (e) => e.balanceCents,
      cell: (e) => <BalanceCell cents={e.balanceCents} />,
      numeric: true,
    },
    payments: {
      id: 'payments',
      header: 'Payments',
      value: (e) => e.paymentsCounted,
      cell: (e) => (e.paymentsCounted === null ? <Missing /> : String(e.paymentsCounted)),
      numeric: true,
    },
    repayments: {
      id: 'repayments',
      header: 'Repayments',
      value: (e) => e.repaymentsCents,
      cell: (e) => {
        if (e.start) return <Missing />;
        if (e.repaymentsCents === null) return <DashWithReason reason="No repayment amount" />;
        return (
          <span className="jf-app-rate-cell">
            <FlowCell cents={e.repaymentsCents} />
            {e.repaymentsTyped ? (
              <span className="jf-app-muted jf-app-small">Entered</span>
            ) : !phone && !allEstimated ? (
              <Markers ids={['estimate']} />
            ) : null}
          </span>
        );
      },
      numeric: true,
    },
    principal: {
      id: 'principal',
      header: 'Principal',
      value: (e) => e.principalCents,
      cell: (e) => <FlowCell cents={e.principalCents} />,
      numeric: true,
    },
    interest: {
      id: 'interest',
      header: 'Interest and fees',
      value: (e) => e.interestFeesCents,
      cell: (e) => <FlowCell cents={e.interestFeesCents} />,
      numeric: true,
    },
    note: {
      id: 'note',
      header: 'Note',
      value: (e) => e.note,
      cell: (e) => (e.note ? <span className="jf-app-note-cell">{e.note}</span> : <Missing />),
      // Room for a whole 12-letter word, so a note never splits mid-word (768–1199 px, STYLE-3).
      minWidth: 120,
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (e) => e.origin,
      cell: (e) => <SourceCell origin={e.origin} />,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (e) => {
        if (e.id === null) {
          return <span className="jf-app-muted jf-app-small">Edit it in the loan form</span>;
        }
        const id = e.id;
        const label = `balance of ${formatDate(e.asOf)}`;
        if (rowDelete.confirming === id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(id, {
                  onSuccess: () => {
                    rowDelete.finish();
                    onDeleted('Balance deleted');
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
              data-cf-action={loanEntryActionKey('edit', id)}
              onClick={() => onEditEntry(loan, e)}
              disabled={locked || rowDelete.confirming !== null}
            >
              Edit
            </Button>
            {onlyStored ? null : (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                aria-label={`Delete the ${label}`}
                data-cf-action={loanEntryActionKey('delete', id)}
                onClick={() => rowDelete.ask(id)}
                disabled={locked || rowDelete.confirming !== null}
              >
                Delete
              </Button>
            )}
          </span>
        );
      },
    },
  };

  return (
    <Card
      as="section"
      title={loan.name}
      subtitle={loan.propertyName ?? 'Not linked to a property'}
      actions={
        <span className="jf-app-row-actions jf-app-row-actions--wrap">
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            aria-label={`Edit ${loan.name}`}
            data-cf-action={loanActionKey('edit', loan.id)}
            onClick={() => onEdit(loan)}
            disabled={locked}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={Wallet}
            aria-label={`Update the balance of ${loan.name}`}
            data-cf-action={loanActionKey('update', loan.id)}
            onClick={() => onUpdate(loan)}
            disabled={locked}
          >
            Update balance
          </Button>
        </span>
      }
    >
      <div className="jf-app-block">
        <KeyValueTable
          caption={`${loan.name}: facts`}
          items={loanFacts(page, loan, estimatedRows.length > 0, offsetsButton)}
        />
        {children}
        {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
        <FormError message={rowDelete.error} title="Not deleted" />
        <div className="jf-app-loan-log">
          <ColumnTable
            columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
            rows={log}
            getRowId={rowKey}
            caption={`Balance log: ${loan.name}, ${plural(stored.length, 'entry', 'entries')}`}
            showCaption
            emptyMessage="No balances yet."
          />
        </div>
        <div className="jf-app-footnotes">
          {anyCheck ? (
            <p id={checkNoteId} className="jf-app-meta">
              {CHECK_FOOTNOTE}
            </p>
          ) : null}
          {allEstimated ? (
            <p className="jf-app-meta jf-app-footnote-marker">
              <Marker id="estimate" /> {ALL_ESTIMATED_NOTE}
            </p>
          ) : null}
          {onlyStored ? <p className="jf-app-meta">A loan keeps at least one balance.</p> : null}
        </div>
        <LoanCharts loan={loan} log={log} />
      </div>
    </Card>
  );
}
