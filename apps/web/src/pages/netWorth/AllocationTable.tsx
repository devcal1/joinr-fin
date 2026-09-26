// "Liquid allocation" (stage-5.md §6.3 item 4): Class · Current · Target · Difference (status in
// words, "Under by 9.0%" / "Over by 3.1%", never colour alone), the targets' total with the Settings
// warning when they do not add up to 100 %, the consider-next line (the Stage 2 words) and a link
// to the targets in Settings. Phone: Class, Difference, Current, Target (§6.8).
import type { ConsiderNextRowDto, NetWorthPageResponse } from '@joinr/schema';
import { Card, ColumnTable, type ColumnTableColumn } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';
import { Missing } from '../../components/QueryStates';
import { useTableLayout } from '../assets/layout';
import { orderColumns } from '../cashflow/formState';
import { RatioCell } from '../investments/cells';
import { ASSET_CLASS_LABELS } from '../investments/kinds';
import { allocationDifferenceText, considerNextText, targetSumWarning } from './netWorthText';

const COLUMNS: Record<string, ColumnTableColumn<ConsiderNextRowDto>> = {
  class: {
    id: 'class',
    header: 'Class',
    value: (row) => ASSET_CLASS_LABELS[row.assetClass],
    minWidth: 140,
  },
  current: {
    id: 'current',
    header: 'Current',
    value: (row) => Number(row.currentRatio),
    cell: (row) => <RatioCell ratio={row.currentRatio} />,
    numeric: true,
  },
  target: {
    id: 'target',
    header: 'Target',
    value: (row) => (row.targetRatio === null ? null : Number(row.targetRatio)),
    cell: (row) => <RatioCell ratio={row.targetRatio} />,
    numeric: true,
  },
  difference: {
    id: 'difference',
    header: 'Difference',
    value: (row) => (row.deltaRatio === null ? null : -Number(row.deltaRatio)),
    cell: (row) => {
      const text = allocationDifferenceText(row.deltaRatio);
      return text === null ? <Missing /> : <span className="jf-app-nowrap">{text}</span>;
    },
    numeric: true,
  },
};

const DESKTOP = ['class', 'current', 'target', 'difference'];
const PHONE = ['class', 'difference', 'current', 'target'];

export function AllocationTable({ page }: { page: NetWorthPageResponse }): JSX.Element {
  const layout = useTableLayout();
  const { allocation } = page;
  const warning = targetSumWarning(allocation.targetSumRatio);
  return (
    <Card as="section" title="Liquid allocation">
      <div className="jf-app-block">
        <ColumnTable
          columns={orderColumns(COLUMNS, layout.phone ? PHONE : DESKTOP)}
          rows={allocation.rows}
          getRowId={(row) => row.assetClass}
          caption="Liquid allocation"
          total={{
            label: 'Total',
            cells: { target: <RatioCell ratio={allocation.targetSumRatio} /> },
          }}
          emptyMessage="No liquid assets yet."
        />
        {warning ? (
          <p className="jf-app-meta" data-status="check">
            <span className="jf-app-check-text">{warning}</span>
          </p>
        ) : null}
        <p className="jf-app-next-buy__hint" data-testid="consider-next">
          {considerNextText(allocation.reason, allocation.assetClass)}
        </p>
        <p className="jf-app-meta">
          <Link to="/settings" hash="allocation">
            Targets in Settings
          </Link>
        </p>
      </div>
    </Card>
  );
}
