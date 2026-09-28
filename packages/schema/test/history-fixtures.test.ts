// The Stage 5 fixtures (stage-5.md §3.6) are internally consistent: every breakdown is the §2.6
// sum of its figures, assets − liabilities = net worth, the drawn slices add to 1, the rolling
// growth is the change in net worth, a chart group's `end` columns are its last row's, the history
// rows and audit agree, request bodies built from them parse, and they cover every state.
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  isApiErrorBody,
  makeRecordRequestSchema,
  monthEndOf,
  NET_WORTH_CLASSES,
  NET_WORTH_LIABILITIES,
  NET_WORTH_STACK_ORDER,
  RECORD_TRIGGERS,
  SETTING_GROUPS,
  SETTING_KEYS,
  SNAPSHOT_AUDIT_ACTIONS,
  SNAPSHOT_COLUMN_MODES,
  SNAPSHOT_FIGURE_COLUMNS,
  SNAPSHOT_SOURCES,
  snapshotCorrectionSchema,
  type NetWorthBreakdownDto,
  type SnapshotDifferenceDto,
  type SnapshotFiguresDto,
  type SnapshotGroupDto,
} from '../src/index';
import * as f from '../src/fixtures/index';

const n0 = (v: number | string | null) => (v === null ? 0 : Number(v));

/** §2.6 step 1, recomputed from the figures. */
function netWorthOf(x: SnapshotFiguresDto): Omit<NetWorthBreakdownDto, 'missing'> {
  const liquid =
    n0(x.stocksValueCents) +
    n0(x.etfValueCents) +
    n0(x.cryptoValueCents) +
    n0(x.cashValueCents) +
    n0(x.mfValueCents) +
    n0(x.otherValueCents);
  const liabilities =
    -Math.abs(n0(x.liabilitiesBalanceCents)) - Math.abs(n0(x.mortgageBalanceCents));
  return {
    liquidCents: liquid,
    superCents: n0(x.superValueCents),
    propertyCents: n0(x.propertyValueCents),
    liabilitiesCents: liabilities === 0 ? 0 : liabilities,
    offsetsCents: n0(x.offsetCents),
    netWorthCents:
      liquid + n0(x.superValueCents) + n0(x.propertyValueCents) + liabilities + n0(x.offsetCents),
  };
}

/** The sheet ratio (§2.1) of a gain and a value, to 12 significant digits. */
const sheetRatioOk = (r: string | null, g: number | null, v: number | null) => {
  if (g === null || v === null || v - g === 0) return r === '0';
  const want = g / (v - g);
  return r !== null && Math.abs(Number(r) - want) <= 1e-11 * Math.max(1, Math.abs(want));
};

const RATIO_PAIRS = [
  ['stocksGainRatio', 'stocksGainCents', 'stocksValueCents'],
  ['etfGainRatio', 'etfGainCents', 'etfValueCents'],
  ['cryptoGainRatio', 'cryptoGainCents', 'cryptoValueCents'],
  ['cashIncreaseRatio', 'cashGainCents', 'cashValueCents'],
  ['superGainRatio', 'superGainCents', 'superValueCents'],
  ['propertyGainRatio', 'propertyGainCents', 'propertyValueCents'],
  ['mfGainRatio', 'mfGainCents', 'mfValueCents'],
] as const;

function expectFigures(x: SnapshotFiguresDto, where: string) {
  expect(Object.keys(x), where).toEqual([...SNAPSHOT_FIGURE_COLUMNS]);
  for (const [r, g, v] of RATIO_PAIRS) {
    expect(sheetRatioOk(x[r], x[g], x[v]), `${where} ${r}`).toBe(true);
  }
  // Z = X + AB + linked offsets (D67).
  expect(x.propertyEquityCents, `${where} Z`).toBe(
    n0(x.propertyValueCents) + n0(x.mortgageBalanceCents) + n0(x.mortgageOffsetCents),
  );
  if (x.cashDebtCents !== null) expect(x.cashDebtCents, where).toBeLessThanOrEqual(0);
  if (x.offsetCents !== null) expect(x.offsetCents, where).toBeGreaterThanOrEqual(0);
}

function expectBreakdown(x: SnapshotFiguresDto, b: NetWorthBreakdownDto, where: string) {
  expect(b, where).toMatchObject(netWorthOf(x));
}

describe('netWorthPages (§4.4, §2.6)', () => {
  for (const [name, p] of Object.entries(f.netWorthPages)) {
    it(`${name}: the breakdown, classes and liabilities add up`, () => {
      expectFigures(p.live.figures, name);
      expectBreakdown(p.live.figures, p.live.netWorth, name);
      expect(p.classes.map((c) => c.key)).toEqual([...NET_WORTH_CLASSES]);
      expect(p.liabilities.map((l) => l.key)).toEqual([...NET_WORTH_LIABILITIES]);
      const assets = p.classes.reduce((a, c) => a + c.valueCents, 0);
      const liabilities = p.liabilities.reduce((a, l) => a + l.balanceCents, 0);
      expect(p.assetsCents).toBe(assets);
      expect(p.liabilitiesCents).toBe(liabilities);
      expect(assets - liabilities, 'assets − liabilities = net worth').toBe(
        p.live.netWorth.netWorthCents,
      );
      const sup = p.classes.find((c) => c.key === 'super')!;
      expect(p.assetsExSuperCents).toBe(assets - sup.valueCents);
      for (const l of p.liabilities) {
        expect(l.balanceCents).toBeGreaterThanOrEqual(0);
        expect(l.balanceCents).toBe(l.grossCents - l.offsetCents);
      }
      for (const c of p.classes) {
        if (c.gainCents === null || c.valueCents - c.gainCents === 0)
          expect(c.gainRatio).toBeNull();
        else expect(sheetRatioOk(c.gainRatio, c.gainCents, c.valueCents)).toBe(true);
      }
    });

    it(`${name}: the per-loan mortgage lines add up to the Mortgages row (SPEC-1)`, () => {
      const m = p.liabilities.find((l) => l.key === 'mortgages')!;
      const lines = p.mortgageLoans ?? [];
      if (m.grossCents === 0) {
        expect(lines).toEqual([]);
        return;
      }
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.reduce((a, l) => a + l.grossCents, 0)).toBe(m.grossCents);
      expect(lines.reduce((a, l) => a + l.offsetCents, 0)).toBe(m.offsetCents);
      for (const l of lines) {
        expect(l.offsetCents).toBeGreaterThanOrEqual(0);
        expect(l.offsetCents).toBeLessThanOrEqual(l.grossCents);
        expect(l.balanceCents).toBe(l.grossCents - l.offsetCents);
      }
      expect(new Set(lines.map((l) => l.loanId)).size).toBe(lines.length);
    });

    it(`${name}: the distribution (values before the drop, slices in stack order, ratios add to 1)`, () => {
      const d = p.distribution;
      expect(d.values.map((v) => v.key)).toEqual([...NET_WORTH_STACK_ORDER]);
      const sumValues = d.values.reduce((a, v) => a + v.valueCents, 0);
      expect(sumValues).toBe(
        p.live.netWorth.netWorthCents + Math.abs(n0(p.live.figures.liabilitiesBalanceCents)),
      );
      expect(d.slices.map((s) => s.key)).toEqual(
        d.values.filter((v) => v.valueCents > 0).map((v) => v.key),
      );
      expect(d.excluded).toEqual(d.values.filter((v) => v.valueCents < 0));
      expect(d.drawnCents).toBe(d.slices.reduce((a, s) => a + s.valueCents, 0));
      expect(Math.abs(d.slices.reduce((a, s) => a + Number(s.ratio), 0) - 1)).toBeLessThan(1e-9);
      expect(d.slices.length).toBeLessThanOrEqual(8);
    });

    it(`${name}: the changes, the rolling table and the charts`, () => {
      const nw = p.live.netWorth.netWorthCents;
      for (const ch of [p.sinceLastRecord, p.thisYear]) {
        if (ch.base === null) {
          expect(ch.cents).toBeNull();
          continue;
        }
        expect(ch.cents).toBe(nw - ch.base.netWorthCents);
        expect(Number(ch.ratio)).toBeCloseTo(ch.cents / Math.abs(ch.base.netWorthCents), 10);
      }
      if (p.sinceLastRecord.base) expect(p.sinceLastRecord.base.runDate < p.asOf).toBe(true);
      if (p.thisYear.base)
        expect(monthEndOf(p.thisYear.base.periodMonth) < p.thisYear.year.start).toBe(true);
      // Rolling: recorded, live, projected; growth = Δ net worth.
      const rows = p.rolling;
      const statuses = rows.map((r) => r.status);
      const rank = (x: string) => ['recorded', 'live', 'projected'].indexOf(x);
      expect([...statuses].sort((a, b) => rank(a) - rank(b))).toEqual(statuses);
      expect(statuses.includes('live')).toBe(!p.recordedToday);
      const known = rows.filter((r) => r.status !== 'projected');
      known.forEach((r, i) => {
        if (i === 0) expect(r.growthCents).toBeNull();
        else {
          expect(r.growthCents).toBe(
            r.netWorth.netWorthCents - known[i - 1]!.netWorth.netWorthCents,
          );
          expect(r.liquidGrowthCents).toBe(
            r.netWorth.liquidCents - known[i - 1]!.netWorth.liquidCents,
          );
        }
        expect(r.projectedLiquidCents).toBe(r.netWorth.liquidCents);
      });
      const projected = rows.filter((r) => r.status === 'projected');
      expect(projected.length).toBe(p.averageSavings.monthCents === null ? 0 : 12);
      projected.forEach((r, k) => {
        expect(r.projectedLiquidCents).toBe(
          known.at(-1)!.netWorth.liquidCents + (k + 1) * p.averageSavings.monthCents!,
        );
      });
      // Charts: one unit for every chart; the live group only when there is a provisional period.
      expect(p.charts.groups.some((g) => g.live)).toBe(!p.recordedToday);
      expect(p.charts.savings.map((s) => s.label)).toEqual(p.charts.groups.map((g) => g.label));
      expect(p.charts.trends.liquid.fittedCents).toHaveLength(p.charts.groups.length);
      expect(p.charts.trends.tracker.fittedCents).toHaveLength(p.charts.groups.length);
      for (const g of p.charts.groups) {
        expectFigures(g.figures, `${name} ${g.label}`);
        expectBreakdown(g.figures, g.netWorth, `${name} ${g.label}`);
      }
      if (p.averageSavings.monthCents !== null) {
        expect(p.averageSavings.yearCents).toBe(p.averageSavings.monthCents * 12);
      }
    });
  }

  it('populated: every class non-zero, eight slices (D93), a linked and an unlinked offset', () => {
    const p = f.netWorthPages.populated;
    for (const c of p.classes) expect(c.valueCents, c.key).not.toBe(0);
    expect(p.distribution.slices).toHaveLength(8);
    expect(p.distribution.excluded).toEqual([]);
    expect(p.liabilities.find((l) => l.key === 'mortgages')!.offsetCents).toBeGreaterThan(0);
    expect(p.liabilities.find((l) => l.key === 'cash_debit')!.balanceCents).toBeGreaterThan(0);
    expect(p.classes.find((c) => c.key === 'offsets')!.valueCents).toBeGreaterThan(0);
    expect(p.savingsRate.targetRatio).not.toBeNull();
    expect(p.charts.trends.liquid.slopePerMonthCents).not.toBeNull();
  });

  it('the other states show what their names say', () => {
    const s = f.netWorthPages;
    expect(s.negativeEquity.distribution.excluded.map((e) => e.key)).toEqual(['property']);
    expect(s.noSnapshots.lastRun).toBeNull();
    expect(s.noSnapshots.rolling.map((r) => r.status)).toEqual(['live']);
    expect(s.noSavings.savingsRate.ratio).toBeNull();
    expect(s.noSavings.savingsRate.periods).toBe(0);
    expect(s.quarterly.charts.unit).toBe('quarterly');
    expect(s.quarterly.charts.groups.map((g) => g.label).at(-1)).toMatch(/^Q\d \d{4}$/);
    expect(s.yearly.charts.groups.map((g) => g.label)).toEqual(['FY2025–26', 'FY2026–27']);
    expect(s.calendarYear.thisYear.year.basis).toBe('calendar');
    expect(s.calendarYear.charts.yearBasis).toBe('calendar');
    expect(s.recordedToday.recordedToday).toBe(true);
    expect(s.recordedToday.recordable).toEqual([]);
    expect(
      s.otherDebts.liabilities.find((l) => l.key === 'other_debts')!.balanceCents,
    ).toBeGreaterThan(0);
    expect(s.otherDebts.charts.groups.every((g) => g.figures.liabilitiesBalanceCents < 0)).toBe(
      true,
    );
    const off = s.autoRecordOffNoAppData;
    expect(off.hasAppData).toBe(false);
    expect(off.recorder.autoRecord.enabled).toBe(false);
    expect(monthEndOf(off.liveMonth) < off.asOf).toBe(true);
    expect(off.recordable).toContain(off.liveMonth);
  });

  it('groups by quarter and year with the §2.7 modes (end, sum, ratio)', () => {
    const monthly = f.netWorthPages.populated.charts.groups;
    for (const state of [f.netWorthPages.quarterly, f.netWorthPages.yearly]) {
      for (const g of state.charts.groups) {
        const members = monthly.filter((m) =>
          state.charts.unit === 'quarterly'
            ? m.period.slice(0, 4) === g.period.slice(0, 4) &&
              Math.ceil(Number(m.period.slice(5)) / 3) === Math.ceil(Number(g.period.slice(5)) / 3)
            : monthEndOf(m.period) >= `${g.label.slice(2, 6)}-07-01` &&
              monthEndOf(m.period) < `${Number(g.label.slice(2, 6)) + 1}-07-01`,
        );
        // The populated monthly view shows the last 12 months, so only compare full groups.
        if (members.length !== g.rows) continue;
        const last = members.at(-1)!;
        expect(g.period).toBe(last.period);
        expect(g.live).toBe(last.live);
        for (const c of SNAPSHOT_FIGURE_COLUMNS) {
          const mode = SNAPSHOT_COLUMN_MODES[c];
          if (mode === 'end') expect(g.figures[c], `${g.label} ${c}`).toBe(last.figures[c]);
          if (mode === 'sum') {
            const vs = members.map((m) => m.figures[c]).filter((v) => v !== null) as number[];
            expect(g.figures[c], `${g.label} ${c}`).toBe(
              vs.length === 0 ? null : vs.reduce((a, b) => a + b, 0),
            );
          }
        }
        const sumOf = (sel: (m: SnapshotGroupDto) => number | null) => {
          const vs = members.map(sel).filter((v) => v !== null);
          return vs.length === 0 ? null : vs.reduce((a, b) => a + b, 0);
        };
        expect(g.growthCents).toBe(sumOf((m) => m.growthCents));
      }
    }
  });
});

describe('historyPages (§4.4)', () => {
  for (const [name, p] of Object.entries(f.historyPages)) {
    it(`${name}: rows newest first, figures, checks and the live row`, () => {
      const rows = p.snapshots;
      const byRun = [...rows].reverse();
      for (let i = 1; i < byRun.length; i += 1) {
        const a = byRun[i - 1]!;
        const b = byRun[i]!;
        expect(
          a.runDate < b.runDate || (a.runDate === b.runDate && a.periodMonth < b.periodMonth),
        ).toBe(true);
      }
      for (const r of rows) {
        expectFigures(r.figures, `${name} ${r.periodMonth}`);
        expectBreakdown(r.figures, r.netWorth, `${name} ${r.periodMonth}`);
        expect(r.late).toBe(r.source === 'late' || r.source === 'lookback');
        expect(r.sharedRunDate).toBe(rows.some((x) => x !== r && x.runDate === r.runDate));
        expect(r.deletable).toBe(r === rows[0] && r.source !== 'migrated');
        expect(r.check.checked).toBe(13);
        if (r.source === 'migrated') {
          expect(r.recordedAt).toBeNull();
          expect(r.figures.offsetCents).toBeNull();
        } else {
          expect(r.origin).toBe('app');
          expect(r.figures.offsetCents).not.toBeNull();
        }
      }
      // O chains to the previous row (run-date order).
      for (let i = 1; i < byRun.length; i += 1) {
        expect(byRun[i]!.figures.cashGainCents).toBe(
          n0(byRun[i]!.figures.cashValueCents) - n0(byRun[i - 1]!.figures.cashValueCents),
        );
      }
      if (p.live) {
        expectFigures(p.live.figures, `${name} live`);
        expectBreakdown(p.live.figures, p.live.netWorth, `${name} live`);
        expect(p.live.periodMonth).toBe(p.record.nextMonth);
      }
      const c = p.consistency;
      expect(c.checked).toBe(rows.length * 13);
      expect(c.matched).toBe(c.checked - c.movementDifferences - c.derivedDifferences);
      expect(c.migratedMonths).toBe(rows.filter((r) => r.source === 'migrated').length);
      const diffs: SnapshotDifferenceDto[] = rows.flatMap((r) => r.check.differences);
      expect(c.movementDifferences).toBe(diffs.filter((d) => d.kind === 'movement').length);
      expect(c.derivedDifferences).toBe(diffs.filter((d) => d.kind === 'derived').length);
      expect(c.movementMonths).toEqual(
        byRun
          .filter((r) => r.check.differences.some((d) => d.kind === 'movement'))
          .map((r) => r.periodMonth),
      );
      // Audit newest first; every correct names a reason.
      for (let i = 1; i < p.audit.length; i += 1)
        expect(p.audit[i - 1]!.at >= p.audit[i]!.at).toBe(true);
      for (const a of p.audit) if (a.action === 'correct') expect(a.note).toBeTruthy();
      // Record: the recordable months follow the latest snapshot; the missing ones have ended.
      for (const m of p.record.missing) expect(p.record.recordable).toContain(m);
      for (const m of p.record.defaultMonths) expect(p.record.recordable).toContain(m);
      expect(p.recorder.recordHour).toBe(23);
      expect(p.charts.groups.some((g) => g.live)).toBe(p.live !== null);
    });
  }

  it('populated covers the markers: late pair, look-back, corrections, a movement difference', () => {
    const p = f.historyPages.populated;
    const src = (m: string) => p.snapshots.find((s) => s.periodMonth === m)!;
    expect(src('2026-04').sharedRunDate && src('2026-05').sharedRunDate).toBe(true);
    expect(src('2026-07').source).toBe('lookback');
    expect(p.snapshots.filter((s) => s.revision === 1).map((s) => s.periodMonth)).toEqual([
      '2026-06',
      '2026-01',
    ]);
    expect(src('2026-01').origin).toBe('app');
    expect(p.consistency.movementMonths).toEqual(['2026-02']);
    expect(p.record.missing).toEqual(['2026-08']);
    expect(p.recorder.autoRecord.enabled).toBe(true);
    expect(p.recorder.nextRunAt).not.toBeNull();
    expect(f.historyPages.autoRecordBlocked.recorder.blocked).toEqual({
      periodMonth: '2026-09',
      missing: ['2026-08'],
    });
    expect(f.historyPages.envLocked.recorder.autoRecord.source).toBe('env');
    expect(f.historyPages.nothingToRecord.record.recordable).toEqual([]);
    expect(f.historyPages.nothingToRecord.live).toBeNull();
    expect(f.historyPages.recordInProgress.recorder.running).toBe(true);
  });

  it('builds valid request bodies from the fixtures', () => {
    const p = f.historyPages.populated;
    const schema = makeRecordRequestSchema(() => new Date(2026, 8, 24, 14, 32));
    expect(schema.safeParse({ periodMonths: p.record.recordable, note: '' }).success).toBe(true);
    expect(schema.safeParse({ periodMonths: p.record.defaultMonths, note: null }).success).toBe(
      true,
    );
    const correct = p.audit.find((a) => a.action === 'correct' && a.periodMonth === '2026-06')!;
    const values = Object.fromEntries(
      correct.changes.filter((c) => c.key === 'cashValueCents').map((c) => [c.key, c.after]),
    );
    expect(snapshotCorrectionSchema.safeParse({ values, note: correct.note }).success).toBe(true);
    // The correction's "after" figures are the stored ones.
    const jun = p.snapshots.find((s) => s.periodMonth === '2026-06')!;
    const jul = p.snapshots.find((s) => s.periodMonth === '2026-07')!;
    for (const c of correct.changes) {
      const [month, column] = c.key.includes('.') ? c.key.split('.') : ['2026-06', c.key];
      const row = month === '2026-07' ? jul : jun;
      expect(row.figures[column as keyof SnapshotFiguresDto], c.key).toBe(c.after);
    }
  });

  it('the mutation examples match the pages', () => {
    const p = f.historyPages.populated;
    expect(f.recordResponse.recorded.map((r) => r.periodMonth)).toEqual(['2026-08']);
    expect(f.recordResponse.recorded[0]!.deletable).toBe(true);
    expect(f.correctionResponse.snapshot).toEqual(
      p.snapshots.find((s) => s.periodMonth === '2026-06'),
    );
    expect(f.correctionResponse.next).toEqual(p.snapshots.find((s) => s.periodMonth === '2026-07'));
    expect(f.correctionResponse.audit.action).toBe('correct');
    expect(f.deleteSnapshotResponse.audit.action).toBe('delete');
    expect(f.deleteSnapshotResponse.periodMonth).toBe(p.snapshots[0]!.periodMonth);
    expect(f.autoRecordPatchResponse.settings.values).toEqual({ 'history.autoRecord': true });
  });
});

describe('settingsPages (§4.4)', () => {
  for (const [name, p] of Object.entries(f.settingsPages)) {
    it(`${name}: every key in registry order with its group, origin and lock`, () => {
      expect(p.settings.map((s) => s.key)).toEqual([...SETTING_KEYS]);
      expect(p.groups.map((g) => g.id)).toEqual(SETTING_GROUPS.map((g) => g.id));
      for (const s of p.settings) {
        expect(p.groups.find((g) => g.id === s.group)!.keys as string[]).toContain(s.key);
        expect(s.editable).toBe(s.key !== 'super.concessionalCapFy');
        if (s.origin === null) expect(s.value).toBeNull();
        if (s.preference) expect(s.workbook).toBe(false);
      }
      const workbookAppRows = p.settings.filter((s) => s.workbook && s.origin === 'app');
      expect(p.hasAppData).toBe(workbookAppRows.length > 0);
      const alloc = p.settings.filter(
        (s) => s.key.startsWith('allocation.') && typeof s.value === 'string',
      );
      const sum = alloc.reduce((a, s) => a + Number(s.value), 0);
      expect(Number(p.allocationSumRatio)).toBeCloseTo(sum, 12);
    });
  }

  it('the tax suggestion follows §2.10 for each Medicare band and the LITO range', () => {
    const s = f.settingsPages;
    const t = s.populated.taxSuggestion;
    expect(t.medicare.band).toBe('full');
    expect(t.suggestedRatio).toBe('0.32');
    expect(t.bracketRatio).toBe('0.3');
    expect(t.financialYear).toBe(2026);
    expect(t.tableCurrent).toBe(true);
    expect(t.medicare.thresholdFinancialYear).toBe(2025);
    expect(t.incomeTaxCents).toBe(
      0.15 * (4_500_000 - 1_820_000) + 0.3 * (t.incomeCents - 4_500_000),
    );
    expect(t.matches).toBe('suggested');
    expect(s.taxShadeIn.taxSuggestion.medicare.band).toBe('shade_in');
    expect(s.taxShadeIn.taxSuggestion.medicareLevyCents).toBe(
      Math.round(0.1 * (s.taxShadeIn.taxSuggestion.incomeCents - 2_801_100)),
    );
    expect(s.taxNoLevy.taxSuggestion.medicare.band).toBe('none');
    expect(s.taxNoLevy.taxSuggestion.medicareLevyCents).toBe(0);
    expect(s.taxLito.taxSuggestion.litoPhaseOut).toBe(true);
    expect(s.taxLito.taxSuggestion.matches).toBe('bracket');
    expect(s.noSalary.taxSuggestion).toBeNull();
    expect(s.unbalanced.allocationSumRatio).toBe('1.02');
    expect(s.populated.allocationSumRatio).toBe('1');
    expect(s.envLocked.settings.find((x) => x.key === 'history.autoRecord')!.lockedBy).toBe('env');
    expect(s.envLocked.recorder.autoRecord.source).toBe('env');
    expect(
      s.featuresOff.settings.filter((x) => x.key.startsWith('features.') && x.value === false),
    ).toHaveLength(2);
    expect(s.populated.settings.find((x) => x.key === 'super.concessionalCapFy')!.lockedBy).toBe(
      'server',
    );
  });
});

describe('coverage and error bodies (§3.6)', () => {
  it('covers every snapshot source, class, liability, audit action, trigger and setting group', () => {
    const c = f.FIXTURE_COVERAGE;
    expect([...c.snapshotSources].sort()).toEqual([...SNAPSHOT_SOURCES].sort());
    expect([...c.netWorthClasses].sort()).toEqual([...NET_WORTH_CLASSES].sort());
    expect([...c.netWorthLiabilities].sort()).toEqual([...NET_WORTH_LIABILITIES].sort());
    expect([...c.snapshotAuditActions].sort()).toEqual([...SNAPSHOT_AUDIT_ACTIONS].sort());
    expect([...c.recordTriggers].sort()).toEqual([...RECORD_TRIGGERS].sort());
    expect([...c.settingGroups].sort()).toEqual(SETTING_GROUPS.map((g) => g.id).sort());
  });

  it('has an error body for each Stage 5 code', () => {
    const bodies = [
      f.apiErrors.snapshotExists,
      f.apiErrors.snapshotNotLatest,
      f.apiErrors.snapshotNotDeletable,
      f.apiErrors.recordInProgress,
      f.apiErrors.historyValidation,
    ];
    for (const body of bodies) {
      expect(isApiErrorBody(body)).toBe(true);
      expect(API_ERROR_CODES).toContain(body.error.code);
    }
    expect(bodies.map((b) => b.error.code).slice(0, 4)).toEqual(API_ERROR_CODES.slice(-8, -4));
  });

  it('keeps the records fixtures in step with the registry (the snapshot audit page)', () => {
    expect(f.recordsPages['snapshot-audit'].rows.length).toBeGreaterThan(0);
    const cols = f.recordsPages.snapshots.columns.map((c) => c.id);
    for (const row of f.recordsPages.snapshots.rows) {
      expect(Object.keys(row.cells).sort()).toEqual([...cols].sort());
    }
  });
});

describe('netWorthPages: the mortgage lines of the populated and negative-equity states', () => {
  it('populated has two loans; negativeEquity one', () => {
    expect(f.netWorthPages.populated.mortgageLoans?.map((l) => l.name)).toEqual([
      'Example home loan',
      'Example investment loan',
    ]);
    expect(f.netWorthPages.negativeEquity.mortgageLoans).toHaveLength(1);
  });
});
