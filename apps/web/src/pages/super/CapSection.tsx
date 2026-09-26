// The concessional cap (stage-4.md §6.4 item 5, D70, D75, UX-1): a cap Meter per FY (value = so
// far, or "for the year" once the FY is complete; target = the cap, the projection as the tick, the
// tone from the status) with its figures,
// the Payday Super notes, the near / over callout and the override note. The FY before sits in a
// closed <details>.
import type { SuperCapYearDto, SuperPageResponse } from '@joinr/schema';
import {
  Callout,
  KeyValueTable,
  Meter,
  formatFinancialYear,
  formatMoney,
  type KeyValueItem,
} from '@joinr/ui';
import type { JSX } from 'react';
import { CAP_STATUS_BADGES, percentText } from '../assets/display';
import {
  SG_QUARTERLY_NOTE,
  SG_TRANSITION_NOTE,
  capBeyondTable,
  capSourceText,
  capWarningText,
  isTransitionYear,
} from './superText';

function CapYear({ page, year }: { page: SuperPageResponse; year: SuperCapYearDto }): JSX.Element {
  const fy = formatFinancialYear(year.financialYear);
  const beyond = capBeyondTable(page, year);
  const items: KeyValueItem[] = [
    {
      label: 'Employer SG (counted when the fund receives it)',
      value: formatMoney(year.sgGrossCents),
      numeric: true,
    },
    { label: 'Salary sacrifice', value: formatMoney(year.salarySacrificeCents), numeric: true },
    {
      label: 'Imported (estimate)',
      value: formatMoney(year.importedEstimateCents),
      numeric: true,
    },
    {
      label: year.complete ? 'Total for the year' : 'Projected by 30 June',
      value: `${formatMoney(year.projectedCents)} (${percentText(year.projectedRatio) ?? '—'})`,
      numeric: true,
    },
    {
      label: `Non-concessional ${year.complete ? fy : 'this FY'}`,
      value: formatMoney(year.nonConcessionalCents),
      numeric: true,
    },
    {
      label: 'Cap',
      value: (
        <span className="jf-app-kv-stack jf-app-align-end">
          <span>{formatMoney(year.capCents)}</span>
          <span className="jf-app-muted jf-app-small jf-app-text-value">
            {capSourceText(year, page.statutory.checkedOn)}
          </span>
          {beyond ? <span className="jf-app-muted jf-app-small">{beyond}</span> : null}
        </span>
      ),
      numeric: true,
    },
  ];
  return (
    <div className="jf-app-block">
      <Meter
        kind="cap"
        label={`Concessional contributions ${fy}`}
        valueCents={year.totalCents}
        targetCents={year.capCents}
        markerCents={year.complete ? undefined : year.projectedCents}
        markerLabel="Projected by 30 June"
        tone={CAP_STATUS_BADGES[year.status].tone}
        valueLabel={`${year.complete ? 'for the year' : 'so far'}${year.importedEstimateCents > 0 ? ' (includes estimates)' : ''}`}
      />
      <KeyValueTable caption={`Concessional cap ${fy}`} items={items} />
      {isTransitionYear(year, page.statutory.paydaySuperStart) ? (
        <p className="jf-app-meta">{SG_TRANSITION_NOTE}</p>
      ) : null}
      {year.end <= page.statutory.paydaySuperStart ? (
        <p className="jf-app-meta">{SG_QUARTERLY_NOTE}</p>
      ) : null}
    </div>
  );
}

export function CapSection({ page }: { page: SuperPageResponse }): JSX.Element | null {
  const [current, previous] = page.capYears;
  if (!current) return null;
  const warning = capWarningText(current);
  const override = page.capOverride;
  return (
    <div className="jf-app-block">
      {warning ? (
        <Callout
          kind="important"
          title={current.status === 'over' ? 'Over the cap' : 'Near the cap'}
        >
          <p>{warning}</p>
        </Callout>
      ) : null}
      {override && override.financialYear !== current.financialYear ? (
        <p className="jf-app-meta">
          Your {formatFinancialYear(override.financialYear)} cap override no longer applies; this
          year uses the ATO figure.
        </p>
      ) : null}
      <CapYear page={page} year={current} />
      {previous ? (
        <details className="jf-app-details">
          <summary className="jf-app-details__summary">
            {formatFinancialYear(previous.financialYear)}
          </summary>
          <CapYear page={page} year={previous} />
        </details>
      ) : null}
    </div>
  );
}
