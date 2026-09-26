// Dividends (stage-3.md §2.10; §11 fixes 22, 23): the per-payment rule (stage-2.md §2.9, one
// implementation shared with computeInvestments), the FY table, the rolling 12 months, this FY by
// holding with the DRP advice, and the SheetOptions H28/H30 figures.
import {
  addMonthsIso,
  financialYearOfIso,
  INSTRUMENT_KINDS,
  isoMonthOf,
  type InstrumentKind,
  type IsoDate,
  type IsoMonth,
} from '@joinr/schema';
import {
  addDaysIso,
  ceilWhole,
  centsOf,
  checkCents,
  dayNumber,
  dec,
  decimalString,
  decN,
  dollarsOf,
  mean,
  ratioString,
  sum,
  sumCents,
  type Dec,
} from './num';
import { yearWindow } from './periods';
import type {
  Cents,
  DividendFyRow,
  DividendHoldingFyResult,
  DividendMonthRow,
  DividendResult,
  DividendsInput,
  DividendsResult,
  EngineDividend,
  EngineTrade,
} from './types';

/** DRP advice: switch on below 6 months to an extra unit, off from 6 months (Dividends R). */
export const DRP_ADVICE_MONTHS = 6;
/** The five FYs the sheet always shows (K4:K8). */
const FY_TABLE_YEARS = 5;
const DAYS_PER_YEAR = 365;
/** Days per year for the FY projection (SheetOptions H28). */
const PROJECTION_DAYS = '365.25';

/**
 * Stage 2 §2.9, the per-payment rule: units at the ex-date (the instrument's trades dated before
 * it) and the yield net / (price at ex-date × units). A payment that is not linked, or has no
 * ex-date, has neither; no price or no units → no yield.
 */
export function paymentMetrics(
  d: EngineDividend,
  linked: boolean,
  unitsBefore: (instrumentId: number, before: IsoDate) => Dec,
): { result: DividendResult; yieldDec: Dec | null } {
  if (!linked || d.instrumentId === null || d.exDate === null) {
    return {
      result: { dividendId: d.id, instrumentId: d.instrumentId, unitsAtEx: null, yieldRatio: null },
      yieldDec: null,
    };
  }
  const unitsAtEx = unitsBefore(d.instrumentId, d.exDate);
  let yieldDec: Dec | null = null;
  if (d.priceAtEx !== null && unitsAtEx.greaterThan(0)) {
    const px = dec(d.priceAtEx, `dividend ${d.id} price at ex-date`);
    if (px.greaterThan(0)) yieldDec = dollarsOf(d.netAmountCents).div(px.times(unitsAtEx));
  }
  return {
    result: {
      dividendId: d.id,
      instrumentId: d.instrumentId,
      unitsAtEx: decimalString(unitsAtEx),
      yieldRatio: yieldDec === null ? null : ratioString(yieldDec),
    },
    yieldDec,
  };
}

/** Units of each instrument's trades dated strictly before a date (sells negative). */
export function unitsBeforeOf(
  trades: readonly EngineTrade[],
): (instrumentId: number, before: IsoDate) => Dec {
  const byInstrument = new Map<number, { date: IsoDate; units: Dec }[]>();
  for (const t of trades) {
    dayNumber(t.tradeDate);
    const list = byInstrument.get(t.instrumentId) ?? [];
    list.push({ date: t.tradeDate, units: dec(t.units, `trade ${t.id} units`) });
    byInstrument.set(t.instrumentId, list);
  }
  return (instrumentId, before) =>
    sum((byInstrument.get(instrumentId) ?? []).filter((t) => t.date < before).map((t) => t.units));
}

const zeroByKind = (): Record<InstrumentKind, Cents> =>
  Object.fromEntries(INSTRUMENT_KINDS.map((k) => [k, 0])) as Record<InstrumentKind, Cents>;

export function computeDividends(input: DividendsInput): DividendsResult {
  const asOf = input.asOf;
  const asOfDay = dayNumber(asOf);
  const fyWindow = yearWindow(asOf, 'fy');
  const fy = fyWindow.year;
  const holdingById = new Map(input.holdings.map((h) => [h.instrumentId, h]));
  // Linked: the instrument is a holding of the payment's kind (the Stage 2 rule).
  const isLinked = (d: EngineDividend) =>
    d.instrumentId !== null && holdingById.get(d.instrumentId)?.kind === d.holdingKind;
  const unitsBefore = unitsBeforeOf(input.trades);

  for (const d of input.dividends) {
    dayNumber(d.paymentDate);
    checkCents(d.netAmountCents, `dividend ${d.id}`);
  }
  const metrics = input.dividends.map((d) => ({
    d,
    ...paymentMetrics(d, isLinked(d), unitsBefore),
  }));
  const inThisFy = (d: EngineDividend) =>
    d.paymentDate >= fyWindow.start && d.paymentDate < fyWindow.end;

  // By financial year (K4:P8 and older years), newest first: asOf's FY and the four before it
  // always, plus every other FY with a payment (a payment dated in a later FY keeps its row too,
  // so the table always adds up to the all-time total).
  const fys = new Set<number>();
  for (let k = 0; k < FY_TABLE_YEARS; k++) fys.add(fy - k);
  for (const d of input.dividends) fys.add(financialYearOfIso(d.paymentDate));
  const byFinancialYear: DividendFyRow[] = [...fys]
    .sort((a, b) => b - a)
    .map((year) => {
      const byKind = zeroByKind();
      for (const d of input.dividends) {
        if (financialYearOfIso(d.paymentDate) === year) byKind[d.holdingKind] += d.netAmountCents;
      }
      return { financialYear: year, byKind, totalCents: sumCents(Object.values(byKind)) };
    });

  // The 12 calendar months ending with asOf's month (K30:P41), oldest first.
  const lastMonth = isoMonthOf(asOf);
  const months: IsoMonth[] = [];
  for (let k = 11; k >= 0; k--) months.push(addMonthsIso(`${lastMonth}-01`, -k).slice(0, 7));
  const rolling12: DividendMonthRow[] = months.map((month) => {
    const byKind = zeroByKind();
    for (const d of input.dividends) {
      if (d.paymentDate.slice(0, 7) === month) byKind[d.holdingKind] += d.netAmountCents;
    }
    return { month, byKind, totalCents: sumCents(Object.values(byKind)) };
  });

  // This FY by holding (K45:R89): linked payments dated in [FY start, FY end) (§11 fix 22).
  const cutoffDay = dayNumber(addDaysIso(asOf, -DAYS_PER_YEAR));
  const holdingsThisFy: DividendHoldingFyResult[] = [];
  const thisFyIds = new Set(
    metrics.filter((m) => isLinked(m.d) && inThisFy(m.d)).map((m) => m.d.instrumentId!),
  );
  for (const instrumentId of thisFyIds) {
    const h = holdingById.get(instrumentId)!;
    const own = metrics.filter((m) => m.d.instrumentId === instrumentId && isLinked(m.d));
    const fyPayments = own.filter((m) => inThisFy(m.d));
    const frequencyMonths =
      h.dividendFreqMonths !== null && h.dividendFreqMonths > 0 ? h.dividendFreqMonths : null;
    // O: the mean of the payments with a yield in (asOf − 365, asOf] (§11 fix 23), annualised.
    const meanYield = mean(
      own
        .filter((m) => {
          const day = dayNumber(m.d.paymentDate);
          return m.yieldDec !== null && day > cutoffDay && day <= asOfDay;
        })
        .map((m) => m.yieldDec!),
    );
    const unitsNow = dec(h.unitsNow, `holding ${instrumentId} units`);
    const monthsToExtraUnit =
      frequencyMonths === null ||
      meanYield === null ||
      !meanYield.greaterThan(0) ||
      !unitsNow.greaterThan(0)
        ? null
        : ceilWhole(decN(frequencyMonths).div(meanYield.times(unitsNow)));
    let advice: DividendHoldingFyResult['advice'] = null;
    if (h.drp !== null && monthsToExtraUnit !== null) {
      if (monthsToExtraUnit < DRP_ADVICE_MONTHS && h.drp === false) advice = 'switch_on';
      else if (monthsToExtraUnit >= DRP_ADVICE_MONTHS && h.drp === true) advice = 'switch_off';
      else advice = 'keep';
    }
    holdingsThisFy.push({
      instrumentId,
      kind: h.kind,
      netThisFyCents: sumCents(fyPayments.map((m) => m.d.netAmountCents)),
      payments: fyPayments.length,
      frequencyMonths,
      drp: h.drp,
      yield365Ratio:
        meanYield === null || frequencyMonths === null
          ? null
          : ratioString(meanYield.times(12).div(frequencyMonths)),
      monthsToExtraUnit,
      advice,
    });
  }
  holdingsThisFy.sort(
    (a, b) => b.netThisFyCents - a.netThisFyCents || a.instrumentId - b.instrumentId,
  );

  const thisFyCents = sumCents(input.dividends.filter(inThisFy).map((d) => d.netAmountCents));
  const daysIntoFy = asOfDay - dayNumber(fyWindow.start) + 1;
  return {
    rows: metrics.map((m) => m.result),
    byFinancialYear,
    rolling12,
    holdingsThisFy,
    unlinkedThisFyCents: sumCents(
      input.dividends.filter((d) => inThisFy(d) && !isLinked(d)).map((d) => d.netAmountCents),
    ),
    kpis: {
      financialYear: fy,
      thisFyCents,
      lastFyCents: sumCents(
        input.dividends
          .filter((d) => financialYearOfIso(d.paymentDate) === fy - 1)
          .map((d) => d.netAmountCents),
      ),
      allTimeCents: sumCents(input.dividends.map((d) => d.netAmountCents)),
      rolling12Cents: sumCents(rolling12.map((m) => m.totalCents)),
      reinvestedThisFyCents: sumCents(
        input.dividends
          .filter((d) => inThisFy(d) && d.reinvested === true)
          .map((d) => d.netAmountCents),
      ),
      daysIntoFy,
      projectedFyCents: centsOf(dollarsOf(thisFyCents).div(daysIntoFy).times(PROJECTION_DAYS)),
    },
  };
}
