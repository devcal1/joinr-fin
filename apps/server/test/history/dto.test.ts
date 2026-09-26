// The Stage 5 DTO mapping (stage-5.md §4.4, §7.4 step 2): the engine results the DTOs mirror,
// type level (`@joinr/schema` cannot import the engine's types, so the server typecheck keeps each
// engine result assignable to its DTO, Cents → number, and the schema's figure shape and the
// engine's mutually assignable), and field by field at run time against hand-built results (every
// field distinct, so a swapped field fails). Generic values only.
import type {
  MarginalRateSuggestion,
  NetWorthBreakdown,
  NetWorthChange,
  RollingNetWorthRow,
  SnapshotDifference,
  SnapshotFigures,
  SnapshotGroup,
  TrendResult,
} from '@joinr/engine';
import {
  SNAPSHOT_FIGURE_COLUMNS,
  type MarginalRateSuggestionDto,
  type NetWorthBreakdownDto,
  type NetWorthChangeDto,
  type RollingNetWorthRowDto,
  type SnapshotAuditDto,
  type SnapshotDifferenceDto,
  type SnapshotFiguresDto,
  type SnapshotFiguresShape,
  type SnapshotGroupDto,
  type TrendDto,
} from '@joinr/schema';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { auditChanges, auditDetail, snapshotAuditDto } from '../../src/history/audit';
import {
  marginalRateSuggestionFields,
  netWorthBreakdownDto,
  netWorthChangeDto,
  rollingNetWorthRowDto,
  snapshotDifferenceDto,
  snapshotFiguresDto,
  snapshotGroupDto,
  trendDto,
} from '../../src/history/dto';
import { monthWords, snapshotExistsMessage } from '../../src/history/constants';

describe('Stage 5 engine results → DTOs (type level, §4.4)', () => {
  it('SnapshotFigures ⇄ SnapshotFiguresShape (both directions)', () => {
    expectTypeOf<SnapshotFigures>().toExtend<SnapshotFiguresShape>();
    expectTypeOf<SnapshotFiguresShape>().toExtend<SnapshotFigures>();
  });

  it('SnapshotFigures is assignable to SnapshotFiguresDto', () => {
    expectTypeOf<SnapshotFigures>().toExtend<SnapshotFiguresDto>();
  });

  it('NetWorthBreakdown is assignable to NetWorthBreakdownDto', () => {
    expectTypeOf<NetWorthBreakdown>().toExtend<NetWorthBreakdownDto>();
  });

  it('SnapshotGroup is assignable to SnapshotGroupDto', () => {
    expectTypeOf<SnapshotGroup>().toExtend<SnapshotGroupDto>();
  });

  it('RollingNetWorthRow (breakdown → netWorth) is assignable to RollingNetWorthRowDto', () => {
    type Renamed = Omit<RollingNetWorthRow, 'breakdown'> & {
      netWorth: RollingNetWorthRow['breakdown'];
    };
    expectTypeOf<Renamed>().toExtend<RollingNetWorthRowDto>();
  });

  it('TrendResult is assignable to TrendDto', () => {
    expectTypeOf<TrendResult>().toExtend<TrendDto>();
  });

  it('MarginalRateSuggestion is assignable to MarginalRateSuggestionDto (less the server fields)', () => {
    expectTypeOf<MarginalRateSuggestion>().toExtend<
      Omit<MarginalRateSuggestionDto, 'checkedOn' | 'currentRatio' | 'matches'>
    >();
  });

  it('NetWorthChange and SnapshotDifference are assignable to their DTOs', () => {
    expectTypeOf<NetWorthChange>().toExtend<NetWorthChangeDto>();
    expectTypeOf<SnapshotDifference>().toExtend<SnapshotDifferenceDto>();
  });
});

/** A figure set with a distinct value in every column. */
function distinctFigures(): SnapshotFigures {
  const out: Record<string, unknown> = {};
  SNAPSHOT_FIGURE_COLUMNS.forEach((c, i) => {
    out[c] = c.endsWith('Ratio')
      ? `0.${String(i + 1).padStart(2, '0')}`
      : c === 'superMeasuredThrough'
        ? '2026-08-27'
        : (i + 1) * 101;
  });
  return out as unknown as SnapshotFigures;
}

const breakdown = (base: number): NetWorthBreakdown => ({
  liquidCents: base + 1,
  superCents: base + 2,
  propertyCents: base + 3,
  liabilitiesCents: -(base + 4),
  offsetsCents: base + 5,
  netWorthCents: base + 6,
  missing: ['cryptoValueCents'],
});

describe('the mappers copy every field (§4.4)', () => {
  it('figures: exactly the 40 columns, unchanged', () => {
    const f = distinctFigures();
    const dto = snapshotFiguresDto({ ...f, extra: 1 } as SnapshotFigures);
    expect(dto).toEqual(f);
    expect(Object.keys(dto)).toEqual([...SNAPSHOT_FIGURE_COLUMNS]);
  });

  it('breakdown, difference, change, group, rolling row and trend', () => {
    const b = breakdown(1000);
    const dto = netWorthBreakdownDto(b);
    expect(dto).toEqual(b);
    expect(dto.missing).not.toBe(b.missing);

    const d: SnapshotDifference = {
      column: 'etfMovementsCents',
      kind: 'movement',
      storedCents: 1,
      recomputedCents: 2,
      storedRatio: null,
      recomputedRatio: '0.3',
    };
    expect(snapshotDifferenceDto(d)).toEqual(d);

    expect(netWorthChangeDto({ base: null, cents: null, ratio: null })).toEqual({
      base: null,
      cents: null,
      ratio: null,
    });
    const change: NetWorthChange = {
      base: { periodMonth: '2026-06', runDate: '2026-06-30', netWorthCents: 7 },
      cents: 8,
      ratio: '0.9',
    };
    expect(netWorthChangeDto(change)).toEqual(change);

    const g: SnapshotGroup = {
      label: 'Q3 2026',
      period: '2026-09',
      date: '2026-09-24',
      live: true,
      rows: 3,
      figures: distinctFigures(),
      netWorth: breakdown(2000),
      growthCents: 11,
      liquidGrowthCents: 12,
    };
    expect(snapshotGroupDto(g)).toEqual(g);

    const row: RollingNetWorthRow = {
      periodMonth: '2026-08',
      runDate: '2026-08-31',
      status: 'recorded',
      source: 'late',
      breakdown: breakdown(3000),
      growthCents: 21,
      liquidGrowthCents: 22,
      savingsRatio: '0.23',
      rawSavingsRatio: '0.24',
      projectedLiquidCents: 25,
    };
    const { breakdown: rowBreakdown, ...rest } = row;
    expect(rollingNetWorthRowDto(row)).toEqual({ ...rest, netWorth: rowBreakdown });
    expect(
      rollingNetWorthRowDto({ ...row, status: 'projected', breakdown: null, runDate: null })
        .netWorth,
    ).toBeNull();

    const trend: TrendResult = { fittedCents: [1, null, 3], slopePerMonthCents: 4, points: 2 };
    expect(trendDto(trend)).toEqual(trend);
  });

  it('the tax suggestion’s engine fields', () => {
    const s: MarginalRateSuggestion = {
      financialYear: 2026,
      tableFinancialYear: 2026,
      tableCurrent: true,
      incomeCents: 10000000,
      bracket: { thresholdCents: 4500000, toCents: 13500000, ratio: '0.3' },
      bracketRatio: '0.3',
      medicare: {
        thresholdCents: 2801100,
        thresholdFinancialYear: 2025,
        ratio: '0.02',
        band: 'full',
      },
      suggestedRatio: '0.32',
      incomeTaxCents: 2000000,
      medicareLevyCents: 200000,
      litoPhaseOut: false,
    };
    expect(marginalRateSuggestionFields(s)).toEqual(s);
  });
});

describe('the audit rows (§3.1, §4.4 SnapshotAuditDto)', () => {
  it('maps the changes in stored order and the record context', () => {
    const dto: SnapshotAuditDto = snapshotAuditDto({
      id: 4,
      periodMonth: '2026-08',
      snapshotId: 9,
      action: 'correct',
      trigger: 'manual',
      at: '2026-09-24T02:00:00.000Z',
      changesJson: JSON.stringify({
        cashValueCents: { before: 100, after: 200 },
        cashIncreaseRatio: { before: '0.1', after: '0.2' },
        '2026-09.cashGainCents': { before: 5, after: null },
      }),
      snapshotJson: null,
      note: 'Bank statement',
      detailJson: null,
    });
    expect(dto).toEqual({
      id: 4,
      periodMonth: '2026-08',
      action: 'correct',
      trigger: 'manual',
      at: '2026-09-24T02:00:00.000Z',
      note: 'Bank statement',
      changes: [
        { key: 'cashValueCents', before: 100, after: 200 },
        { key: 'cashIncreaseRatio', before: '0.1', after: '0.2' },
        { key: '2026-09.cashGainCents', before: 5, after: null },
      ],
      detail: null,
    });
  });

  it('reads the detail, and tolerates malformed JSON', () => {
    expect(
      auditDetail(
        JSON.stringify({
          pricesAsOf: '2026-09-24T01:00:00.000Z',
          marketMode: 'fake',
          pricesRefreshed: true,
          pricesAgeMs: 5,
          jobRunId: 3,
        }),
      ),
    ).toEqual({
      pricesAsOf: '2026-09-24T01:00:00.000Z',
      marketMode: 'fake',
      pricesRefreshed: true,
    });
    expect(auditDetail('{"marketMode":"weird"}')).toEqual({
      pricesAsOf: null,
      marketMode: null,
      pricesRefreshed: null,
    });
    expect(auditDetail('not json')).toBeNull();
    expect(auditDetail(null)).toBeNull();
    expect(auditChanges('[1,2]')).toEqual([]);
    expect(auditChanges('{"a":3}')).toEqual([{ key: 'a', before: null, after: null }]);
  });
});

describe('month words and messages (§4.1)', () => {
  it('names months as "Mar 2027" and dates as dd/mm/yyyy', () => {
    expect(monthWords('2027-03')).toBe('Mar 2027');
    expect(monthWords('2026-12')).toBe('Dec 2026');
    expect(snapshotExistsMessage('2027-03', '2027-03-31')).toBe(
      'Mar 2027 is already recorded (31/03/2027). Correct it instead.',
    );
  });
});
