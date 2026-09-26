// The cash-flow fixtures (stage-3.md §3.6) are internally consistent (sums, orders, windows,
// statuses), parse where a schema exists and cover every state the pages render.
import { describe, expect, it } from 'vitest';
import {
  addMonthsIso,
  API_ERROR_CODES,
  CASH_ACCOUNT_KINDS,
  DecimalStringSchema,
  DIVIDEND_SUGGESTION_STATUSES,
  DRP_ADVICE,
  EDITABLE_SETTING_KEYS,
  financialYearOfIso,
  INSTRUMENT_KINDS,
  isApiErrorBody,
  isEditableSettingKey,
  isIsoDateString,
  isIsoMonthString,
  isIsoTimestampString,
  KPI_TRENDS,
  makeCashBalancesInputSchema,
  makeDepositInputSchema,
  makeDividendInputSchema,
  savingsGoalInputSchema,
  SAVINGS_PERIOD_STATUSES,
  settingsPatchSchema,
  settingValueSchema,
  YEAR_BASES,
  type BudgetPageResponse,
  type CashPageResponse,
  type DividendsPageResponse,
  type SettingsSliceDto,
  type SideIncomePageResponse,
} from '../src/index';
import * as f from '../src/fixtures/index';

const sum = (xs: readonly (number | null)[]): number =>
  xs.reduce<number>((a, x) => a + (x ?? 0), 0);
/** |a − b/c| within the 12-significant-digit ratio rounding. */
const ratioOf = (r: string | null, num: number, den: number) =>
  r !== null && Math.abs(Number(r) - num / den) <= 1e-11 * Math.max(1, Math.abs(num / den));
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const now = () => new Date(2026, 8, 24, 14, 32);

/** The Cash page's six Stage 3 keys (stage-4.md §3.2: the Stage 4 keys come after them). */
const CASH_KEYS = EDITABLE_SETTING_KEYS.slice(9, 15);
const BUDGET_KEYS = EDITABLE_SETTING_KEYS.slice(0, 9);

function checkSlice(slice: SettingsSliceDto, keys: readonly string[]) {
  expect(Object.keys(slice.values).sort()).toEqual([...keys].sort());
  expect(Object.keys(slice.origins).sort()).toEqual([...keys].sort());
  for (const [key, value] of Object.entries(slice.values)) {
    if (!isEditableSettingKey(key)) throw new Error(key);
    if (value === null) continue;
    expect(settingValueSchema(key).safeParse(value).success, key).toBe(true);
    expect(slice.origins[key], key).not.toBeNull();
  }
}

/** Every field whose name says what it holds is well formed (a schema-free fixture parse). */
function checkShapes(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkShapes(v, `${path}[${i}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const at = `${path}.${k}`;
    // Setting keys (`goals.cashSavingsTargetCents`) are checked by checkSlice instead.
    if (k.includes('.')) continue;
    if (v !== null && typeof v !== 'object') {
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      if (/Cents$/.test(k)) expect(Number.isSafeInteger(v), at).toBe(true);
      if (/Ratio$|^trendPerMonth$|^amountPerUnit$|^priceAtEx$|^unitsAtEx$/.test(k)) {
        expect(DecimalStringSchema.safeParse(v).success, `${at} = ${text}`).toBe(true);
      }
      if (
        /^(asOf|runDate|through|after|start|end|date|paymentDate|exDate|eta|arrival|targetDate|expectedPaymentDate|fyStart|fyEnd|balanceAsOf|from|anchor|lastRun)$/.test(
          k,
        )
      ) {
        expect(isIsoDateString(text), `${at} = ${text}`).toBe(true);
      }
      if (/^(periodMonth|period|month)$/.test(k)) expect(isIsoMonthString(text), at).toBe(true);
      if (/^(generatedAt|lastRefreshAt|nextRefreshAt)$/.test(k)) {
        expect(isIsoTimestampString(text), at).toBe(true);
      }
    }
    checkShapes(v, at);
  }
}

describe('coverage', () => {
  it('covers every account kind, period status, year basis, trend, suggestion status and advice', () => {
    expect(new Set(f.FIXTURE_COVERAGE.cashAccountKinds)).toEqual(new Set(CASH_ACCOUNT_KINDS));
    expect(new Set(f.FIXTURE_COVERAGE.savingsPeriodStatuses)).toEqual(
      new Set(SAVINGS_PERIOD_STATUSES),
    );
    expect(new Set(f.FIXTURE_COVERAGE.yearBases)).toEqual(new Set(YEAR_BASES));
    expect(new Set(f.FIXTURE_COVERAGE.kpiTrends)).toEqual(new Set(KPI_TRENDS));
    expect(new Set(f.FIXTURE_COVERAGE.suggestionStatuses)).toEqual(
      new Set(DIVIDEND_SUGGESTION_STATUSES),
    );
    expect(new Set(f.FIXTURE_COVERAGE.drpAdvice)).toEqual(new Set(DRP_ADVICE));
  });

  it('has the named states of stage-3.md §3.6', () => {
    expect(Object.keys(f.cashPages)).toEqual([
      'populated',
      'empty',
      'noSnapshots',
      'emergencyShort',
      'goalStates',
      'noGoals',
      'earlyYear',
      'missingSettings',
    ]);
    expect(Object.keys(f.sideIncomePages)).toEqual(['populated', 'empty', 'noSnapshots']);
    expect(Object.keys(f.budgetPages)).toEqual([
      'autoSplit',
      'manualSplit',
      'manualOverLeftover',
      'belowEmergencyFund',
      'missingPay',
      'unmatchedAccounts',
      'negativeActual',
    ]);
    expect(Object.keys(f.dividendsPages)).toEqual([
      'populated',
      'suggestions',
      'checkedNoneFound',
      'checkFailed',
      'empty',
      'marketOff',
      'fakeMode',
    ]);
  });

  it('has well-formed fields everywhere', () => {
    checkShapes({ ...f.cashPages, ...f.sideIncomePages, ...f.budgetPages, ...f.dividendsPages });
    checkShapes([
      f.cashAccountMutationResponse,
      f.balancesResponse,
      f.depositMutationResponse,
      f.budgetItemMutationResponse,
      f.dividendMutationResponse,
      f.settingsPatchResponse,
    ]);
  });

  it('has the Stage 3 error bodies with known codes', () => {
    for (const key of [
      'accountInUse',
      'streamInUse',
      'lastBalanceEntry',
      'cashValidation',
      'dividendValidation',
    ] as const) {
      const body = f.apiErrors[key];
      expect(isApiErrorBody(body)).toBe(true);
      expect(API_ERROR_CODES).toContain(body.error.code);
    }
  });
});

describe.each(Object.entries(f.cashPages))('cash page %s', (_name, page: CashPageResponse) => {
  const t = page.totals;

  it('lists accounts by kind, offsets last, each with its latest balance entry', () => {
    const order = page.accounts.map(
      (a) => [Number(a.isOffset), CASH_ACCOUNT_KINDS.indexOf(a.kind), a.sortOrder] as const,
    );
    expect(order).toEqual([...order].sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]));
    const asOfs = page.entries.map((e) => e.asOf);
    expect(asOfs).toEqual([...asOfs].sort().reverse());
    for (const a of page.accounts) {
      const own = page.entries.filter((e) => e.accountId === a.id);
      expect(own.length, a.name).toBe(a.entryCount);
      const latest = own[0]!;
      expect([latest.asOf, latest.balanceCents], a.name).toEqual([a.balanceAsOf, a.balanceCents]);
      expect(a.inTotalCash).toBe(!a.isOffset);
      expect(a.countsForEmergencyFund, a.name).toBe(
        a.isOffset ? t.emergencyFund.offsetsIncluded : a.kind !== 'loan_receivable',
      );
    }
  });

  it('adds up the totals (D49, D56, D59)', () => {
    const inTotal = page.accounts.filter((a) => !a.isOffset);
    expect(t.totalCashCents).toBe(sum(inTotal.map((a) => a.balanceCents)));
    for (const kind of CASH_ACCOUNT_KINDS) {
      expect(t.byKind[kind]).toBe(
        sum(inTotal.filter((a) => a.kind === kind).map((a) => a.balanceCents)),
      );
    }
    expect(t.offsetCents).toBe(
      sum(page.accounts.filter((a) => a.isOffset).map((a) => a.balanceCents)),
    );
    expect(t.loansCents).toBe(t.byKind.loan_receivable);
    expect(t.availableCashCents).toBe(t.totalCashCents - t.loansCents);
    expect(t.emergencyFund.loansIncluded).toBe(false);
    expect(t.emergencyFundTestCents).toBe(
      t.availableCashCents + (t.emergencyFund.offsetsIncluded ? t.offsetCents : 0),
    );
    const target = t.emergencyFund.targetCents;
    expect(t.emergencyFund.covered).toBe(
      target === null ? null : t.emergencyFundTestCents >= target,
    );
    expect(t.emergencyFund.shortfallCents).toBe(
      target === null ? null : Math.max(0, target - t.emergencyFundTestCents),
    );
  });

  it('has periods newest first: a baseline, closed periods and at most one provisional', () => {
    const p = page.periods;
    const runs = p.map((x) => x.runDate);
    expect(runs).toEqual([...runs].sort().reverse());
    if (p.length === 0) return;
    expect(p.at(-1)!.status).toBe('first');
    expect(p.filter((x) => x.status === 'first')).toHaveLength(1);
    expect(p.filter((x) => x.status === 'provisional').length).toBeLessThanOrEqual(1);
    if (p.some((x) => x.status === 'provisional')) {
      expect(p[0]).toMatchObject({ status: 'provisional', runDate: page.asOf, spendNote: null });
      expect(p[0]!.cashCents).toBe(t.totalCashCents);
      expect(p[0]!.adjustment).toBeNull();
    }
    expect(page.lastRun).toBe(p.find((x) => x.status !== 'provisional')!.runDate);
    for (let i = 0; i < p.length - 1; i++) expect(p[i]!.after).toBe(p[i + 1]!.runDate);
    expect(p.at(-1)).toMatchObject({ after: null, cashGainCents: null, added: null, income: null });
  });

  it('computes each period the §2.5 way (raw as the sheet, adjusted with D51)', () => {
    for (const x of page.periods.filter((y) => y.status !== 'first')) {
      const added = x.added!;
      const income = x.income!;
      expect(x.addedInvestmentsCents).toBe(sum(Object.values(added)));
      const rawIncome =
        (income.salaryCents ?? 0) + income.sideIncomeCents + income.cashDividendsCents;
      expect(x.raw.incomeCents).toBe(rawIncome);
      expect(x.adjusted.incomeCents).toBe(rawIncome + income.otherDividendsCents);
      expect(x.raw.savingsCents).toBe(x.cashGainCents! + x.addedInvestmentsCents!);
      expect(x.adjusted.savingsCents).toBe(x.raw.savingsCents! - (x.adjustment?.amountCents ?? 0));
      for (const fig of [x.raw, x.adjusted]) {
        expect(fig.spendCents).toBe(fig.incomeCents! - fig.savingsCents!);
        expect(ratioOf(fig.savingsRatio, fig.savingsCents!, fig.incomeCents!)).toBe(true);
      }
      if (x.adjustment) {
        expect(x.status).toBe('closed');
        expect(x.adjustment.periodMonth).toBe(x.periodMonth);
      }
    }
    const closedMonths = new Set(
      page.periods.filter((x) => x.status === 'closed').map((x) => x.periodMonth),
    );
    for (const o of page.orphanAdjustments) expect(closedMonths.has(o.periodMonth)).toBe(false);
  });

  it('has KPIs from the closed periods of the anchor year (§2.6, D59)', () => {
    const k = page.kpis;
    const closed = page.periods.filter((x) => x.status === 'closed');
    expect(k.anchor).toBe(page.lastRun);
    const around = k.anchor ?? page.asOf;
    expect(around >= k.year.start && around < k.year.end).toBe(true);
    expect(k.year.basis).toBe(page.settings.values['savings.yearBasis'] ?? 'fy');
    const inYear = closed.filter((x) => x.runDate >= k.year.start && x.runDate < k.year.end);
    expect(k.yearPeriods).toBe(inYear.length);
    expect(k.yearSavingsCents).toBe(sum(inYear.map((x) => x.adjusted.savingsCents)));
    expect(k.yearIncomeCents).toBe(sum(inYear.map((x) => x.adjusted.incomeCents)));
    expect(k.yearCashGainCents).toBe(sum(inYear.map((x) => x.cashGainCents)));
    if (k.yearIncomeCents > 0) {
      expect(ratioOf(k.yearSavingsRatio, k.yearSavingsCents, k.yearIncomeCents)).toBe(true);
    } else expect(k.yearSavingsRatio).toBeNull();
    expect(k.lastPeriod?.periodMonth ?? null).toBe(closed[0]?.periodMonth ?? null);
    expect(k.avgWindow?.periods ?? 0).toBe(
      k.avgWindow === null ? 0 : closed.filter((x) => x.runDate >= k.avgWindow!.from).length,
    );
    expect(k.predictedCashPerYearCents).toBe(
      k.avgCashGainAdjustedCents === null ? null : k.avgCashGainAdjustedCents * 12,
    );
    if (k.eoyProjectedCashCents !== null) {
      expect(k.eoyProjectedCashCents).toBe(
        k.monthsToYearEnd! * k.avgCashGainAdjustedCents! + t.availableCashCents,
      );
    }
    const target = page.settings.values['goals.cashSavingsTargetCents'];
    if (typeof target === 'number') {
      expect(k.cashTarget).not.toBeNull();
      expect(ratioOf(k.cashTarget!.progressRatio, t.availableCashCents, target)).toBe(true);
      expect(k.cashTarget!.status === 'reached').toBe(t.availableCashCents >= target);
      if (k.cashTarget!.status === 'on_track') {
        expect(k.cashTarget!.arrival).toBe(addMonthsIso(k.anchor!, k.cashTarget!.monthsToTarget!));
      }
    } else expect(k.cashTarget).toBeNull();
    if (k.trend !== null) {
      const slope = Number(k.trendPerMonth);
      expect(k.trend).toBe(slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'flat');
    }
  });

  it('fills the goals in order from available cash above the emergency fund (§2.7, D59)', () => {
    const g = page.goals;
    expect(g.cashBasis).toBe('available');
    const share = page.settings.values['goals.houseDepositInvestmentShare'];
    const invest =
      typeof share === 'string' ? Math.round(Number(share) * g.investmentsValueCents) : 0;
    expect(g.savedCents).toBe(
      Math.max(0, t.availableCashCents - (t.emergencyFund.targetCents ?? 0)) + invest,
    );
    let left = g.savedCents;
    const orders = g.items.map((x) => x.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    for (const goal of g.items) {
      expect(goal.allocatedCents).toBe(Math.min(goal.targetCents, left));
      left -= goal.allocatedCents;
      expect(goal.remainingCents).toBe(goal.targetCents - goal.allocatedCents);
      expect(goal.reached).toBe(goal.allocatedCents >= goal.targetCents);
      if (goal.reached) expect(goal.monthsToGo).toBeNull();
      if (goal.targetDate === null) expect(goal.onTrack).toBeNull();
      if (goal.eta !== null)
        expect(goal.eta).toBe(addMonthsIso(page.kpis.anchor ?? page.asOf, goal.monthsToGo!));
    }
  });

  it('charts the periods oldest first, the provisional one live', () => {
    const pts = page.charts.points;
    const periods = [...page.periods].reverse().slice(-12);
    expect(pts.map((x) => x.period)).toEqual(periods.map((x) => x.periodMonth));
    pts.forEach((pt, i) => {
      const x = periods[i]!;
      expect(pt.live).toBe(x.status === 'provisional');
      expect([pt.cashCents, pt.cashGainCents, pt.savingsCents, pt.savingsRawCents]).toEqual([
        x.cashCents,
        x.cashGainCents,
        x.adjusted.savingsCents,
        x.raw.savingsCents,
      ]);
      expect(pt.adjustmentCents).toBe(x.adjustment?.amountCents ?? 0);
      if (pt.trendRatio !== null) expect(x.status).toBe('closed');
    });
  });

  it('carries the Cash page settings', () => {
    checkSlice(page.settings, CASH_KEYS);
  });
});

describe.each(Object.entries(f.sideIncomePages))(
  'side income page %s',
  (_n, page: SideIncomePageResponse) => {
    it('buckets every deposit into one period or outside them (D57)', () => {
      const periods = [...page.periods].reverse();
      periods.forEach((p, i) => {
        if (i === 0) expect(p.start).toBe(`${p.end.slice(0, 7)}-01`);
        else expect(p.start).toBe(addDays(periods[i - 1]!.end, 1));
        expect(p.totalCents).toBe(sum(p.byStream.map((b) => b.amountCents)));
        const own = page.deposits.filter((d) => d.periodMonth === p.periodMonth);
        expect(p.totalCents).toBe(sum(own.map((d) => d.amountCents)));
        for (const d of own) expect(d.date >= p.start && d.date <= p.end).toBe(true);
        expect(own.every((d) => d.provisional === (p.status === 'provisional'))).toBe(true);
      });
      expect(periods.filter((p) => p.status === 'provisional').length).toBeLessThanOrEqual(1);
      const inside = sum(page.periods.map((p) => p.totalCents));
      expect(inside + page.outside.beforeFirstCents + page.outside.afterAsOfCents).toBe(
        page.kpis.lifetimeCents,
      );
      const dates = page.deposits.map((d) => d.date);
      expect(dates).toEqual([...dates].sort().reverse());
    });

    it('has FY and 365-day KPIs from closed periods (§2.8)', () => {
      const k = page.kpis;
      expect(k.financialYear).toBe(financialYearOfIso(page.asOf));
      expect(k.projectedYearCents).toBe(
        k.avgPerPeriodThisFyCents === null ? null : k.avgPerPeriodThisFyCents * 12,
      );
      expect(k.fyToDateCents).toBe(
        sum(
          page.deposits
            .filter((d) => d.date >= k.fyStart && d.date <= page.asOf)
            .map((d) => d.amountCents),
        ),
      );
      expect(page.budget.avg365Cents).toBe(k.avg365Cents);
      for (const s of page.streams) {
        const own = page.deposits.filter((d) => d.streamId === s.id);
        expect([s.depositCount, s.lifetimeCents]).toEqual([
          own.length,
          sum(own.map((d) => d.amountCents)),
        ]);
      }
    });
  },
);

describe.each(Object.entries(f.budgetPages))('budget page %s', (_n, page: BudgetPageResponse) => {
  const s = page.summary;

  it('has tables whose totals equal their rows (§6.5)', () => {
    const spending = page.rows.filter((r) => r.kind === 'item' || r.kind === 'auto_yearly');
    expect(sum(spending.map((r) => r.monthlyCents))).toBe(s.plannedSpendCents);
    expect(s.emergencyFundBasisCents).toBe(s.plannedSpendCents);
    expect(page.rows.find((r) => r.kind === 'auto_yearly')?.monthlyCents).toBe(s.yearlyFundCents);
    if (s.leftoverCents !== null) {
      expect(s.leftoverCents).toBe(s.monthlyIncomeCents! - s.plannedSpendCents);
      expect((s.investmentRowCents ?? 0) + (s.cashRowCents ?? 0) + s.unallocatedCents!).toBe(
        s.leftoverCents,
      );
    }
    for (const r of page.rows) {
      expect(r.yearlyCents).toBe(r.monthlyCents * 12);
      expect(r.derived).toBe(r.kind !== 'item');
      expect(r.manual).toBe(r.kind === 'auto_invest' && s.investManual);
      if (s.monthlyIncomeCents)
        expect(ratioOf(r.incomeShareRatio, r.monthlyCents, s.monthlyIncomeCents)).toBe(true);
    }
    for (const y of page.yearlyExpenses)
      expect(y.monthlyCents).toBe(Math.round(y.annualCents / 12));
  });

  it('groups the payday transfers by account, unassigned rows apart (§2.9)', () => {
    const total = sum(page.rows.map((r) => r.monthlyCents));
    expect(sum(page.transfers.map((x) => x.monthlyCents)) + page.unassigned.monthlyCents).toBe(
      total,
    );
    expect(sum(page.transfers.map((x) => x.rows)) + page.unassigned.rows).toBe(page.rows.length);
    expect(page.perPayTotalCents).toBe(
      s.payFrequency === null
        ? null
        : sum(page.transfers.map((x) => x.perPayCents)) + page.unassigned.perPayCents,
    );
    const cats = page.byCategory;
    expect(sum(cats.map((c) => c.monthlyCents))).toBe(
      sum(page.rows.filter((r) => r.monthlyCents > 0).map((r) => r.monthlyCents)),
    );
    const named = cats.filter((c) => c.category !== null).map((c) => c.monthlyCents);
    expect(named).toEqual([...named].sort((a, b) => b - a));
    if (cats.some((c) => c.category === null)) expect(cats.at(-1)!.category).toBeNull();
  });

  it('carries the Budget page settings and the actual spend', () => {
    checkSlice(page.settings, BUDGET_KEYS);
    expect(page.actual.plannedCents).toBe(s.plannedSpendCents);
  });
});

describe('budget states', () => {
  const b: Record<keyof typeof f.budgetPages, BudgetPageResponse> = f.budgetPages;
  it('show D54, the negative cash row, cash first, missing inputs and stale accounts', () => {
    expect(b.manualSplit.summary).toMatchObject({ investManual: true, investmentRowCents: 100000 });
    expect(b.manualOverLeftover.summary.cashRowCents).toBeLessThan(0);
    expect(b.manualOverLeftover.summary.unallocatedCents).toBeLessThan(0);
    expect(b.belowEmergencyFund.summary).toMatchObject({
      belowEmergencyFund: true,
      investShareRatio: '0',
    });
    expect(b.missingPay.summary.monthlyIncomeCents).toBeNull();
    expect(b.missingPay.missing.length).toBeGreaterThan(0);
    expect(
      b.unmatchedAccounts.rows.some(
        (r) => !r.accountLinked && r.flags.includes('unmatched_account'),
      ),
    ).toBe(true);
    expect(b.negativeActual.actual.actualCents).toBeLessThan(0);
    expect(b.negativeActual.summary.sideIncomeIncluded).toBe(true);
    expect(b.autoSplit.rows.some((r) => r.savingsLine)).toBe(true);
    expect(b.autoSplit.unassigned.rows).toBeGreaterThan(0);
  });
});

describe.each(Object.entries(f.dividendsPages))(
  'dividends page %s',
  (_n, page: DividendsPageResponse) => {
    it('has a ledger newest first with FYs and yields from the stored units and price', () => {
      const keys = page.dividends.map((d) => [d.paymentDate, d.id] as const);
      expect(keys).toEqual(
        [...keys].sort((a, b) => (a[0] === b[0] ? b[1] - a[1] : a[0] < b[0] ? 1 : -1)),
      );
      for (const d of page.dividends) {
        expect(d.financialYear).toBe(financialYearOfIso(d.paymentDate));
        if (d.yieldRatio !== null) {
          expect(
            ratioOf(
              d.yieldRatio,
              d.netAmountCents / 100,
              Number(d.priceAtEx) * Number(d.unitsAtEx),
            ),
          ).toBe(true);
        }
      }
    });

    it('adds up the FY table, the rolling months and the KPIs (§2.10)', () => {
      const fy = financialYearOfIso(page.asOf);
      expect(page.byFinancialYear.slice(0, 5).map((r) => r.financialYear)).toEqual([
        fy,
        fy - 1,
        fy - 2,
        fy - 3,
        fy - 4,
      ]);
      for (const r of [...page.byFinancialYear, ...page.rolling12]) {
        expect(r.totalCents).toBe(sum(INSTRUMENT_KINDS.map((k) => r.byKind[k])));
      }
      const all = sum(page.dividends.map((d) => d.netAmountCents));
      expect(sum(page.byFinancialYear.map((r) => r.totalCents))).toBe(all);
      expect(page.kpis.allTimeCents).toBe(all);
      expect(page.kpis.thisFyCents).toBe(page.byFinancialYear[0]!.totalCents);
      expect(page.kpis.lastFyCents).toBe(page.byFinancialYear[1]!.totalCents);
      expect(page.rolling12).toHaveLength(12);
      expect(page.rolling12.at(-1)!.month).toBe(page.asOf.slice(0, 7));
      expect(page.kpis.rolling12Cents).toBe(sum(page.rolling12.map((m) => m.totalCents)));
      expect(sum(page.holdingsThisFy.map((h) => h.netThisFyCents)) + page.unlinkedThisFyCents).toBe(
        page.kpis.thisFyCents,
      );
      const nets = page.holdingsThisFy.map((h) => h.netThisFyCents);
      expect(nets).toEqual([...nets].sort((a, b) => b - a));
    });

    it('gives DRP advice by the 6-month rule', () => {
      for (const h of page.holdingsThisFy) {
        const m = h.monthsToExtraUnit;
        const expected =
          h.drp === null || m === null
            ? null
            : m < 6 && !h.drp
              ? 'switch_on'
              : m >= 6 && h.drp
                ? 'switch_off'
                : 'keep';
        expect(h.advice, h.symbol).toBe(expected);
      }
    });

    it('lists suggestions by ex-date, AUD only, with statuses from the expected date', () => {
      const ex = page.suggestions.map((x) => x.exDate);
      expect(ex).toEqual([...ex].sort().reverse());
      for (const x of page.suggestions) {
        expect(x.currency).toBe('AUD');
        expect(x.exDate <= page.asOf).toBe(true);
        if (x.status !== 'dismissed')
          expect(x.status).toBe(x.expectedPaymentDate <= page.asOf ? 'due' : 'upcoming');
        expect(x.estimatedNetCents).toBe(
          Math.round(Number(x.unitsAtEx) * Number(x.amountPerUnit) * 100),
        );
        const h = page.holdings.find((y) => y.instrumentId === x.instrumentId)!;
        expect(x.reinvestedDefault).toBe(h.drp);
        // Never a suggestion for a payment already in the ledger.
        expect(
          page.dividends.some((d) => d.instrumentId === x.instrumentId && d.exDate === x.exDate),
        ).toBe(false);
      }
      if (page.events.mode === 'off') expect(page.suggestions).toEqual([]);
    });
  },
);

describe('dividends states', () => {
  const d: Record<keyof typeof f.dividendsPages, DividendsPageResponse> = f.dividendsPages;
  it('cover the check outcomes and modes', () => {
    expect(new Set(d.suggestions.suggestions.map((x) => x.status))).toEqual(
      new Set(['due', 'upcoming', 'dismissed']),
    );
    expect(d.checkedNoneFound.events.lastRefreshAt).not.toBeNull();
    expect(d.checkedNoneFound.suggestions.every((x) => x.status === 'dismissed')).toBe(true);
    expect(d.checkedNoneFound.suggestions.length).toBeGreaterThan(0);
    expect(d.checkFailed.events.lastError).not.toBeNull();
    expect(d.populated.events.lastRefreshAt).toBeNull();
    expect(d.marketOff.events.mode).toBe('off');
    expect(d.fakeMode.events.mode).toBe('fake');
    expect(d.empty.dividends).toEqual([]);
    expect(d.populated.unlinkedThisFyCents).toBeGreaterThan(0);
  });
});

describe('mutation examples and request bodies built from the fixtures', () => {
  it('match their page rows', () => {
    const cash = f.cashPages.populated;
    expect(f.cashAccountMutationResponse.account).toEqual(cash.accounts.find((a) => a.id === 1));
    for (const a of f.balancesResponse.accounts) expect(cash.accounts).toContainEqual(a);
    expect(f.depositMutationResponse.deposit).toEqual(f.sideIncomePages.populated.deposits[0]);
    expect(f.budgetItemMutationResponse.row).toEqual(f.budgetPages.autoSplit.rows[0]);
    expect(f.dividendMutationResponse.dividend).toEqual(f.dividendsPages.populated.dividends[0]);
    checkSlice(f.settingsPatchResponse.settings, CASH_KEYS);
    expect(f.settingsPatchResponse.hasAppData).toBe(false);
  });

  it('parse with the request schemas', () => {
    const due = f.dividendsPages.suggestions.suggestions.find((x) => x.status === 'due')!;
    const confirm = {
      instrumentId: due.instrumentId,
      paymentDate: due.expectedPaymentDate,
      exDate: due.exDate,
      reinvested: due.reinvestedDefault,
      netAmountCents: due.estimatedNetCents,
      note: 'Estimated from Yahoo',
    };
    expect(makeDividendInputSchema(now).safeParse(confirm).success).toBe(true);
    const dep = f.depositMutationResponse.deposit;
    expect(
      makeDepositInputSchema(now).safeParse({
        streamId: dep.streamId,
        date: dep.date,
        amountCents: dep.amountCents,
        note: dep.note ?? '',
      }).success,
    ).toBe(true);
    expect(
      makeCashBalancesInputSchema(now).safeParse({
        asOf: '2026-09-24',
        entries: f.balancesResponse.accounts.map((a) => ({
          accountId: a.id,
          balanceCents: a.balanceCents,
        })),
      }).success,
    ).toBe(true);
    for (const g of f.cashPages.populated.goals.items) {
      const body = {
        name: g.name,
        targetCents: g.targetCents,
        targetDate: g.targetDate,
        note: g.note ?? '',
      };
      expect(savingsGoalInputSchema.safeParse(body).success, g.name).toBe(true);
    }
    const values = Object.fromEntries(
      Object.entries(f.settingsPatchResponse.settings.values).filter(([, v]) => v !== null),
    );
    expect(settingsPatchSchema.safeParse({ values }).success).toBe(true);
  });
});
