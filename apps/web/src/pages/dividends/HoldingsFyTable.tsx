// This FY by holding (stage-3.md §6.6 item 8, §2.10): net this FY, payments, frequency, DRP, the
// annualised 12-month yield, months to one more unit and the DRP advice (a status badge with its
// word; "—" when unknown). A note explains the 6-month rule; unlinked payments are a muted line.
import type { DividendHoldingFyDto, DividendsPageResponse } from '@joinr/schema';
import {
  Callout,
  ColumnTable,
  MEDIA,
  StatusBadge,
  formatMoney,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import type { JSX } from 'react';
import { Missing } from '../../components/QueryStates';
import { formatCount } from '../../formatting';
import { FlowCell, RatioCell } from '../cashflow/cells';
import { DRP_ADVICE_BADGES, frequencyText, yesNo } from '../cashflow/display';
import { orderColumns } from '../cashflow/formState';
import { DRP_RULE_NOTE } from './dividendsModel';

const DESKTOP_ORDER = [
  'holding',
  'net',
  'payments',
  'frequency',
  'drp',
  'yield',
  'months',
  'advice',
] as const;
const PHONE_ORDER = [
  'holding',
  'advice',
  'net',
  'payments',
  'months',
  'yield',
  'frequency',
  'drp',
] as const;

export function HoldingsFyTable({ page }: { page: DividendsPageResponse }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const all: Record<string, ColumnTableColumn<DividendHoldingFyDto>> = {
    holding: {
      id: 'holding',
      header: 'Holding',
      value: (h) => h.symbol,
      cell: (h) => <span className="jf-app-instrument__symbol">{h.symbol}</span>,
      minWidth: phone ? 104 : 130,
    },
    net: {
      id: 'net',
      header: 'Net this FY',
      value: (h) => h.netThisFyCents,
      cell: (h) => <FlowCell cents={h.netThisFyCents} />,
      numeric: true,
    },
    payments: {
      id: 'payments',
      header: 'Payments',
      value: (h) => h.payments,
      cell: (h) => formatCount(h.payments),
      numeric: true,
    },
    frequency: {
      id: 'frequency',
      header: 'Frequency',
      value: (h) => h.frequencyMonths,
      cell: (h) => frequencyText(h.frequencyMonths) ?? <Missing />,
    },
    drp: {
      id: 'drp',
      header: 'DRP',
      value: (h) => yesNo(h.drp),
      cell: (h) => (h.drp === null ? <span className="jf-app-muted">Unknown</span> : yesNo(h.drp)),
    },
    yield: {
      id: 'yield',
      header: 'Yield (12 months, annualised)',
      value: (h) => (h.yield365Ratio === null ? null : Number(h.yield365Ratio)),
      cell: (h) => <RatioCell ratio={h.yield365Ratio} />,
      numeric: true,
    },
    months: {
      id: 'months',
      header: 'Months to +1 unit',
      value: (h) => h.monthsToExtraUnit,
      cell: (h) => (h.monthsToExtraUnit === null ? <Missing /> : formatCount(h.monthsToExtraUnit)),
      numeric: true,
    },
    advice: {
      id: 'advice',
      header: 'Advice',
      value: (h) => h.advice,
      cell: (h) =>
        h.advice === null ? (
          <Missing />
        ) : (
          <StatusBadge
            status={DRP_ADVICE_BADGES[h.advice].status}
            label={DRP_ADVICE_BADGES[h.advice].label}
          />
        ),
    },
  };
  return (
    <>
      <div className="jf-app-compact-table">
        <ColumnTable
          columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
          rows={page.holdingsThisFy}
          getRowId={(h) => String(h.instrumentId)}
          caption="This FY by holding"
          emptyMessage="No dividends this FY yet."
        />
      </div>
      {page.unlinkedThisFyCents !== 0 ? (
        <p className="jf-app-meta" data-testid="unlinked-this-fy">
          Not linked to a holding this FY: {formatMoney(page.unlinkedThisFyCents)}
        </p>
      ) : null}
      <Callout kind="note" title="DRP advice">
        <p>{DRP_RULE_NOTE}</p>
      </Callout>
    </>
  );
}
