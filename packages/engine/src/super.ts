// Super (stage-4.md §2.5; D69–D71, D75; spec 04 §2.3): the per-fund balance log with transfers in,
// member contributions read by type (net-pay cost for the savings rate, what the fund receives for
// the gains, the pre-tax amount for the cap), employer SG per month earned (statutory rate by FY or
// the employer's rate, statement overrides), derived gains per snapshot period (a month whose
// balance was not updated merges into the next; the provisional one is measured to the latest
// balances, D79), the chained Modified Dietz return, the concessional cap meter (SG counted when the
// fund receives it) and the chart.
import {
  financialYearOfIso,
  isoMonthOf,
  PAYDAY_SUPER_START,
  SG_QUARTER_DUE_DAYS,
  SUPER_CAP_WARNING_RATIO,
  SUPER_CONCESSIONAL_CAPS,
  SUPER_FLAGS,
  SUPER_SG_RATES,
  type IsoDate,
  type IsoMonth,
  type SuperCapStatus,
  type SuperFlag,
} from '@joinr/schema';
import {
  annualise,
  byAsOf,
  centsDec,
  compareIso,
  daysInMonth,
  firstOfMonth,
  groupChart,
  lastOfMonth,
  latestAtAsOf,
  latestOnOrBefore,
  monthAfter,
  monthDaysInWindow,
  orderedFlags,
  roundCents,
  sumOrNull,
} from './assetsCommon';
import {
  addDaysIso,
  checkCents,
  dayNumber,
  daysBetween,
  dec,
  decN,
  ONE,
  ratioString,
  sumCents,
  ZERO,
  type Dec,
} from './num';
import { periodWindows, sortByRunDate } from './periods';
import type {
  Cents,
  EngineSuperContribution,
  EngineSuperFund,
  SuperCapYear,
  SuperChartPoint,
  SuperContributionResult,
  SuperFlows,
  SuperFundResult,
  SuperInput,
  SuperPeriod,
  SuperResult,
  SuperSgMonth,
} from './types';

/** A statutory table by FY start year; an FY outside it uses its nearest entry (§3.2). */
function tableValue<T>(table: Readonly<Record<number, T>>, fy: number): T {
  if (Object.hasOwn(table, fy)) return table[fy]!;
  const years = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  const nearest = fy < years[0]! ? years[0]! : years[years.length - 1]!;
  return table[nearest]!;
}

/** A member contribution read through §2.5 step 2 (rounded per row). */
interface ContributionCalc {
  c: EngineSuperContribution;
  day: number;
  estimate: boolean;
  concessional: boolean;
  preTaxCents: Cents | null;
  fundReceivesCents: Cents;
  netPayCostCents: Cents | null;
}

/** A balance entry of any fund with its day number. */
interface EntryCalc {
  fundId: number;
  id: number;
  asOf: IsoDate;
  day: number;
  balanceCents: Cents;
  transferInCents: Cents | null;
}

/**
 * When the fund receives a month's SG, for the cap (§2.5 step 7, D75): before Payday Super the
 * quarter's due date (28 days after the quarter ends); from PAYDAY_SUPER_START the month earned.
 */
export function capTiming(month: IsoMonth): { fy: number; receivedOn: IsoDate; payday: boolean } {
  const first = firstOfMonth(month);
  if (first >= PAYDAY_SUPER_START) {
    return { fy: financialYearOfIso(first), receivedOn: first, payday: true };
  }
  const quarterEndMonth = Math.ceil(Number(month.slice(5, 7)) / 3) * 3;
  const quarterEnd = lastOfMonth(
    `${month.slice(0, 4)}-${String(quarterEndMonth).padStart(2, '0')}`,
  );
  const due = addDaysIso(quarterEnd, SG_QUARTER_DUE_DAYS);
  return { fy: financialYearOfIso(due), receivedOn: due, payday: false };
}

/** The months (in order) whose SG the cap of FY `fy` counts (§2.5 step 7). */
function capMonthsOf(fy: number): IsoMonth[] {
  const out: IsoMonth[] = [];
  for (let month: IsoMonth = `${fy}-01`; month <= `${fy + 1}-06`; month = monthAfter(month)) {
    if (capTiming(month).fy === fy) out.push(month);
  }
  return out;
}

export function computeSuper(input: SuperInput): SuperResult {
  const asOf = input.asOf;
  const asOfDay = dayNumber(asOf);
  const asOfMonth = isoMonthOf(asOf);
  const ctax = dec(input.contributionsTaxRatio, 'contributionsTaxRatio');
  const toFund = ONE.minus(ctax);
  const marginal =
    input.marginalTaxRatio === null ? null : dec(input.marginalTaxRatio, 'marginalTaxRatio');
  // A marginal rate of 100 % or more cannot gross up an after-tax amount: read as missing.
  const m = marginal !== null && marginal.lessThan(ONE) ? marginal : null;
  const salary =
    input.grossAnnualSalaryCents === null
      ? null
      : checkCents(input.grossAnnualSalaryCents, 'salary');
  if (input.jobStartDate !== null) dayNumber(input.jobStartDate);
  const sgRatio = input.sgRatio === null ? null : dec(input.sgRatio, 'sgRatio');
  const flags = new Set<SuperFlag>();
  if (salary === null) flags.add('no_salary');

  // ─── Funds and their balance logs (step 1) ───
  const funds = input.funds.map((f) => ({
    fund: f,
    entries: byAsOf(f.balances).map((e) => ({
      fundId: f.id,
      id: e.id,
      asOf: e.asOf,
      day: dayNumber(e.asOf),
      balanceCents: checkCents(e.balanceCents, `balance ${e.id}`),
      transferInCents:
        e.transferInCents === null
          ? null
          : checkCents(e.transferInCents, `balance ${e.id} transferIn`),
    })),
  }));
  const allEntries: EntryCalc[] = funds.flatMap((f) => f.entries);
  const sgFund: EngineSuperFund | null =
    input.funds.find((f) => f.receivesSg && !f.archived) ?? null;
  const totalCents = sumCents(
    funds
      .filter((f) => !f.fund.archived)
      .map((f) => latestAtAsOf(f.entries, asOf)?.balanceCents ?? 0),
  );

  // ─── Contributions (step 2, D71) ───
  const contributions: ContributionCalc[] = input.contributions.map((c) => {
    const amount = checkCents(c.amountCents, `contribution ${c.id}`);
    const day = dayNumber(c.date);
    const untyped = c.kind === 'voluntary_contribution';
    if (untyped) flags.add('imported_estimates');
    const reading = untyped ? input.importedContributionType : c.kind;
    const base = { c, day, estimate: untyped };
    if (reading !== 'salary_sacrifice') {
      return {
        ...base,
        concessional: false,
        preTaxCents: null,
        fundReceivesCents: amount,
        netPayCostCents: amount,
      };
    }
    if (m === null) flags.add('no_marginal_rate');
    const a = centsDec(amount, `contribution ${c.id}`);
    if (untyped) {
      // Imported take-home amounts grossed up at the marginal rate; the net-pay cost stays as imported.
      const preTax = m === null ? a : a.div(ONE.minus(m));
      return {
        ...base,
        concessional: true,
        preTaxCents: roundCents(preTax),
        fundReceivesCents: roundCents(preTax.times(toFund)),
        netPayCostCents: amount,
      };
    }
    return {
      ...base,
      concessional: true,
      preTaxCents: amount,
      fundReceivesCents: roundCents(a.times(toFund)),
      netPayCostCents: m === null ? null : roundCents(a.times(ONE.minus(m))),
    };
  });
  const inWindow = (day: number, after: IsoDate, through: IsoDate): boolean =>
    day > dayNumber(after) && day <= dayNumber(through) && day <= asOfDay;

  // ─── Employer SG per month earned (step 3) ───
  const statements = new Map<IsoMonth, Cents>();
  for (const o of input.sgOverrides) {
    dayNumber(firstOfMonth(o.periodMonth));
    statements.set(
      o.periodMonth,
      (statements.get(o.periodMonth) ?? 0) + checkCents(o.grossCents, 'sg'),
    );
  }
  const sgCache = new Map<IsoMonth, { source: SuperSgMonth['source']; grossCents: Cents }>();
  const sgOf = (month: IsoMonth): { source: SuperSgMonth['source']; grossCents: Cents } => {
    const hit = sgCache.get(month);
    if (hit !== undefined) return hit;
    let out: { source: SuperSgMonth['source']; grossCents: Cents };
    const statement = statements.get(month);
    if (statement !== undefined) out = { source: 'statement', grossCents: statement };
    else if (
      salary === null ||
      (input.jobStartDate !== null && input.jobStartDate > lastOfMonth(month))
    )
      out = { source: 'none', grossCents: 0 };
    else {
      const rate =
        sgRatio ??
        dec(tableValue(SUPER_SG_RATES, financialYearOfIso(firstOfMonth(month))), 'SG rate');
      out = { source: 'estimate', grossCents: roundCents(decN(salary).times(rate).div(12)) };
    }
    sgCache.set(month, out);
    return out;
  };
  /** SG gross earned in (after, through], each month's figure spread by its days; after asOf excluded. */
  const sgGrossBetween = (after: IsoDate, through: IsoDate): Dec => {
    const end = through < asOf ? through : asOf;
    if (end <= after) return ZERO;
    let total = ZERO;
    for (
      let month = isoMonthOf(addDaysIso(after, 1));
      month <= isoMonthOf(end);
      month = monthAfter(month)
    ) {
      const gross = sgOf(month).grossCents;
      const days = monthDaysInWindow(month, after, end);
      if (gross !== 0 && days > 0)
        total = total.plus(decN(gross).times(days).div(daysInMonth(month)));
    }
    return total;
  };

  // ─── Window flows (step 4) ───
  /**
   * SG and contributions over (after, through]; transfers in over (transfersAfter,
   * transfersThrough] (by default the same window).
   */
  const flowsOver = (
    after: IsoDate,
    through: IsoDate,
    transfersThrough: IsoDate = through,
    transfersAfter: IsoDate = after,
  ): { flows: SuperFlows; sgFund: Dec } => {
    const sgGross = sgGrossBetween(after, through);
    const sgFundDec = sgGross.times(toFund);
    const cs = contributions.filter((c) => inWindow(c.day, after, through));
    const transfers = allEntries.filter((e) => inWindow(e.day, transfersAfter, transfersThrough));
    return {
      flows: {
        sgGrossCents: roundCents(sgGross),
        sgFundCents: roundCents(sgFundDec),
        memberFundCents: sumCents(cs.map((c) => c.fundReceivesCents)),
        memberNetPayCents: sumCents(cs.map((c) => c.netPayCostCents ?? 0)),
        concessionalCents: sumCents(cs.map((c) => (c.concessional ? c.preTaxCents! : 0))),
        nonConcessionalCents: sumCents(cs.map((c) => (c.concessional ? 0 : c.c.amountCents))),
        transferInCents: sumCents(transfers.map((e) => e.transferInCents ?? 0)),
      },
      sgFund: sgFundDec,
    };
  };

  // ─── Periods: gains over merged windows (step 4) ───
  // D79: the provisional gain is measured only up to the latest balances, the oldest latest balance
  // (on or before asOf) among the funds not archived. The stale rule below puts it inside
  // (lastRun, asOf] whenever the provisional period is a valuation point. SG and contributions after
  // it wait for the next update (the window's `flows`, the savings side, still run to asOf).
  const latestBalanceDates = funds
    .filter((f) => !f.fund.archived)
    .map((f) => latestOnOrBefore(f.entries, asOf)?.asOf)
    .filter((d): d is IsoDate => d !== undefined)
    .sort(compareIso);
  const balancesThrough: IsoDate = latestBalanceDates[0] ?? asOf;
  const windows = periodWindows(input.snapshots, asOf, true);
  const periods: SuperPeriod[] = [];
  const returns: (Dec | null)[] = [];
  /**
   * Each period's measured end: its run date, or for a valuation point its effective
   * measured-through date; the provisional valuation's balancesThrough.
   */
  const measuredTo: IsoDate[] = [];
  /**
   * The previous valuation point: its run date (the transfers' window), its value and its effective
   * measured-through date (stage-5.md §2.11, D88a: the gain's SG and contributions window starts
   * there).
   */
  let lastValuation: { date: IsoDate; value: Cents; measured: IsoDate } | null = null;
  /**
   * §2.11: m' = min(run, max(m ?? run, the previous valuation point's m')), so the measured dates
   * never go backwards (no SG counted twice) and never pass the run date.
   */
  const effectiveMeasured = (
    runDate: IsoDate,
    measured: IsoDate | null | undefined,
    previous: IsoDate | null,
  ): IsoDate => {
    let m = measured ?? runDate;
    dayNumber(m);
    if (previous !== null && previous > m) m = previous;
    return m < runDate ? m : runDate;
  };
  windows.forEach((w, i) => {
    const value =
      w.snapshot === null
        ? totalCents
        : w.snapshot.superValueCents === null
          ? null
          : checkCents(w.snapshot.superValueCents, `snapshot ${w.runDate} super`);
    const base = {
      periodMonth: w.periodMonth,
      runDate: w.runDate,
      after: w.after,
      through: w.through,
      status: w.status,
      valueCents: value,
    };
    const none = {
      gainFrom: null,
      changeCents: null,
      gainFlows: null,
      gainCents: null,
      gainRatio: null,
      returnRatio: null,
    };
    measuredTo.push(w.through);
    /** This snapshot's effective measured-through date as a valuation point (§2.11). */
    const measuredHere = (): IsoDate =>
      effectiveMeasured(w.runDate, w.snapshot?.measuredThrough, lastValuation?.measured ?? null);
    if (w.status === 'first' || w.after === null) {
      periods.push({ ...base, notUpdated: false, flows: null, ...none });
      returns.push(null);
      if (value !== null) {
        const measured = measuredHere();
        measuredTo[i] = measured;
        lastValuation = { date: w.through, value, measured };
      }
      return;
    }
    const previous = periods[i - 1]!.valueCents;
    let notUpdated: boolean;
    if (w.status === 'provisional') {
      const stale = funds.some(
        (f) =>
          !f.fund.archived &&
          !f.entries.some((e) => e.day > dayNumber(w.after!) && e.day <= asOfDay),
      );
      notUpdated = (previous !== null && value === previous) || stale;
      if (notUpdated) flags.add('balances_not_updated');
    } else {
      notUpdated = value === null || value === previous;
    }
    const { flows } = flowsOver(w.after, w.through);
    const from: { date: IsoDate; value: Cents; measured: IsoDate } | null = lastValuation;
    if (notUpdated || value === null || from === null) {
      periods.push({ ...base, notUpdated, flows, ...none });
      returns.push(null);
      if (!notUpdated && value !== null) {
        const measured = measuredHere();
        measuredTo[i] = measured;
        lastValuation = { date: w.through, value, measured };
      }
      return;
    }
    // D69: the gain over (gainFrom, through] = change − SG to the fund − yours to the fund − transfers.
    // D79: the provisional gain counts SG and contributions only to balancesThrough; every transfer
    // in to asOf sits on a balance entry the value already holds, so it still counts.
    // D88a (stage-5.md §2.11): SG and contributions run between the effective measured-through
    // dates, so those after a month's measured balance date carry into the next month's gain;
    // transfers in keep the run-date window. Null measured dates are the run dates (Stage 4).
    const measured =
      w.status === 'provisional'
        ? effectiveMeasured(asOf, balancesThrough, from.measured)
        : measuredHere();
    measuredTo[i] = measured;
    const g = flowsOver(from.measured, measured, w.through, from.date);
    const changeCents = value - from.value;
    const gainCents =
      changeCents - g.flows.sgFundCents - g.flows.memberFundCents - g.flows.transferInCents;
    const member = decN(g.flows.memberFundCents + g.flows.transferInCents);
    const gain = decN(changeCents).minus(g.sgFund).minus(member);
    const tDen = decN(value).minus(gain);
    const mdDen = decN(from.value).plus(g.sgFund.plus(member).div(2));
    const ret = mdDen.greaterThan(0) ? gain.div(mdDen) : null;
    periods.push({
      ...base,
      notUpdated: false,
      flows,
      gainFrom: from.date,
      changeCents,
      gainFlows: g.flows,
      gainCents,
      gainRatio: tDen.greaterThan(0) ? ratioString(gain.div(tDen)) : null,
      returnRatio: ret === null ? null : ratioString(ret),
    });
    returns.push(ret);
    lastValuation = { date: w.through, value, measured };
  });

  // ─── The annualised return: the chained Modified Dietz periods (step 5, §11 fix 21) ───
  const chained = periods
    .map((p, i) => ({ p, r: returns[i]!, end: measuredTo[i]! }))
    .filter((x) => x.r !== null);
  const firstRun = sortByRunDate(input.snapshots)[0]?.runDate ?? null;
  let annualised: SuperResult['annualised'] = {
    cumulativeRatio: null,
    returnRatio: null,
    from: null,
    through: null,
    days: null,
  };
  if (chained.length > 0 && firstRun !== null) {
    const growth = chained.reduce((acc, x) => acc.times(ONE.plus(x.r)), ONE);
    // The last chained period's measured end (the provisional one: its latest balances, D79).
    const through = chained[chained.length - 1]!.end;
    const days = daysBetween(firstRun, through);
    const yearly = days >= 1 ? annualise(growth, days) : null;
    annualised = {
      cumulativeRatio: ratioString(growth.minus(ONE)),
      returnRatio: yearly === null ? null : ratioString(yearly),
      from: firstRun,
      through,
      days,
    };
  }

  // ─── SG months (step 3): from the first month the previous FY's cap counts to asOf's month ───
  const fyNow = financialYearOfIso(asOf);
  const sgMonths: SuperSgMonth[] = [];
  const firstSgMonth = capMonthsOf(fyNow - 1)[0] ?? asOfMonth;
  for (let month = firstSgMonth; month <= asOfMonth; month = monthAfter(month)) {
    const sg = sgOf(month);
    sgMonths.push({
      month,
      source: sg.source,
      grossCents: sg.grossCents,
      fundReceivesCents: roundCents(decN(sg.grossCents).times(toFund)),
      fundId: sgFund?.id ?? null,
      capFinancialYear: capTiming(month).fy,
    });
  }
  if (sgFund === null && sgMonths.some((s) => s.grossCents > 0)) flags.add('no_sg_fund');

  // ─── The concessional cap meter (step 7, D70, D75) ───
  const override = input.concessionalCapOverride;
  const capYears: SuperCapYear[] = [fyNow, fyNow - 1].map((fy) => {
    const start = `${fy}-07-01`;
    const end = `${fy + 1}-07-01`;
    const complete = asOf >= end;
    const useOverride = override !== null && override.financialYear === fy && override.cents > 0;
    const capCents = useOverride
      ? checkCents(override.cents, 'cap')
      : tableValue(SUPER_CONCESSIONAL_CAPS, fy);
    let sgGrossCents = 0;
    let sgFundCents = 0;
    let sgAll = 0;
    const sources = new Set<SuperSgMonth['source']>();
    for (const month of capMonthsOf(fy)) {
      const sg = sgOf(month);
      sgAll += sg.grossCents;
      const timing = capTiming(month);
      let counted: Dec | null = null;
      if (!timing.payday) counted = timing.receivedOn <= asOf ? decN(sg.grossCents) : null;
      else if (month < asOfMonth) counted = decN(sg.grossCents);
      else if (month === asOfMonth)
        counted = decN(sg.grossCents)
          .times(Number(asOf.slice(8, 10)))
          .div(daysInMonth(month));
      if (counted === null) continue;
      sgGrossCents += roundCents(counted);
      sgFundCents += roundCents(counted.times(toFund));
      if (sg.source !== 'none') sources.add(sg.source);
    }
    const inFy = contributions.filter(
      (c) => c.c.date >= start && c.c.date < end && c.day <= asOfDay,
    );
    const salarySacrificeCents = sumCents(
      inFy.filter((c) => c.concessional && !c.estimate).map((c) => c.preTaxCents!),
    );
    const importedEstimateCents = sumCents(
      inFy.filter((c) => c.concessional && c.estimate).map((c) => c.preTaxCents!),
    );
    const totalCentsFy = sgGrossCents + salarySacrificeCents + importedEstimateCents;
    let projectedCents = totalCentsFy;
    if (!complete) {
      const elapsed = Math.min(
        12,
        Math.max(1, (Number(asOf.slice(0, 4)) - fy) * 12 + Number(asOf.slice(5, 7)) - 6),
      );
      const soFar = salarySacrificeCents + importedEstimateCents;
      projectedCents = roundCents(
        decN(sgAll + soFar).plus(
          decN(soFar)
            .div(elapsed)
            .times(12 - elapsed),
        ),
      );
    }
    const cap = decN(capCents);
    const status: SuperCapStatus =
      totalCentsFy > capCents || projectedCents > capCents
        ? 'over'
        : decN(projectedCents).greaterThanOrEqualTo(cap.times(SUPER_CAP_WARNING_RATIO))
          ? 'near'
          : 'under';
    const sourceList = [...sources];
    return {
      financialYear: fy,
      start,
      end,
      complete,
      capCents,
      capSource: useOverride ? 'setting' : 'statutory',
      sgGrossCents,
      sgFundCents,
      sgSource: sourceList.length === 0 ? 'none' : sourceList.length > 1 ? 'mixed' : sourceList[0]!,
      salarySacrificeCents,
      importedEstimateCents,
      totalCents: totalCentsFy,
      projectedCents,
      ratio: ratioString(decN(totalCentsFy).div(cap)),
      projectedRatio: ratioString(decN(projectedCents).div(cap)),
      status,
      nonConcessionalCents: sumCents(
        inFy.filter((c) => !c.concessional).map((c) => c.c.amountCents),
      ),
      memberCents: sumCents(inFy.map((c) => (c.concessional ? c.preTaxCents! : c.c.amountCents))),
      memberFundCents: sumCents(inFy.map((c) => c.fundReceivesCents)),
      memberNetPayCents: sumCents(inFy.map((c) => c.netPayCostCents ?? 0)),
      estimateCount: inFy.filter((c) => c.estimate).length,
    };
  });

  // ─── Funds (step 6): per entry the flows since the previous entry and the gain ───
  const fundResults: SuperFundResult[] = funds.map(({ fund, entries }) => {
    const latest = latestAtAsOf(entries, asOf);
    const receives = sgFund !== null && fund.id === sgFund.id;
    return {
      id: fund.id,
      receivesSg: fund.receivesSg,
      archived: fund.archived,
      balanceCents: latest?.balanceCents ?? null,
      balanceAsOf: latest?.asOf ?? null,
      entries: entries.map((e, k) => {
        const row = {
          id: e.id,
          asOf: e.asOf,
          balanceCents: e.balanceCents,
          transferInCents: e.transferInCents,
        };
        if (k === 0) return { ...row, flowsCents: null, gainCents: null };
        const prev = entries[k - 1]!;
        const sgPart = receives ? roundCents(sgGrossBetween(prev.asOf, e.asOf).times(toFund)) : 0;
        const own = contributions.filter(
          (c) =>
            inWindow(c.day, prev.asOf, e.asOf) &&
            (c.c.fundId === fund.id || (c.c.fundId === null && receives)),
        );
        const flowsCents =
          sgPart + sumCents(own.map((c) => c.fundReceivesCents)) + (e.transferInCents ?? 0);
        return { ...row, flowsCents, gainCents: e.balanceCents - prev.balanceCents - flowsCents };
      }),
    };
  });

  // ─── Snapshot (step 8): the live History Q–T ───
  const lastRun = windows.filter((w) => w.status !== 'provisional').at(-1)?.runDate ?? null;
  const provisional = periods.find((p) => p.status === 'provisional') ?? null;
  const superContribCents = sumCents(
    contributions
      .filter((c) => c.day <= asOfDay && (lastRun === null || c.day > dayNumber(lastRun)))
      .map((c) => c.netPayCostCents ?? 0),
  );

  // ─── Chart (step 9) ───
  const points = periods.map((p, i) => ({
    period: p.periodMonth,
    date: p.runDate,
    live: p.status === 'provisional',
    source: p,
    ret: returns[i]!,
  }));
  const chart: SuperChartPoint[] = groupChart(points, input.chart.unit, input.chart.count).map(
    (g) => {
      const rs = g.points.map((x) => x.ret).filter((r): r is Dec => r !== null);
      const chainedGroup =
        rs.length === 0 ? null : rs.reduce((acc, r) => acc.times(ONE.plus(r)), ONE).minus(ONE);
      return {
        label: g.label,
        period: g.last.period,
        date: g.last.date,
        live: g.last.live,
        valueCents: g.last.source.valueCents,
        gainCents: sumOrNull(g.points.map((x) => x.source.gainCents)),
        returnRatio: chainedGroup === null ? null : ratioString(chainedGroup),
        memberNetPayCents: sumOrNull(
          g.points.map((x) => x.source.flows?.memberNetPayCents ?? null),
        ),
        memberFundCents: sumOrNull(g.points.map((x) => x.source.flows?.memberFundCents ?? null)),
        sgFundCents: sumOrNull(g.points.map((x) => x.source.flows?.sgFundCents ?? null)),
      };
    },
  );

  const contributionResults: SuperContributionResult[] = [...contributions]
    .sort((a, b) => compareIso(b.c.date, a.c.date) || b.c.id - a.c.id)
    .map((c) => ({
      id: c.c.id,
      fundId: c.c.fundId,
      date: c.c.date,
      kind: c.c.kind,
      amountCents: c.c.amountCents,
      estimate: c.estimate,
      preTaxCents: c.preTaxCents,
      fundReceivesCents: c.fundReceivesCents,
      netPayCostCents: c.netPayCostCents,
      concessional: c.concessional,
    }));

  return {
    totalCents,
    funds: fundResults,
    contributions: contributionResults,
    sgMonths,
    periods,
    annualised,
    capYears,
    chart,
    snapshot: {
      superValueCents: totalCents,
      superContribCents,
      superGainCents: provisional?.gainCents ?? null,
      superGainRatio: provisional?.gainRatio ?? null,
    },
    flags: orderedFlags(SUPER_FLAGS, flags),
    // D88a: the provisional period's D79 cut-off, stored with a recorded month (stage-5.md §2.11).
    measuredThrough: provisional !== null && latestBalanceDates.length > 0 ? balancesThrough : null,
  };
}
