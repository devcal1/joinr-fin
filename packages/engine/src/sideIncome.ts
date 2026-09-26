// Side income (stage-3.md §2.8, D57; §11 fixes 5, 6): dated deposits bucketed into the snapshot
// periods (the first is the calendar month of the first run up to that run; a later period starts
// the day after the previous run; the provisional period runs to asOf), with the FY figures
// (always FY-based, D52) and the 365-day average the Budget adds (D53).
import type { IsoDate } from '@joinr/schema';
import { addDaysIso, centsOf, checkCents, dayNumber, dollarsOf, mean, sumCents } from './num';
import { dayAfter, inYear, monthStart, periodIndexOf, periodWindows, yearWindow } from './periods';
import type { SideIncomeInput, SideIncomePeriodResult, SideIncomeResult } from './types';

const DAYS_PER_YEAR = 365;

export function computeSideIncome(input: SideIncomeInput): SideIncomeResult {
  const asOfDay = dayNumber(input.asOf);
  // Every snapshot period is a closed side-income period; the provisional one needs no live input.
  const windows = periodWindows(input.snapshots, input.asOf, true);
  const first = windows[0];
  const firstStartDay = first === undefined ? Infinity : dayNumber(monthStart(first.runDate));

  const inPeriod: { id: number; streamId: number; date: IsoDate; amountCents: number }[][] =
    windows.map(() => []);
  let beforeFirstCents = 0;
  let afterAsOfCents = 0;
  for (const d of input.deposits) {
    const amount = checkCents(d.amountCents, `deposit ${d.id}`);
    const day = dayNumber(d.date);
    if (day > asOfDay) {
      afterAsOfCents += amount;
      continue;
    }
    const i = periodIndexOf(day, windows, asOfDay, firstStartDay);
    if (i < 0) beforeFirstCents += amount;
    else inPeriod[i]!.push(d);
  }

  const periods: SideIncomePeriodResult[] = windows.map((w, i) => {
    const deposits = [...inPeriod[i]!].sort(
      (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.id - b.id,
    );
    const byStream = new Map<number, number>();
    for (const d of deposits)
      byStream.set(d.streamId, (byStream.get(d.streamId) ?? 0) + d.amountCents);
    return {
      periodMonth: w.periodMonth,
      start: i === 0 ? monthStart(w.runDate) : dayAfter(w.after!),
      end: w.through,
      status: w.status === 'provisional' ? 'provisional' : 'closed',
      totalCents: sumCents(deposits.map((d) => d.amountCents)),
      byStream: [...byStream.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([streamId, amountCents]) => ({ streamId, amountCents })),
      depositIds: deposits.map((d) => d.id),
    };
  });

  const fy = yearWindow(input.asOf, 'fy');
  const closed = periods.filter((p) => p.status === 'closed');
  // C3 fixed: closed periods whose start is in the FY (the unfilled current period is left out).
  const thisFy = closed.filter((p) => inYear(p.start, fy));
  const avgThisFy = mean(thisFy.map((p) => dollarsOf(p.totalCents)));
  // C6 fixed: closed periods that start in the 365 days before asOf.
  const cutoff = addDaysIso(input.asOf, -DAYS_PER_YEAR);
  const last365 = closed.filter((p) => p.start > cutoff);
  const avg365 = mean(last365.map((p) => dollarsOf(p.totalCents)));

  const byStreamLifetime = new Map<number, number>();
  for (const d of input.deposits) {
    byStreamLifetime.set(d.streamId, (byStreamLifetime.get(d.streamId) ?? 0) + d.amountCents);
  }
  return {
    periods,
    beforeFirstCents,
    afterAsOfCents,
    fy: { financialYear: fy.year, start: fy.start, end: fy.end },
    avgPerPeriodThisFyCents: avgThisFy === null ? null : centsOf(avgThisFy),
    periodsThisFy: thisFy.length,
    // C4 fixed: deposits dated in the FY and on or before asOf (provisional ones included).
    fyToDateCents: sumCents(
      input.deposits
        .filter((d) => inYear(d.date, fy) && d.date <= input.asOf)
        .map((d) => d.amountCents),
    ),
    projectedYearCents: avgThisFy === null ? null : centsOf(avgThisFy.times(12)),
    avg365Cents: avg365 === null ? null : centsOf(avg365),
    periods365: last365.length,
    lifetimeCents: sumCents(input.deposits.map((d) => d.amountCents)),
    byStreamLifetime: [...byStreamLifetime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([streamId, amountCents]) => ({ streamId, amountCents })),
  };
}
