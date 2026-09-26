// Update balances (stage-4.md §6.5 item 1, UX-22, D66): every loan's balance with the shared As of
// and Note, and optional repayments per row (the placeholder is the estimate at the shared date,
// from the loan's payment dates). Save sends the loans whose balance changed or whose repayments
// were typed (`PUT /api/property/loan-balances`).
import type { LoanDto, PropertyPageResponse } from '@joinr/schema';
import { ColumnTable, MoneyField, formatDate, type ColumnTableColumn } from '@joinr/ui';
import { useState, type JSX } from 'react';
import { useSaveLoanBalances } from '../../api/hooks';
import { plural } from '../../formatting';
import { OlderNote, SharedEntryForm } from '../assets/SharedEntryForm';
import { isOlder, olderThanLatest, useSharedEntry } from '../assets/sharedEntry';
import { FirstCell } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { estimatePlaceholder, estimateRepayments, loanLog } from './propertyText';

interface Draft {
  balance: number | null;
  repayments: number | null;
}

function rowChanged(draft: Draft | undefined, loan: LoanDto): boolean {
  if (!draft) return false;
  const balanceChanged = draft.balance !== null && draft.balance !== loan.balanceCents;
  return balanceChanged || (draft.balance !== null && draft.repayments !== null);
}

export function LoanBalancesForm({
  page,
  onDone,
  onCancel,
}: {
  page: PropertyPageResponse;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const { phone, firstMin } = useTableLayout();
  const state = useSharedEntry();
  const save = useSaveLoanBalances();
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(
      page.loans.map((l) => [l.id, { balance: l.balanceCents, repayments: null }]),
    ),
  );
  const pending = save.isPending;
  const rows = page.loans.filter((l) => rowChanged(drafts[l.id], l));
  const setDraft = (id: number, patch: Partial<Draft>): void =>
    setDrafts((d) => ({ ...d, [id]: { balance: null, repayments: null, ...d[id], ...patch } }));

  const columns: ColumnTableColumn<LoanDto>[] = [
    {
      id: 'loan',
      header: 'Loan',
      value: (l) => l.name,
      cell: (l) => (
        <FirstCell
          phone={phone}
          markers={[]}
          extra={
            l.propertyName ? (
              <span className="jf-app-muted jf-app-small">{l.propertyName}</span>
            ) : null
          }
        >
          <span>{l.name}</span>
        </FirstCell>
      ),
      minWidth: firstMin(200, 140),
    },
    {
      id: 'balance',
      header: 'Balance',
      value: (l) => l.balanceCents,
      cell: (l) => {
        const draft = drafts[l.id];
        return (
          <span className="jf-app-balance-edit">
            <MoneyField
              label={`Balance, ${l.name}`}
              labelHidden
              value={draft?.balance ?? null}
              onChange={(cents) => setDraft(l.id, { balance: cents })}
              disabled={pending}
            />
            {rowChanged(draft, l) && isOlder(state.asOf, l.balanceAsOf) ? (
              <OlderNote text={olderThanLatest('balance', l.balanceAsOf)} />
            ) : null}
          </span>
        );
      },
      numeric: true,
    },
    {
      id: 'repayments',
      header: 'Repayments',
      value: () => null,
      cell: (l) => {
        const estimate = estimateRepayments(l, loanLog(page, l.id), state.asOf ?? page.asOf);
        return (
          <span className="jf-app-balance-edit">
            <MoneyField
              label={`Repayments, ${l.name}`}
              labelHidden
              value={drafts[l.id]?.repayments ?? null}
              onChange={(cents) => setDraft(l.id, { repayments: cents })}
              placeholder={estimatePlaceholder(estimate)}
              disabled={pending}
            />
          </span>
        );
      },
      numeric: true,
    },
    {
      id: 'asOf',
      header: 'Latest',
      value: (l) => l.balanceAsOf,
      cell: (l) => formatDate(l.balanceAsOf),
      numeric: true,
    },
  ];

  const submit = (): boolean => {
    if (!state.asOf) return false;
    save.mutate(
      {
        asOf: state.asOf,
        entries: rows.map((l) => {
          const draft = drafts[l.id];
          return {
            loanId: l.id,
            balanceCents: draft?.balance ?? l.balanceCents,
            ...(draft?.repayments !== null && draft?.repayments !== undefined
              ? { repaymentsCents: draft.repayments }
              : {}),
            ...(state.sharedNote ? { note: state.sharedNote } : {}),
          };
        }),
      },
      { onSuccess: () => onDone('Balances saved'), onError: state.fail },
    );
    return true;
  };

  return (
    <SharedEntryForm
      label="Update balances"
      saveLabel="Save balances"
      state={state}
      pristine={rows.length === 0}
      statusLine={
        rows.length === 0
          ? 'Type the new balances below; leave Repayments empty to use the estimate. Only the loans you change are saved.'
          : `${plural(rows.length, 'balance')} changed.`
      }
      workbook={rows.some((l) => l.origin === 'import')}
      pending={pending}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <ColumnTable
        columns={columns}
        rows={page.loans}
        getRowId={(l) => String(l.id)}
        caption={`Loan balances: ${plural(page.loans.length, 'loan')}`}
        showCaption
      />
    </SharedEntryForm>
  );
}
