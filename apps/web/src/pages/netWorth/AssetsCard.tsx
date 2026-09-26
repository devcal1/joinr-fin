// "Assets and liabilities" (stage-5.md §6.3 item 4): the nine classes (offsets only when non-zero;
// cash has no gain), Total assets, the liabilities as positive "owed" figures (mortgages net of
// linked offsets with a gross line, accounts in debit and imported other debts only when
// non-zero), Total liabilities and Net worth (white bold, no teal: the hero holds the key figure).
// Under Mortgages, one muted line per loan (`mortgageLoans`, display only; Fixer round 1, SPEC-1).
// Assets − liabilities = net worth on screen. Liquid assets and assets excluding super follow.
import type { DecimalString, NetWorthPageResponse } from '@joinr/schema';
import { Card, ColumnTable, KeyValueTable, formatMoney, type ColumnTableColumn } from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import { MoneyCell, RatioCell } from '../investments/cells';
import { useTableLayout } from '../assets/layout';
import { orderColumns } from '../cashflow/formState';
import { LIABILITY_LABELS, NET_WORTH_CLASS_LABELS } from '../history/display';
import { ASSETS_FOOTNOTE, mortgageLoanText } from './netWorthText';

interface AssetRow {
  id: string;
  label: string;
  /** Extra muted lines under the label (the mortgage's gross and offsets, then one per loan). */
  details?: string[];
  kind: 'class' | 'liability' | 'subtotal' | 'heading';
  valueCents: number | null;
  gainCents: number | null;
  gainRatio: DecimalString | null;
  /** Cash has no gain ("—"); liabilities and totals show the value only. */
  noGain: boolean;
}

type Liability = NetWorthPageResponse['liabilities'][number];

/** The Mortgages row's lines: the gross and linked offsets (when any), then one per loan. */
function mortgageDetails(page: NetWorthPageResponse, l: Liability): string[] {
  const lines =
    l.offsetCents !== 0
      ? [`Gross ${formatMoney(l.grossCents)} less linked offsets ${formatMoney(l.offsetCents)}`]
      : [];
  for (const loan of page.mortgageLoans ?? []) lines.push(mortgageLoanText(loan));
  return lines;
}

function rowsOf(page: NetWorthPageResponse): AssetRow[] {
  const classes: AssetRow[] = page.classes
    .filter((c) => c.key !== 'offsets' || c.valueCents !== 0)
    .map((c) => ({
      id: `class-${c.key}`,
      label: NET_WORTH_CLASS_LABELS[c.key],
      kind: 'class',
      valueCents: c.valueCents,
      gainCents: c.key === 'cash' || c.key === 'offsets' ? null : c.gainCents,
      gainRatio: c.key === 'cash' || c.key === 'offsets' ? null : c.gainRatio,
      noGain: false,
    }));
  const liabilities: AssetRow[] = page.liabilities
    .filter((l) => l.key === 'mortgages' || l.balanceCents !== 0)
    .map((l) => ({
      id: `liability-${l.key}`,
      label: LIABILITY_LABELS[l.key],
      details: l.key === 'mortgages' ? mortgageDetails(page, l) : undefined,
      kind: 'liability',
      valueCents: l.balanceCents,
      gainCents: null,
      gainRatio: null,
      noGain: true,
    }));
  return [
    ...classes,
    {
      id: 'total-assets',
      label: 'Total assets',
      kind: 'subtotal',
      valueCents: page.assetsCents,
      gainCents: null,
      gainRatio: null,
      noGain: true,
    },
    {
      id: 'liabilities',
      label: 'Liabilities',
      kind: 'heading',
      valueCents: null,
      gainCents: null,
      gainRatio: null,
      noGain: true,
    },
    ...liabilities,
    {
      id: 'total-liabilities',
      label: 'Total liabilities',
      kind: 'subtotal',
      valueCents: page.liabilitiesCents,
      gainCents: null,
      gainRatio: null,
      noGain: true,
    },
  ];
}

/** White bold for the subtotal rows (the table's total row is Net worth). */
function strong(row: AssetRow, content: ReactNode): ReactNode {
  return row.kind === 'subtotal' || row.kind === 'heading' ? (
    <span className="jf-app-total-cell">{content}</span>
  ) : (
    content
  );
}

const COLUMNS: Record<string, ColumnTableColumn<AssetRow>> = {
  item: {
    id: 'item',
    header: 'Item',
    value: (row) => row.label,
    cell: (row) =>
      strong(
        row,
        <span className="jf-app-first-cell">
          <span className="jf-app-first-cell__main">{row.label}</span>
          {(row.details ?? []).map((text) => (
            <span key={text} className="jf-app-meta" data-testid="asset-detail">
              {text}
            </span>
          ))}
        </span>,
      ),
    minWidth: 180,
  },
  value: {
    id: 'value',
    header: 'Value',
    value: (row) => row.valueCents,
    // Liabilities are positive "owed" figures in body text (never the stop tint, §6.1).
    cell: (row) =>
      row.kind === 'heading'
        ? null
        : strong(row, <MoneyCell cents={row.valueCents} loss={row.kind === 'class'} />),
    numeric: true,
  },
  gain: {
    id: 'gain',
    header: 'Gain',
    value: (row) => row.gainCents,
    cell: (row) => (row.noGain ? null : <MoneyCell cents={row.gainCents} />),
    numeric: true,
  },
  gainRatio: {
    id: 'gainRatio',
    header: 'Gain %',
    value: (row) => (row.gainRatio === null ? null : Number(row.gainRatio)),
    cell: (row) => (row.noGain ? null : <RatioCell ratio={row.gainRatio} loss />),
    numeric: true,
  },
};

const ORDER = ['item', 'value', 'gain', 'gainRatio'];

export function AssetsCard({ page }: { page: NetWorthPageResponse }): JSX.Element {
  const layout = useTableLayout();
  const rows = rowsOf(page);
  return (
    <Card as="section" title="Assets and liabilities">
      <div className="jf-app-block">
        <div className="jf-app-compact-table jf-app-networth-table">
          <ColumnTable
            columns={orderColumns(COLUMNS, ORDER)}
            rows={rows}
            getRowId={(row) => row.id}
            caption="Assets and liabilities"
            total={{
              label: 'Net worth',
              cells: { value: <MoneyCell cents={page.live.netWorth.netWorthCents} loss={false} /> },
            }}
            stickyFirstColumn={layout.phone}
          />
        </div>
        <p className="jf-app-meta">{ASSETS_FOOTNOTE}</p>
        <KeyValueTable
          caption="Liquid assets"
          items={[
            {
              label: 'Liquid assets',
              value: <MoneyCell cents={page.live.netWorth.liquidCents} />,
              numeric: true,
            },
            {
              label: 'Assets excluding super',
              value: <MoneyCell cents={page.assetsExSuperCents} />,
              numeric: true,
            },
          ]}
        />
      </div>
    </Card>
  );
}
