// "How it's worked out" (stage-6.md §6.3 item 6): you now (net worth to pre-super, the debts held
// fixed in dollars, owner question 2), each year (savings, extra savings, the super contribution
// with "Use the workbook's figure" / "Use the derived figure", the yearly spend, the self-sustaining
// super at FIRE start, the top-ups), the rates (the growth blend, the market return's source,
// inflation, the exact real growth, the withdrawal rate), the months used and any note the callout
// cap moved here.
import { FIRE_WHAT_IF_FIELDS, type FirePageResponse, type FirePeriodRowDto } from '@joinr/schema';
import {
  Button,
  ColumnTable,
  KeyValueTable,
  MEDIA,
  Pill,
  formatMonth,
  useMediaQuery,
  type ColumnTableColumn,
  type KeyValueItem,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { useState, type JSX, type ReactNode } from 'react';
import { errorMessage } from '../../api/client';
import { usePatchSettings, useUseWorkbookContribution } from '../../api/hooks';
import { RATE_DP_PLACE } from '../../formatting';
import { FireCallout } from './FireCallouts';
import {
  DASH,
  longDate,
  money,
  monthRange,
  monthsText,
  rateText,
  realRateComparison,
  yearsText,
  type FireCalloutId,
} from './fireText';

/** A figure inside a phrase: monospaced, tabular. */
function Figure({ children, negative = false }: { children: ReactNode; negative?: boolean }) {
  return (
    <span className={negative ? 'jf-app-fire-figure jf-app-negative' : 'jf-app-fire-figure'}>
      {children}
    </span>
  );
}

function Explain({ children }: { children: ReactNode }): JSX.Element {
  return <span className="jf-app-fire-explain">{children}</span>;
}

/** The id of a row's value, focused after its button disappears. */
function valueId(key: 'superContribution' | 'yearlySpend'): string {
  return `fire-value-${key}`;
}

function focusValue(key: 'superContribution' | 'yearlySpend'): void {
  const element = document.getElementById(valueId(key));
  element?.focus();
}

function youNowItems(page: FirePageResponse): KeyValueItem[] {
  const p = page.derived.preSuper;
  const debts: ReactNode =
    p.debtCents > 0 ? (
      <>
        Includes your debts (<Figure>{money(-p.debtCents)}</Figure>
        {p.primaryResidenceDebtCents > 0 ? (
          <>
            , of which your home loan <Figure>{money(-p.primaryResidenceDebtCents)}</Figure>
          </>
        ) : null}
        ), held fixed in dollars; your home’s value is left out.
      </>
    ) : (
      <>Your home’s value is left out.</>
    );
  return [
    {
      label: 'Net worth',
      value: <Figure negative={p.netWorthCents < 0}>{money(p.netWorthCents)}</Figure>,
    },
    { label: 'less Super', value: <Figure>{money(-p.superCents)}</Figure> },
    {
      label: 'less Your home (value)',
      value: <Figure>{money(-p.primaryResidenceCents)}</Figure>,
    },
    {
      label: 'Pre-super net worth',
      value: (
        <span className="jf-app-fire-kv-stack">
          <Figure negative={p.preSuperCents < 0}>{money(p.preSuperCents)}</Figure>
          <Explain>{debts}</Explain>
          {p.primaryResidenceLoanGrossCents > 0 ? (
            <span className="jf-app-muted">
              Without the home loan: <Figure>{money(p.preSuperExHomeLoanCents)}</Figure>
            </span>
          ) : null}
        </span>
      ),
    },
    { label: 'Super', value: <Figure>{money(p.superCents)}</Figure> },
  ];
}

function savingsText(page: FirePageResponse): ReactNode {
  const { derived, projection } = page;
  const window = derived.window;
  if (projection.noSavingsHistory || !window) {
    return 'No recorded months yet: counted as $0.00 a year.';
  }
  const capped = derived.savings.cappedPeriods;
  return (
    <>
      Average over {monthsText(window.periods)} recorded (to {longDate(window.through)}) × 12
      {capped > 0 ? `; ${monthsText(capped)} capped at income` : ''}
      {derived.savings.superExcludedCents > 0 ? (
        <>
          ; voluntary super contributions (
          <Figure>{money(derived.savings.superExcludedCents)}</Figure> a year) count in super, not
          here
        </>
      ) : null}
      .
    </>
  );
}

function spendText(page: FirePageResponse): ReactNode {
  const spend = page.inputs.yearlySpend;
  const window = page.derived.window;
  switch (spend.source) {
    case 'setting':
      return 'Your setting.';
    case 'what_if':
      return 'What-if (not saved).';
    case 'derived': {
      const floored = page.derived.spend.flooredPeriods;
      return (
        <>
          Average over {monthsText(window?.periods ?? 0)} × 12
          {floored > 0 ? `; ${monthsText(floored)} with no net spending counted as $0.00` : ''}.
        </>
      );
    }
    default:
      return 'Not set: no recorded months to base it on.';
  }
}

function superContributionText(page: FirePageResponse): ReactNode {
  const c = page.inputs.superContribution;
  const d = page.derived.superContribution;
  if (c.source === 'setting') return 'Your setting.';
  if (c.source === 'what_if') return 'What-if (not saved).';
  return (
    <>
      SG <Figure>{money(d.sgCents)}</Figure> + your contributions{' '}
      <Figure>{money(d.memberCents)}</Figure>, {monthRange(d.fromMonth, d.toMonth)}, after
      contributions tax.
      {c.workbookCents !== null ? (
        <>
          {' '}
          The workbook’s figure: <Figure>{money(c.workbookCents)}</Figure>.
        </>
      ) : null}
    </>
  );
}

function growthText(page: FirePageResponse): ReactNode {
  const { growth } = page.derived;
  const rates = page.projection.rates;
  const cashRate = rateText(page.inputs.cashInterestRate.ratio);
  const marketRate = rateText(page.inputs.marketReturn.ratio);
  const blend = rates ? rateText(rates.nominalRatio) : DASH;
  if (growth.cashWeightCents > 0 && growth.marketWeightCents > 0) {
    return (
      <>
        Cash <Figure>{money(growth.cashWeightCents)}</Figure> at {cashRate}, everything else{' '}
        <Figure>{money(growth.marketWeightCents)}</Figure> at {marketRate} →{' '}
        <span title={rates?.nominalRatio}>{blend}</span> a year
      </>
    );
  }
  if (growth.cashWeightCents > 0) {
    return (
      <>
        Cash <Figure>{money(growth.cashWeightCents)}</Figure> at {cashRate} →{' '}
        <span title={rates?.nominalRatio}>{blend}</span> a year
      </>
    );
  }
  return (
    <>
      Everything <Figure>{money(growth.marketWeightCents)}</Figure> at {marketRate} →{' '}
      <span title={rates?.nominalRatio}>{blend}</span> a year
    </>
  );
}

function marketReturnSource(page: FirePageResponse): ReactNode {
  const m = page.inputs.marketReturn;
  if (m.source === 'what_if') return '(what-if)';
  return m.settingKey === 'fire.marketReturn' ? (
    <Link to="/settings" hash="fire">
      (your FIRE return)
    </Link>
  ) : (
    <Link to="/settings" hash="investing">
      (from Investing settings)
    </Link>
  );
}

function topUpsText(page: FirePageResponse): ReactNode {
  const t = page.projection.topUps;
  if (!t) return 'None needed: super reaches what you need at access without them.';
  if (t.level) {
    return (
      <>
        <Figure>{money(t.perYearCents)}</Figure> a year for {yearsText(t.years)} from FIRE start,
        ending {t.endYear}; <Figure>{money(t.totalCents)}</Figure> in all.
      </>
    );
  }
  return (
    <>
      Your super contribution of <Figure>{money(t.perYearCents)}</Figure> a year for{' '}
      {yearsText(t.years)} from FIRE start (the last <Figure>{money(t.lastCents)}</Figure>), ending{' '}
      {t.endYear}; <Figure>{money(t.totalCents)}</Figure> in all.
    </>
  );
}

function MonthsUsed({ rows }: { rows: readonly FirePeriodRowDto[] }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const month: ColumnTableColumn<FirePeriodRowDto> = {
    id: 'month',
    header: 'Month',
    value: (r) => r.periodMonth,
    cell: (r) => formatMonth(r.periodMonth),
  };
  const income: ColumnTableColumn<FirePeriodRowDto> = {
    id: 'income',
    header: 'Income',
    value: (r) => r.incomeCents,
    cell: (r) => money(r.incomeCents),
    numeric: true,
  };
  const spend: ColumnTableColumn<FirePeriodRowDto> = {
    id: 'spend',
    header: 'Spend',
    value: (r) => r.spendCents,
    cell: (r) => money(r.spendCents),
    numeric: true,
  };
  const counted: ColumnTableColumn<FirePeriodRowDto> = {
    id: 'countedSpend',
    header: 'Counted spend',
    value: (r) => r.countedSpendCents,
    cell: (r) => (r.floored ? 'Counted as $0.00' : money(r.countedSpendCents)),
    numeric: true,
  };
  const savings: ColumnTableColumn<FirePeriodRowDto> = {
    id: 'countedSavings',
    header: 'Counted savings',
    value: (r) => r.countedSavingsCents,
    cell: (r) => (
      <span className="jf-app-fire-cell">
        <span className={r.countedSavingsCents < 0 ? 'jf-app-negative' : undefined}>
          {money(r.countedSavingsCents)}
        </span>
        {r.floored ? <Pill tone="na">Capped</Pill> : null}
      </span>
    ),
    numeric: true,
  };
  const columns = phone
    ? [month, counted, spend, income, savings]
    : [month, income, spend, counted, savings];
  return (
    <ColumnTable
      caption="The months used"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.periodMonth}
      emptyMessage="No recorded months yet."
    />
  );
}

export function WorkedOut({
  page,
  movedCallouts,
}: {
  page: FirePageResponse;
  movedCallouts: readonly FireCalloutId[];
}): JSX.Element {
  const { inputs, projection, derived } = page;
  const patch = usePatchSettings();
  const workbook = useUseWorkbookContribution();
  const [actionError, setActionError] = useState<string | null>(null);

  const applyDerived = (key: 'yearlySpend' | 'superContribution'): void => {
    setActionError(null);
    const settingKey =
      key === 'yearlySpend' ? FIRE_WHAT_IF_FIELDS.spend : 'fire.superContributionPerYearCents';
    patch.mutate(
      { values: { [settingKey]: null } },
      {
        onSuccess: () => focusValue(key),
        onError: (error) => setActionError(errorMessage(error)),
      },
    );
  };
  const applyWorkbook = (): void => {
    setActionError(null);
    workbook.mutate(undefined, {
      onSuccess: () => focusValue('superContribution'),
      onError: (error) => setActionError(errorMessage(error)),
    });
  };
  const busy = patch.isPending || workbook.isPending;

  const contribution = inputs.superContribution;
  const spend = inputs.yearlySpend;
  const target = projection.target;
  const accessAge = inputs.accessAge.value;
  const firstHelper = projection.rows[0]?.helper;

  const eachYear: KeyValueItem[] = [
    {
      label: 'Savings a year',
      value: (
        <span className="jf-app-fire-kv-stack">
          <Figure>{money(projection.savingsPerYearCents)}</Figure>
          <Explain>{savingsText(page)}</Explain>
        </span>
      ),
    },
    {
      label: 'Extra savings',
      value: (
        <span className="jf-app-fire-kv-stack">
          <Figure negative={(inputs.extraSavings.cents ?? 0) < 0}>
            {money(inputs.extraSavings.cents ?? 0)}
          </Figure>
          <Explain>
            {inputs.extraSavings.source === 'what_if'
              ? 'What-if (not saved).'
              : inputs.extraSavings.source === 'setting'
                ? 'Your setting.'
                : 'None set.'}
          </Explain>
        </span>
      ),
    },
    {
      label: 'Super contribution a year',
      value: (
        <span className="jf-app-fire-kv-stack">
          <span id={valueId('superContribution')} tabIndex={-1} className="jf-app-fire-focus">
            <Figure>{contribution.cents !== null ? money(contribution.cents) : DASH}</Figure>
          </span>
          <Explain>{superContributionText(page)}</Explain>
          {contribution.workbookCents !== null && contribution.source === 'derived' ? (
            <span>
              <Button size="sm" onClick={applyWorkbook} disabled={busy}>
                Use the workbook’s figure
              </Button>
            </span>
          ) : null}
          {contribution.source === 'setting' ? (
            <span>
              <Button size="sm" onClick={() => applyDerived('superContribution')} disabled={busy}>
                Use the derived figure
              </Button>
            </span>
          ) : null}
        </span>
      ),
    },
    {
      label: 'Yearly spend',
      value: (
        <span className="jf-app-fire-kv-stack">
          <span id={valueId('yearlySpend')} tabIndex={-1} className="jf-app-fire-focus">
            <Figure>{spend.cents !== null ? money(spend.cents) : DASH}</Figure>
          </span>
          <Explain>{spendText(page)}</Explain>
          {spend.source === 'setting' ? (
            <span>
              <Button size="sm" onClick={() => applyDerived('yearlySpend')} disabled={busy}>
                Use the derived figure
              </Button>
            </span>
          ) : null}
        </span>
      ),
    },
  ];
  if (firstHelper) {
    eachYear.push({
      label: 'Needed to stop today',
      value: <Figure>{money(firstHelper.neededCents)}</Figure>,
    });
  }
  if (target && target.superAtFireStartCents !== null && projection.fire) {
    eachYear.push({
      label: 'Super needed at FIRE start',
      value: (
        <Explain>
          <Figure>{money(target.superAtFireStartCents)}</Figure> at FIRE start grows to the{' '}
          <Figure>{money(target.superAtAccessCents)}</Figure> needed at{' '}
          {accessAge ?? 'your access age'}
        </Explain>
      ),
    });
  }
  if (projection.fire) {
    eachYear.push({ label: 'Super top-ups', value: <Explain>{topUpsText(page)}</Explain> });
  }

  const rates = projection.rates;
  const rateItems: KeyValueItem[] = [
    { label: 'Growth', value: <Explain>{growthText(page)}</Explain> },
    {
      label: 'Market return',
      value: (
        <Explain>
          <span title={inputs.marketReturn.ratio ?? undefined}>
            {rateText(inputs.marketReturn.ratio)}
          </span>{' '}
          {marketReturnSource(page)}
        </Explain>
      ),
    },
    {
      label: 'Inflation',
      value: (
        <span title={inputs.inflationRate.ratio ?? undefined}>
          {rateText(inputs.inflationRate.ratio)}
        </span>
      ),
    },
    {
      label: 'Real growth',
      value: rates ? (
        <Explain>
          {rateText(rates.nominalRatio)} and {rateText(rates.inflationRatio)} inflation →{' '}
          {/* The documented two-decimal comparison (stage-6.md §6.3, §6.9 G). */}
          <span title={rates.realRatio} {...RATE_DP_PLACE}>
            {realRateComparison(rates.realRatio, rates.simpleRealRatio).replace(
              /^([^ ]+)/,
              '$1 after inflation',
            )}
          </span>
        </Explain>
      ) : (
        DASH
      ),
    },
    {
      label: 'Withdrawal rate',
      value: inputs.withdrawalRate.ratio ? (
        <Explain>
          <span title={inputs.withdrawalRate.ratio}>{rateText(inputs.withdrawalRate.ratio)}</span>{' '}
          (super needed at access = spend ÷ {rateText(inputs.withdrawalRate.ratio)})
        </Explain>
      ) : (
        DASH
      ),
    },
  ];

  return (
    <div className="jf-app-fire-worked">
      <div className="jf-app-fire-worked__grid">
        <section aria-labelledby="fire-now-heading" className="jf-app-fire-worked__part">
          <h3 id="fire-now-heading" className="jf-app-fire-subhead">
            You now
          </h3>
          <KeyValueTable caption="You now" items={youNowItems(page)} />
        </section>
        <section aria-labelledby="fire-year-heading" className="jf-app-fire-worked__part">
          <h3 id="fire-year-heading" className="jf-app-fire-subhead">
            Each year
          </h3>
          <KeyValueTable caption="Each year" items={eachYear} />
          {actionError ? (
            <p className="jf-field__error" role="alert">
              Couldn’t change it: {actionError}
            </p>
          ) : null}
        </section>
        <section aria-labelledby="fire-rates-heading" className="jf-app-fire-worked__part">
          <h3 id="fire-rates-heading" className="jf-app-fire-subhead">
            Rates
          </h3>
          <KeyValueTable caption="Rates" items={rateItems} />
        </section>
      </div>
      <details className="jf-app-details jf-app-fire-months">
        <summary className="jf-app-details__summary">
          The months used ({monthsText(derived.rows.length)})
        </summary>
        <MonthsUsed rows={derived.rows} />
      </details>
      {movedCallouts.map((id) => (
        <FireCallout key={id} id={id} page={page} />
      ))}
    </div>
  );
}
