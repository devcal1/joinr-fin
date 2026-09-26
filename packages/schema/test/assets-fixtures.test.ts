// The assets fixtures (stage-4.md §3.6) are internally consistent (rows add up, orders, windows,
// statuses), parse where a schema exists and cover every state the pages render.
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  DecimalStringSchema,
  financialYearOfIso,
  FX_RATE_SOURCES,
  isApiErrorBody,
  isIsoDateString,
  isIsoMonthString,
  isIsoTimestampString,
  isSettingKey,
  LOAN_ENTRY_FLAGS,
  LOAN_FLAGS,
  loanOffsetsInputSchema,
  makeLoanBalancesInputSchema,
  makeLoanCreateSchema,
  makeOtherAssetCreateSchema,
  makeOtherAssetPricesInputSchema,
  makeOtherAssetSaleInputSchema,
  makePropertyCreateSchema,
  makeSuperBalancesInputSchema,
  makeSuperContributionInputSchema,
  makeSuperFundCreateSchema,
  makeValuationsInputSchema,
  OTHER_ASSET_FLAGS,
  settingValueSchema,
  sgOverrideInputSchema,
  SUPER_CAP_STATUSES,
  SUPER_FLAGS,
  type OtherAssetsPageResponse,
  type PropertyPageResponse,
  type SettingsSliceDto,
  type SuperFlowsDto,
  type SuperPageResponse,
} from '../src/index';
import * as f from '../src/fixtures/index';

const sum = (xs: readonly (number | null)[]): number =>
  xs.reduce<number>((a, x) => a + (x ?? 0), 0);
/** |r − num/den| within the 12-significant-digit ratio rounding. */
const ratioOf = (r: string | null, num: number, den: number) =>
  r !== null && Math.abs(Number(r) - num / den) <= 1e-11 * Math.max(1, Math.abs(num / den));
/**
 * History T from the unrounded gain (§2.5 step 4): the SG part is rounded once in the flows, so the
 * unrounded gain lies within half a cent of the rounded one.
 */
const gainRatioOf = (r: string | null, gain: number, value: number) => {
  const t = (g: number) => g / (value - g);
  return r !== null && Number(r) >= t(gain - 0.5) - 1e-12 && Number(r) <= t(gain + 0.5) + 1e-12;
};
const now = () => new Date(2026, 8, 24, 14, 32);
const desc = <T>(keys: readonly T[]) => [...keys].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

const SUPER_KEYS = [
  'pay.grossAnnualSalaryCents',
  'tax.marginalRate',
  'pay.jobStartDate',
  'super.sgRate',
  'super.contributionsTaxRate',
  'super.concessionalCapCents',
  'super.importedContributionType',
];
const OTHER_ASSETS_KEYS = ['otherAssets.stalePriceDays'];
const PROPERTY_KEYS = ['savings.includeMortgagePrincipal', 'property.offsetsIncludeEmergencyFund'];

function checkSlice(slice: SettingsSliceDto, keys: readonly string[]) {
  expect(Object.keys(slice.values).sort()).toEqual([...keys].sort());
  expect(Object.keys(slice.origins).sort()).toEqual([...keys].sort());
  for (const [key, value] of Object.entries(slice.values)) {
    if (!isSettingKey(key)) throw new Error(key);
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
    if (k.includes('.')) continue; // setting keys: checkSlice
    if (v !== null && typeof v !== 'object') {
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      if (/Cents$/.test(k)) expect(Number.isSafeInteger(v), at).toBe(true);
      if (
        /Ratio$|^(units|legacySoldUnits|soldUnits|remainingUnits|unitCost|unitPrice|unitPriceAud|purchaseFxRate|ozPerUnit|audPerOz|audPerUnit|ratio|projectedRatio|annualRate)$/.test(
          k,
        )
      ) {
        expect(DecimalStringSchema.safeParse(v).success, `${at} = ${text}`).toBe(true);
      }
      if (
        /^(asOf|runDate|through|after|start|end|date|saleDate|purchaseDate|effectiveDate|priceAsOf|purchaseFxDate|balanceAsOf|valuationDate|startDate|paymentAnchorDate|firstPaymentDate|payoffDate|gainFrom|from|lastRun|assumedDate|checkedOn|paydaySuperStart)$/.test(
          k,
        ) &&
        typeof v === 'string' &&
        !path.endsWith('spot') &&
        !/\.(spot|fx)\[\d+\]$/.test(path)
      ) {
        expect(isIsoDateString(text), `${at} = ${text}`).toBe(true);
      }
      if (/^(periodMonth|period|month)$/.test(k)) expect(isIsoMonthString(text), at).toBe(true);
      if (/^(generatedAt|lastRefreshAt)$/.test(k))
        expect(isIsoTimestampString(text), at).toBe(true);
    }
    checkShapes(v, at);
  }
}

describe('coverage (stage-4.md §3.6)', () => {
  it('covers every other-asset flag, price status, FX source, super flag, cap status and loan flag', () => {
    const c = f.FIXTURE_COVERAGE;
    expect(new Set(c.otherAssetFlags)).toEqual(new Set(OTHER_ASSET_FLAGS));
    // The engine gives other assets four statuses (never 'failed', §2.4).
    expect(new Set(c.otherAssetPriceStatuses)).toEqual(
      new Set(['fresh', 'stale', 'manual', 'none']),
    );
    expect(new Set(c.fxRateSources)).toEqual(new Set(FX_RATE_SOURCES));
    expect(new Set(c.superFlags)).toEqual(new Set(SUPER_FLAGS));
    expect(new Set(c.superCapStatuses)).toEqual(new Set(SUPER_CAP_STATUSES));
    expect(new Set(c.loanFlags)).toEqual(new Set(LOAN_FLAGS));
    expect(new Set(c.loanEntryFlags)).toEqual(new Set(LOAN_ENTRY_FLAGS));
  });

  it('has the named states', () => {
    expect(Object.keys(f.otherAssetsPages)).toEqual([
      'populated',
      'empty',
      'noSnapshots',
      'marketOff',
    ]);
    expect(Object.keys(f.superPages)).toEqual([
      'populated',
      'empty',
      'noSalary',
      'noSgFund',
      'noMarginalRate',
      'overCap',
      'capOverride',
      'capOverrideLastFy',
      'notUpdated',
      'noSnapshots',
    ]);
    expect(Object.keys(f.propertyPages)).toEqual([
      'populated',
      'noLoan',
      'empty',
      'paymentBelowInterest',
      'noRate',
      'unlinkedOffset',
      'loanWithoutProperty',
      'twoLoans',
    ]);
  });

  it('has well-formed fields everywhere', () => {
    checkShapes({ ...f.otherAssetsPages, ...f.superPages, ...f.propertyPages });
    checkShapes([
      f.otherAssetMutationResponse,
      f.otherAssetPricesResponse,
      f.superFundMutationResponse,
      f.superBalancesResponse,
      f.superContributionMutationResponse,
      f.sgOverrideResponse,
      f.propertyMutationResponse,
      f.valuationsResponse,
      f.loanMutationResponse,
      f.loanBalancesResponse,
      f.loanOffsetsResponse,
    ]);
  });

  it('has the Stage 4 error bodies with known codes', () => {
    for (const key of [
      'fundInUse',
      'propertyHasLoan',
      'saleOversell',
      'assetsValidation',
    ] as const) {
      const body = f.apiErrors[key];
      expect(isApiErrorBody(body)).toBe(true);
      expect(API_ERROR_CODES).toContain(body.error.code);
    }
    expect(f.apiErrors.fundInUse.error.code).toBe('FUND_IN_USE');
    expect(f.apiErrors.propertyHasLoan.error.code).toBe('PROPERTY_HAS_LOAN');
    expect(f.apiErrors.saleOversell.error.code).toBe('SALE_OVERSELL');
  });
});

describe.each(Object.entries(f.otherAssetsPages))(
  'other assets page %s',
  (_name, page: OtherAssetsPageResponse) => {
    it('gives every row units, cost, value and gain that add up (§2.4)', () => {
      for (const a of page.assets) {
        const remaining = Number(a.units) - Number(a.legacySoldUnits) - Number(a.soldUnits);
        expect(Number(a.remainingUnits), a.description).toBe(Math.max(0, remaining));
        expect(a.flags.includes('oversold')).toBe(remaining < 0);
        expect(a.flags.includes('legacy_sold')).toBe(Number(a.legacySoldUnits) > 0);
        if (a.costCents !== null && a.valueCents !== null) {
          expect(a.gainCents, a.description).toBe(a.valueCents - a.costCents);
          if (a.costCents > 0)
            expect(Math.abs(Number(a.gainRatio) - a.gainCents! / a.costCents)).toBeLessThan(1e-4);
        } else {
          expect([a.gainCents, a.gainRatio, a.cagrRatio]).toEqual([null, null, null]);
        }
        if (a.unitPriceAud !== null && a.valueCents !== null) {
          expect(
            Math.abs(a.valueCents - Number(a.remainingUnits) * Number(a.unitPriceAud) * 100),
          ).toBeLessThanOrEqual(0.5);
        }
        expect(a.dateAssumed).toBe(a.purchaseDate === null && a.effectiveDate !== null);
        if (a.purchaseDate !== null) expect(a.effectiveDate).toBe(a.purchaseDate);
        else expect(a.effectiveDate).toBe(page.assumedDate);
        expect(a.flags.includes('no_purchase_date')).toBe(a.purchaseDate === null);
        expect(a.flags.includes('unpriced')).toBe(a.priceStatus === 'none');
        if (a.priceSource === 'bullion') {
          expect(a.unitPrice).toBeNull();
          expect(a.currency).toBe('AUD');
          expect(a.metal).not.toBeNull();
        }
        if (a.currency === 'AUD') expect(a.purchaseFxRate).toBeNull();
        // The row's price entries: the latest is the row's price (manual rows).
        const own = page.priceEntries.filter((e) => e.assetId === a.id);
        expect(own.length).toBe(a.priceEntryCount);
        for (const e of own) expect(e.currency).toBe(a.currency);
        if (a.priceSource === 'manual' && own.length > 0) {
          expect([own[0]!.asOf, own[0]!.unitPrice]).toEqual([a.priceAsOf, a.unitPrice]);
        }
        const sales = page.sales.filter((s) => s.assetId === a.id);
        expect(sales.length).toBe(a.saleCount);
        expect(sum(sales.map((s) => s.realisedCents))).toBe(a.realisedCents);
        expect(Number(a.soldUnits)).toBe(sum(sales.map((s) => Number(s.units))));
      }
      for (const s of page.sales) {
        if (s.costCents !== null) expect(s.realisedCents).toBe(s.proceedsCents - s.costCents);
      }
    });

    it('has totals that are the Σ of the rows (D3, D4, D5) and counts from the flags', () => {
      const t = page.totals;
      const both = page.assets.filter((a) => a.costCents !== null && a.valueCents !== null);
      expect(t.valueCents).toBe(sum(page.assets.map((a) => a.valueCents)));
      expect(t.costCents).toBe(sum(both.map((a) => a.costCents)));
      expect(t.gainCents).toBe(sum(both.map((a) => a.gainCents)));
      if (t.costCents > 0)
        expect(Math.abs(Number(t.gainRatio) - t.gainCents / t.costCents)).toBeLessThan(1e-4);
      else expect(t.gainRatio).toBeNull();
      expect(t.realisedCents).toBe(sum(page.assets.map((a) => a.realisedCents)));
      expect(t.proceedsCents).toBe(sum(page.sales.map((s) => s.proceedsCents)));
      const count = (flag: string) =>
        page.assets.filter((a) => a.flags.includes(flag as never)).length;
      expect(t.unpricedCount).toBe(count('unpriced'));
      expect(t.fxMissingCount).toBe(count('purchase_fx_missing'));
      expect(t.liveFxMissingCount).toBe(count('live_fx_missing'));
      expect(t.assumedDateCount).toBe(page.assets.filter((a) => a.dateAssumed).length);
      expect(t.staleCount).toBe(
        page.assets.filter((a) => a.priceSource === 'manual' && a.priceStatus === 'stale').length,
      );
    });

    it('orders the logs, lists both metals and ends the chart at the live totals', () => {
      const entryKeys = page.priceEntries.map((e) => `${e.asOf}:${String(e.id).padStart(6, '0')}`);
      expect(entryKeys).toEqual(desc(entryKeys));
      const saleKeys = page.sales.map((s) => `${s.saleDate}:${String(s.id).padStart(6, '0')}`);
      expect(saleKeys).toEqual(desc(saleKeys));
      expect(page.spot.map((s) => s.metal)).toEqual(['silver', 'gold']);
      expect(page.assets.map((a) => a.sortOrder)).toEqual(page.assets.map((_, i) => i + 1));
      const pts = page.charts.points;
      const live = pts.at(-1)!;
      expect(live).toMatchObject({
        live: true,
        date: page.asOf,
        valueCents: page.totals.valueCents,
        gainCents: page.totals.gainCents,
      });
      expect(pts.filter((p) => p.live)).toHaveLength(1);
      if (pts.length > 1) expect(page.assumedDate).toBe(pts[0]!.date);
      else expect(page.assumedDate).toBeNull();
      for (const p of pts) {
        if (p.valueCents !== null && p.gainCents !== null && p.valueCents !== p.gainCents) {
          expect(ratioOf(p.gainRatio, p.gainCents, p.valueCents - p.gainCents), p.period).toBe(
            true,
          );
        }
      }
      checkSlice(page.settings, OTHER_ASSETS_KEYS);
    });
  },
);

const flowsAddUp = (change: number, g: SuperFlowsDto) =>
  change - g.sgFundCents - g.memberFundCents - g.transferInCents;

describe.each(Object.entries(f.superPages))('super page %s', (_name, page: SuperPageResponse) => {
  it('lists funds (archived last) with their latest balance; the total is Σ the live funds', () => {
    const archived = page.funds.map((x) => Number(x.archived));
    expect(archived).toEqual([...archived].sort((a, b) => a - b));
    for (const fund of page.funds) {
      const own = page.balanceEntries.filter((e) => e.fundId === fund.id);
      expect(own.length, fund.name).toBe(fund.entryCount);
      if (own.length > 0)
        expect([own[0]!.asOf, own[0]!.balanceCents]).toEqual([fund.balanceAsOf, fund.balanceCents]);
      expect(page.contributions.filter((c) => c.fundId === fund.id).length).toBe(
        fund.contributionCount,
      );
      // Each later entry: gain = Δ balance − the flows in (§2.5 step 6).
      const byDate = [...own].reverse();
      byDate.forEach((e, i) => {
        if (i === 0) expect([e.flowsCents, e.gainCents]).toEqual([null, null]);
        else expect(e.gainCents).toBe(e.balanceCents - byDate[i - 1]!.balanceCents - e.flowsCents!);
      });
    }
    expect(page.totalCents).toBe(
      sum(page.funds.filter((x) => !x.archived).map((x) => x.balanceCents)),
    );
    const keys = page.balanceEntries.map((e) => `${e.asOf}:${String(e.id).padStart(6, '0')}`);
    expect(keys).toEqual(desc(keys));
    expect(page.funds.filter((x) => x.receivesSg).length).toBeLessThanOrEqual(1);
    expect(page.flags.includes('no_sg_fund')).toBe(
      !page.funds.some((x) => x.receivesSg) && page.sgMonths.some((m) => m.grossCents > 0),
    );
  });

  it('prices each contribution by its kind (D71) and buckets it into its period', () => {
    const ctax = Number(page.statutory.contributionsTaxRatio);
    for (const c of page.contributions) {
      expect(c.estimate).toBe(c.kind === 'voluntary_contribution');
      if (c.concessional) {
        // An imported entry's pre-tax is grossed up unrounded, so its fund figure may differ by 1.
        expect(Math.abs(c.fundReceivesCents - c.preTaxCents! * (1 - ctax))).toBeLessThanOrEqual(
          c.estimate ? 1 : 0.5,
        );
        if (c.kind === 'salary_sacrifice') expect(c.preTaxCents).toBe(c.amountCents);
      } else {
        expect(c.preTaxCents).toBeNull();
        expect([c.fundReceivesCents, c.netPayCostCents]).toEqual([c.amountCents, c.amountCents]);
      }
      if (c.estimate) expect(c.netPayCostCents).toBe(c.amountCents);
      expect(c.fundName).toBe(page.funds.find((x) => x.id === c.fundId)?.name ?? null);
      const period = page.periods.find((p) => p.periodMonth === c.periodMonth);
      if (c.periodMonth === null)
        expect(
          page.periods.every((p) => c.date > p.through || (p.after !== null && c.date <= p.after)),
        ).toBe(true);
      else
        expect(
          c.date <= period!.through && (period!.after === null || c.date > period!.after),
        ).toBe(true);
      expect(c.provisional).toBe(period?.status === 'provisional');
    }
    const keys = page.contributions.map((c) => `${c.date}:${String(c.id).padStart(6, '0')}`);
    expect(keys).toEqual(desc(keys));
    expect(page.flags.includes('imported_estimates')).toBe(
      page.contributions.some((c) => c.estimate),
    );
  });

  it('has periods newest first whose valuation rows add up: change − flows = gain (§2.5)', () => {
    const p = page.periods;
    const runs = p.map((x) => x.runDate);
    expect(runs).toEqual(desc(runs));
    expect(page.lastRun).toBe(p.find((x) => x.status !== 'provisional')?.runDate ?? null);
    if (p.length === 0) return;
    expect(p.at(-1)!).toMatchObject({ status: 'first', after: null, flows: null, gainCents: null });
    for (let i = 0; i < p.length - 1; i++) expect(p[i]!.after).toBe(p[i + 1]!.runDate);
    for (const x of p.filter((y) => y.status !== 'first')) {
      // A window's member flows are the Σ of its contributions' rows.
      const own = page.contributions.filter((c) => c.periodMonth === x.periodMonth);
      expect(x.flows!.memberFundCents, x.periodMonth).toBe(
        sum(own.map((c) => c.fundReceivesCents)),
      );
      expect(x.flows!.memberNetPayCents).toBe(sum(own.map((c) => c.netPayCostCents)));
      if (x.notUpdated) {
        expect([x.gainCents, x.gainRatio, x.returnRatio, x.changeCents]).toEqual([
          null,
          null,
          null,
          null,
        ]);
        continue;
      }
      const from = p.find((y) => y.runDate === x.gainFrom)!;
      expect(x.changeCents).toBe(x.valueCents! - from.valueCents!);
      expect(x.gainCents, x.periodMonth).toBe(flowsAddUp(x.changeCents!, x.gainFlows!));
      if (x.status === 'provisional') {
        // D79: the gain counts SG and contributions only to the oldest latest balance of the open
        // funds; transfers in to the as-of (the value holds them); the window's flows run on.
        const measured = page.funds
          .filter((y) => !y.archived)
          .map((y) => y.balanceAsOf!)
          .sort()[0]!;
        expect(measured > x.after! && measured <= x.through).toBe(true);
        const counted = page.contributions.filter(
          (c) => c.date > x.gainFrom! && c.date <= measured,
        );
        expect(x.gainFlows!.memberFundCents).toBe(sum(counted.map((c) => c.fundReceivesCents)));
        const moved = page.balanceEntries.filter(
          (e) => e.asOf > x.gainFrom! && e.asOf <= x.through,
        );
        expect(x.gainFlows!.transferInCents).toBe(sum(moved.map((e) => e.transferInCents)));
        if (x.gainFrom === x.after)
          expect(x.gainFlows!.sgGrossCents).toBeLessThanOrEqual(x.flows!.sgGrossCents);
        if (x.returnRatio !== null) expect(page.annualised.through).toBe(measured);
      } else if (x.gainFrom === x.after) expect(x.gainFlows).toEqual(x.flows);
      expect(gainRatioOf(x.gainRatio, x.gainCents!, x.valueCents!), x.periodMonth).toBe(true);
    }
    if (p[0]!.status === 'provisional') {
      expect(p[0]!.valueCents).toBe(page.totalCents);
      expect(page.flags.includes('balances_not_updated')).toBe(p[0]!.notUpdated);
    }
    for (const x of p)
      expect(x.note).toEqual(page.notes.find((n) => n.periodMonth === x.periodMonth) ?? null);
    const months = page.notes.map((n) => n.periodMonth);
    expect(months).toEqual(desc(months));
  });

  it('has SG months (month desc) and cap years that add up (D70, D75)', () => {
    const months = page.sgMonths.map((m) => m.month);
    expect(months).toEqual(desc(months));
    expect(months[0]).toBe(page.asOf.slice(0, 7));
    const ctax = Number(page.statutory.contributionsTaxRatio);
    for (const m of page.sgMonths) {
      expect(Math.abs(m.fundReceivesCents - m.grossCents * (1 - ctax))).toBeLessThanOrEqual(0.5);
      if (m.source === 'none') expect(m.grossCents).toBe(0);
      expect(m.note === null).toBe(m.source !== 'statement');
    }
    const fy = financialYearOfIso(page.asOf);
    expect(page.capYears.map((c) => c.financialYear)).toEqual([fy, fy - 1]);
    for (const c of page.capYears) {
      expect(c.totalCents).toBe(c.sgGrossCents + c.salarySacrificeCents + c.importedEstimateCents);
      expect(ratioOf(c.ratio, c.totalCents, c.capCents)).toBe(true);
      expect(ratioOf(c.projectedRatio, c.projectedCents, c.capCents)).toBe(true);
      if (c.complete) expect(c.projectedCents).toBe(c.totalCents);
      const expected =
        c.totalCents > c.capCents || c.projectedCents > c.capCents
          ? 'over'
          : c.projectedCents >= 0.9 * c.capCents
            ? 'near'
            : 'under';
      expect(c.status, String(c.financialYear)).toBe(expected);
      expect(c.capSource).toBe(
        page.capOverride?.financialYear === c.financialYear ? 'setting' : 'statutory',
      );
      if (c.capSource === 'setting') expect(c.capCents).toBe(page.capOverride!.cents);
      const inFy = page.contributions.filter((x) => x.date >= c.start && x.date < c.end);
      expect(c.memberFundCents).toBe(sum(inFy.map((x) => x.fundReceivesCents)));
      expect(c.memberNetPayCents).toBe(sum(inFy.map((x) => x.netPayCostCents)));
      expect(c.estimateCount).toBe(inFy.filter((x) => x.estimate).length);
      expect(c.nonConcessionalCents).toBe(
        sum(inFy.filter((x) => !x.concessional).map((x) => x.amountCents)),
      );
    }
    expect(page.statutory.checkedOn).toBe('2026-09-26');
    checkSlice(page.settings, SUPER_KEYS);
    expect(page.charts.points.map((x) => x.period)).toEqual(
      [...page.periods].reverse().map((x) => x.periodMonth),
    );
  });
});

describe('super states', () => {
  const s: Record<keyof typeof f.superPages, SuperPageResponse> = f.superPages;
  it('show the named conditions', () => {
    expect(s.populated.capYears[0]!.status).toBe('near');
    expect(s.overCap.capYears[0]!.status).toBe('over');
    expect(s.populated.periods.some((p) => p.notUpdated && p.status === 'closed')).toBe(true);
    expect(s.populated.periods.some((p) => (p.gainCents ?? 0) < 0)).toBe(true);
    expect(s.populated.balanceEntries.some((e) => (e.transferInCents ?? 0) > 0)).toBe(true);
    // D79: the provisional gain is measured to the latest balances, dated before the as-of.
    const live = s.populated.periods[0]!;
    expect(s.populated.funds.every((x) => x.balanceAsOf! < s.populated.asOf)).toBe(true);
    expect(live.gainFlows!.sgGrossCents).toBeLessThan(live.flows!.sgGrossCents);
    expect(s.populated.sgMonths.some((m) => m.source === 'statement')).toBe(true);
    // FY2026–27 counts the April–June 2026 quarter (paid in July, D75).
    expect(
      s.populated.sgMonths
        .filter((m) => m.capFinancialYear === 2026)
        .map((m) => m.month)
        .slice(-3),
    ).toEqual(['2026-06', '2026-05', '2026-04']);
    expect(s.noSalary.flags).toContain('no_salary');
    expect(s.noSgFund.flags).toContain('no_sg_fund');
    expect(s.noMarginalRate.contributions.some((c) => c.netPayCostCents === null)).toBe(true);
    expect(s.capOverride.capYears[0]!.capSource).toBe('setting');
    expect(s.capOverrideLastFy.capYears[1]!.capSource).toBe('setting');
    expect(s.notUpdated.periods[0]).toMatchObject({
      status: 'provisional',
      notUpdated: true,
      gainCents: null,
    });
    expect(s.noSnapshots.periods).toEqual([]);
    expect(s.noSnapshots.contributions.every((c) => c.periodMonth === null)).toBe(true);
    expect(s.empty.funds).toEqual([]);
  });
});

describe.each(Object.entries(f.propertyPages))(
  'property page %s',
  (_name, page: PropertyPageResponse) => {
    it('gives each loan a log that adds up and totals from it (D66)', () => {
      for (const l of page.loans) {
        const own = page.loanEntries.filter((e) => e.loanId === l.id).reverse();
        expect(own.filter((e) => e.id !== null)).toHaveLength(l.entryCount);
        expect(own.filter((e) => e.start).every((e) => e.id === null)).toBe(true);
        const start = l.startBalanceCents ?? own[0]!.balanceCents;
        own.forEach((e, i) => {
          expect(e.cumulativePrincipalCents).toBe(start - e.balanceCents);
          if (i === 0) {
            expect([e.repaymentsCents, e.principalCents, e.interestFeesCents]).toEqual([
              null,
              null,
              null,
            ]);
            return;
          }
          expect(e.principalCents).toBe(own[i - 1]!.balanceCents - e.balanceCents);
          if (e.repaymentsCents !== null)
            expect(e.interestFeesCents).toBe(e.repaymentsCents - e.principalCents!);
          if (!e.repaymentsTyped && l.paymentCents !== null)
            expect(e.repaymentsCents).toBe(e.paymentsCounted! * l.paymentCents);
          expect(e.flags.includes('repayments_below_principal')).toBe(
            (e.interestFeesCents ?? 0) < 0,
          );
          expect(e.flags.includes('balance_increased')).toBe(e.principalCents! < 0);
          expect(e.cumulativeInterestFeesCents).toBe(
            sum(own.slice(0, i + 1).map((x) => x.interestFeesCents)),
          );
        });
        const last = own.at(-1)!;
        expect([l.balanceCents, l.balanceAsOf]).toEqual([last.balanceCents, last.asOf]);
        expect(l.principalPaidCents).toBe(start - l.balanceCents);
        expect(l.repaymentsCents).toBe(sum(own.map((e) => e.repaymentsCents)));
        expect(l.interestFeesCents).toBe(sum(own.map((e) => e.interestFeesCents)));
        expect(l.netBalanceCents).toBe(Math.max(0, l.balanceCents - l.offsetCents));
        expect(l.excessOffsetCents).toBe(Math.max(0, l.offsetCents - l.balanceCents));
        expect(l.offsetCents).toBe(
          sum(
            page.offsetAccounts
              .filter((o) => l.offsetAccountIds.includes(o.id))
              .map((o) => o.balanceCents),
          ),
        );
        expect(l.nextPeriodInterestCents).toBe(l.schedule?.firstPeriodInterestCents ?? null);
        expect(l.scheduleWithoutOffset === null).toBe(l.offsetCents === 0 || l.schedule === null);
        if (
          l.schedule?.totalInterestCents != null &&
          l.scheduleWithoutOffset?.totalInterestCents != null
        ) {
          expect(l.interestSavedCents).toBe(
            l.scheduleWithoutOffset.totalInterestCents - l.schedule.totalInterestCents,
          );
        }
        if (l.schedule !== null) {
          expect(l.schedule.firstPaymentDate > l.balanceAsOf).toBe(true);
          if (l.schedule.flag !== null) expect(l.schedule.payments).toBeNull();
          else
            expect(l.schedule.points.at(-1)).toMatchObject({
              date: l.schedule.payoffDate,
              balanceCents: 0,
            });
        }
        expect(l.flags.includes('no_property')).toBe(l.propertyId === null);
        expect(l.propertyName).toBe(
          page.properties.find((p) => p.id === l.propertyId)?.name ?? null,
        );
      }
      const keys = page.loanEntries.map((e) => e.asOf);
      expect(keys).toEqual(desc(keys));
    });

    it('gives each property its debt, equity and LVR net of offsets, and totals from them (D67)', () => {
      const propLoans = page.loans.filter((l) => l.propertyId !== null);
      for (const p of page.properties) {
        const loans = propLoans.filter((l) => l.propertyId === p.id);
        expect(p.loanIds).toEqual(loans.map((l) => l.id));
        expect(p.debtCents).toBe(sum(loans.map((l) => l.netBalanceCents)));
        expect(p.equityCents).toBe(
          p.valueCents -
            sum(loans.map((l) => l.balanceCents)) +
            sum(loans.map((l) => l.offsetCents)),
        );
        expect(p.gainCents).toBe(p.valueCents + p.netRentToDateCents - p.purchaseValueCents);
        if (p.valueCents > 0) expect(ratioOf(p.lvrRatio, p.debtCents, p.valueCents)).toBe(true);
        const vals = page.valuations.filter((v) => v.propertyId === p.id);
        expect(vals.length).toBe(p.valuationCount);
        expect([vals[0]!.asOf, vals[0]!.valueCents]).toEqual([p.valuationDate, p.valueCents]);
      }
      const t = page.totals;
      expect(t.valueCents).toBe(sum(page.properties.map((p) => p.valueCents)));
      expect(t.purchaseCents).toBe(sum(page.properties.map((p) => p.purchaseValueCents)));
      expect(t.gainCents).toBe(sum(page.properties.map((p) => p.gainCents)));
      expect(t.mortgageCents).toBe(sum(propLoans.map((l) => l.balanceCents)));
      expect(t.offsetCents).toBe(sum(propLoans.map((l) => l.offsetCents)));
      expect(t.netMortgageCents).toBe(sum(propLoans.map((l) => l.netBalanceCents)));
      expect(t.principalPaidCents).toBe(sum(propLoans.map((l) => l.principalPaidCents)));
      expect(t.interestFeesCents).toBe(sum(propLoans.map((l) => l.interestFeesCents)));
      expect(t.repaymentsCents).toBe(sum(propLoans.map((l) => l.repaymentsCents)));
      expect(t.equityCents).toBe(t.valueCents - t.mortgageCents + t.offsetCents);
      if (t.valueCents > 0)
        expect(ratioOf(t.lvrRatio, t.netMortgageCents, t.valueCents)).toBe(true);
      else expect(t.lvrRatio).toBeNull();
      for (const o of page.offsetAccounts) {
        const linked = page.loans.find((l) => l.offsetAccountIds.includes(o.id));
        expect(o.linkedLoanId).toBe(linked?.id ?? null);
      }
      const live = page.charts.points.at(-1)!;
      expect(live).toMatchObject({
        live: true,
        valueCents: t.valueCents,
        equityCents: t.equityCents,
        lvrRatio: t.lvrRatio,
      });
      checkSlice(page.settings, PROPERTY_KEYS);
    });
  },
);

describe('mutation examples and request bodies built from the fixtures', () => {
  const oa = f.otherAssetsPages.populated;
  const su = f.superPages.populated;
  const pr = f.propertyPages.populated;

  it('match their page rows', () => {
    expect(f.otherAssetMutationResponse.asset).toEqual(oa.assets[0]);
    for (const a of f.otherAssetPricesResponse.assets) expect(oa.assets).toContainEqual(a);
    expect(su.funds).toContainEqual(f.superFundMutationResponse.fund);
    expect(f.superBalancesResponse.funds).toEqual(su.funds);
    expect(su.contributions).toContainEqual(f.superContributionMutationResponse.contribution);
    expect(su.sgMonths).toContainEqual(f.sgOverrideResponse.month);
    expect(f.propertyMutationResponse.property).toEqual(pr.properties[0]);
    expect(f.valuationsResponse.properties).toEqual(pr.properties);
    expect(f.loanMutationResponse.loan).toEqual(pr.loans[0]);
    expect(f.loanBalancesResponse.loans).toEqual(pr.loans);
    expect(f.loanOffsetsResponse).toEqual({ loan: pr.loans[0], offsetAccounts: pr.offsetAccounts });
  });

  it('parse with the request schemas', () => {
    for (const a of oa.assets) {
      const body = {
        description: a.description,
        url: a.url ?? '',
        note: a.note ?? '',
        purchaseDate: a.purchaseDate,
        units: a.units,
        currency: a.currency,
        unitCost: a.unitCost,
        purchaseFxRate: a.purchaseFxRate,
        priceSource: a.priceSource,
        metal: a.metal,
        ozPerUnit: a.ozPerUnit,
        price:
          a.priceSource === 'manual' && a.unitPrice !== null
            ? { unitPrice: a.unitPrice, asOf: a.priceAsOf }
            : null,
      };
      expect(makeOtherAssetCreateSchema(now).safeParse(body).success, a.description).toBe(true);
    }
    const manual = oa.assets.filter((a) => a.priceSource === 'manual' && a.unitPrice !== null);
    expect(
      makeOtherAssetPricesInputSchema(now).safeParse({
        asOf: '2026-09-24',
        entries: manual.map((a) => ({ assetId: a.id, unitPrice: a.unitPrice })),
      }).success,
    ).toBe(true);
    for (const s of oa.sales) {
      expect(
        makeOtherAssetSaleInputSchema(now).safeParse({
          saleDate: s.saleDate,
          units: s.units,
          proceedsCents: s.proceedsCents,
          note: s.note ?? '',
        }).success,
      ).toBe(true);
    }
    const second = su.funds[1]!;
    expect(
      makeSuperFundCreateSchema(now).safeParse({
        name: second.name,
        receivesSg: false,
        openingBalanceCents: 200000,
        asOf: '2026-06-15',
        openingIsRollover: false,
      }).success,
    ).toBe(true);
    expect(
      makeSuperBalancesInputSchema(now).safeParse({
        asOf: '2026-09-20',
        entries: su.funds.map((x) => ({ fundId: x.id, balanceCents: x.balanceCents })),
      }).success,
    ).toBe(true);
    for (const c of su.contributions.filter((x) => !x.estimate)) {
      expect(
        makeSuperContributionInputSchema(now).safeParse({
          fundId: c.fundId,
          date: c.date,
          kind: c.kind,
          amountCents: c.amountCents,
          note: c.note ?? '',
        }).success,
      ).toBe(true);
    }
    const st = su.sgMonths.find((m) => m.source === 'statement')!;
    expect(
      sgOverrideInputSchema.safeParse({ grossCents: st.grossCents, note: st.note ?? '' }).success,
    ).toBe(true);
    const p = pr.properties[0]!;
    expect(
      makePropertyCreateSchema(now).safeParse({
        name: p.name,
        purchaseDate: p.purchaseDate,
        isPrimaryResidence: p.isPrimaryResidence,
        purchaseValueCents: p.purchaseValueCents,
        netRentToDateCents: p.netRentToDateCents,
        note: p.note ?? '',
        valueCents: p.valueCents,
        asOf: p.valuationDate,
      }).success,
    ).toBe(true);
    expect(
      makeValuationsInputSchema(now).safeParse({
        asOf: '2026-08-31',
        entries: pr.properties.map((x) => ({ propertyId: x.id, valueCents: x.valueCents })),
      }).success,
    ).toBe(true);
    for (const l of f.propertyPages.twoLoans.loans) {
      const body = {
        propertyId: l.propertyId,
        name: l.name,
        lender: l.lender ?? '',
        startDate: l.startDate,
        startBalanceCents: l.startBalanceCents,
        annualRate: l.annualRate,
        compoundingPerYear: l.compoundingPerYear,
        paymentCents: l.paymentCents,
        paymentFrequency: l.paymentFrequency,
        note: l.note ?? '',
        balanceCents: l.balanceCents,
        asOf: l.balanceAsOf,
      };
      expect(makeLoanCreateSchema(now).safeParse(body).success, l.name).toBe(true);
    }
    expect(
      makeLoanBalancesInputSchema(now).safeParse({
        asOf: '2026-08-31',
        entries: pr.loans.map((l) => ({ loanId: l.id, balanceCents: l.balanceCents })),
      }).success,
    ).toBe(true);
    expect(
      loanOffsetsInputSchema.safeParse({ accountIds: pr.loans[0]!.offsetAccountIds }).success,
    ).toBe(true);
  });
});
