// The Budget page's payday transfers (stage-3.md §6.5 item 6, §2.9, §11 fix 17): Account · Per
// pay · Monthly, a stale name's check badge, the rows with no account as "Not assigned", and the
// total per pay against the net pay (the total row white bold, no teal).
import type { BudgetPageResponse, BudgetTransferDto } from '@joinr/schema';
import { Amount, ColumnTable, StatusBadge, formatMoney, type ColumnTableColumn } from '@joinr/ui';
import type { JSX } from 'react';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { FlowCell } from '../cashflow/cells';
import { STALE_ACCOUNT } from './budgetModel';

interface TransferLine {
  key: string;
  label: string;
  stale: boolean;
  rows: number;
  perPayCents: number;
  monthlyCents: number;
}

function transferLines(page: BudgetPageResponse): TransferLine[] {
  const lines: TransferLine[] = page.transfers.map((t: BudgetTransferDto, index) => ({
    key: t.accountId === null ? `name-${index}` : `account-${t.accountId}`,
    label: t.accountName ?? 'Unnamed account',
    stale: !t.linked && t.accountName !== null,
    rows: t.rows,
    perPayCents: t.perPayCents,
    monthlyCents: t.monthlyCents,
  }));
  if (page.unassigned.rows > 0) {
    lines.push({
      key: 'unassigned',
      label: 'Not assigned',
      stale: false,
      rows: page.unassigned.rows,
      perPayCents: page.unassigned.perPayCents,
      monthlyCents: page.unassigned.monthlyCents,
    });
  }
  return lines;
}

export function TransfersSection({ page }: { page: BudgetPageResponse }): JSX.Element {
  const lines = transferLines(page);
  // Without a pay frequency the engine sends 0 per pay and a null total: show "—", never $0.
  const perPayKnown = page.perPayTotalCents !== null;
  const columns: ColumnTableColumn<TransferLine>[] = [
    {
      id: 'account',
      header: 'Account',
      value: (line) => line.label,
      cell: (line) => (
        <span className="jf-app-item-cell">
          <span className={line.key === 'unassigned' ? 'jf-app-muted' : undefined}>
            {line.label}
          </span>
          <span className="jf-app-muted jf-app-small">{plural(line.rows, 'budget row')}</span>
          {line.stale ? <StatusBadge status="check" label={STALE_ACCOUNT} /> : null}
        </span>
      ),
      minWidth: 160,
    },
    {
      id: 'perPay',
      header: 'Per pay',
      value: (line) => (perPayKnown ? line.perPayCents : null),
      cell: (line) => (perPayKnown ? <FlowCell cents={line.perPayCents} /> : <Missing />),
      numeric: true,
    },
    {
      id: 'monthly',
      header: 'Monthly',
      value: (line) => line.monthlyCents,
      cell: (line) => <FlowCell cents={line.monthlyCents} />,
      numeric: true,
    },
  ];
  const total = page.perPayTotalCents;
  const net = page.summary.netPayCents;
  return (
    <>
      <ColumnTable
        columns={columns}
        rows={lines}
        getRowId={(line) => line.key}
        caption="Payday transfers"
        emptyMessage="No budget rows to transfer yet."
        total={{
          label: 'Total each pay',
          cells: {
            perPay: total === null ? <Missing /> : <Amount cents={total} colorNegative={false} />,
            monthly: (
              <Amount
                cents={lines.reduce((sum, line) => sum + line.monthlyCents, 0)}
                colorNegative={false}
              />
            ),
          },
        }}
      />
      {total !== null && net !== null ? (
        <p className="jf-app-meta" data-testid="transfers-vs-pay">
          {formatMoney(total)} of {formatMoney(net)} each pay
        </p>
      ) : (
        <p className="jf-app-meta">Set the pay frequency and net pay to see the amounts per pay.</p>
      )}
    </>
  );
}
