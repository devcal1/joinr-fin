// `GET /api/super` (stage-4.md §4.2, §4.4, §6.4): the funds and their balance log (D69), the
// typed and imported contributions (D71), the SG months (estimates and statements), the periods
// with their derived gains and option notes, the annualised return, the concessional cap years
// (D70), the statutory figures and the charts. Every figure comes from the engine
// (`computeSuper`); the server adds names, notes, origins, counts and the savings period of each
// contribution.
import type {
  SuperCapYear,
  SuperChartPoint,
  SuperContributionResult,
  SuperFlows,
  SuperPeriod,
  SuperResult,
  SuperSgMonth,
} from '@joinr/engine';
import {
  financialYearOfIso,
  PAYDAY_SUPER_START,
  SUPER_CONCESSIONAL_CAPS,
  SUPER_RATES_CHECKED_ON,
  SUPER_SG_RATES,
  type DecimalString,
  type IsoDate,
  type IsoMonth,
  type PeriodNoteDto,
  type SuperBalanceEntryDto,
  type SuperCapYearDto,
  type SuperChartPointDto,
  type SuperContributionDto,
  type SuperFlowsDto,
  type SuperFundDto,
  type SuperPageResponse,
  type SuperPeriodDto,
  type SuperSgMonthDto,
} from '@joinr/schema';
import { periodNoteDto } from '../cashflow/cash';
import type { FinanceContext } from '../cashflow/context';
import { latestSnapshot } from '../cashflow/inputs';
import { settingsSliceDto } from '../cashflow/settings';
import { stringSetting } from '../db/queries/settings';
import type {
  InvestmentData,
  PeriodNoteRow,
  SuperBalanceEntryRow,
  SuperEntryRow,
  SuperFundRow,
} from '../investments/load';
import { SUPER_PAGE_SETTING_KEYS } from './constants';
import { capOverrideOf, chartOf, contributionsTaxRatioOf, isContributionKind } from './inputs';

// ─── Statutory figures (§3.2, §3.3) ─────────────────────────────────────────────────────────────

/** A statutory table's entries in FY order. */
function tableEntries<T>(
  table: Readonly<Record<number, T>>,
): { financialYear: number; value: T }[] {
  return Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b)
    .map((financialYear) => ({ financialYear, value: table[financialYear] as T }));
}

/** The statutory SG rate of an FY (the FY start year); an FY outside the table: its nearest entry. */
export function statutorySgRatio(financialYear: number): DecimalString {
  const entries = tableEntries(SUPER_SG_RATES);
  const exact = entries.find((e) => e.financialYear === financialYear);
  if (exact) return exact.value;
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  return financialYear < first.financialYear ? first.value : last.value;
}

/** The SG rate in use for the as-of month: your employer's rate (setting), else the statutory. */
export function sgRatioInUse(data: InvestmentData, asOf: IsoDate): DecimalString {
  return stringSetting(data.settings, 'super.sgRate') ?? statutorySgRatio(financialYearOfIso(asOf));
}

export function statutoryDto(data: InvestmentData, asOf: IsoDate): SuperPageResponse['statutory'] {
  return {
    sgRatio: sgRatioInUse(data, asOf),
    contributionsTaxRatio: contributionsTaxRatioOf(data.settings),
    checkedOn: SUPER_RATES_CHECKED_ON,
    paydaySuperStart: PAYDAY_SUPER_START,
    caps: tableEntries(SUPER_CONCESSIONAL_CAPS).map((e) => ({
      financialYear: e.financialYear,
      capCents: e.value,
    })),
    sgRates: tableEntries(SUPER_SG_RATES).map((e) => ({
      financialYear: e.financialYear,
      ratio: e.value,
    })),
  };
}

// ─── Funds and balance entries ──────────────────────────────────────────────────────────────────

/** Funds in sort order, archived last. */
export function sortFunds(funds: readonly SuperFundRow[]): SuperFundRow[] {
  return funds
    .map((f, i) => ({ f, i }))
    .sort((a, b) => Number(a.f.archived) - Number(b.f.archived) || a.i - b.i)
    .map((x) => x.f);
}

/** Contributions (never reported gains) that name the fund, by fund id. */
export function contributionCounts(entries: readonly SuperEntryRow[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of entries) {
    if (e.fundId === null || !isContributionKind(e.kind)) continue;
    out.set(e.fundId, (out.get(e.fundId) ?? 0) + 1);
  }
  return out;
}

export function superFundDtos(data: InvestmentData, result: SuperResult): SuperFundDto[] {
  const byId = new Map(result.funds.map((f) => [f.id, f]));
  const entryCounts = new Map<number, number>();
  for (const e of data.superBalanceEntries) {
    entryCounts.set(e.fundId, (entryCounts.get(e.fundId) ?? 0) + 1);
  }
  const contributions = contributionCounts(data.superEntries);
  const out: SuperFundDto[] = [];
  for (const f of sortFunds(data.superFunds)) {
    const r = byId.get(f.id);
    if (!r) continue;
    out.push({
      id: f.id,
      name: f.name,
      receivesSg: f.receivesSg,
      archived: f.archived,
      balanceCents: r.balanceCents,
      balanceAsOf: r.balanceAsOf,
      entryCount: entryCounts.get(f.id) ?? 0,
      contributionCount: contributions.get(f.id) ?? 0,
      sortOrder: f.sortOrder,
      origin: f.origin,
      sheetRef: f.sheetRef,
    });
  }
  return out;
}

/** Every balance entry, asOf desc (then id desc), with the engine's per-entry flows and gain. */
export function balanceEntryDtos(
  entries: readonly SuperBalanceEntryRow[],
  result: SuperResult,
): SuperBalanceEntryDto[] {
  const computed = new Map<number, { flowsCents: number | null; gainCents: number | null }>();
  for (const f of result.funds) for (const e of f.entries) computed.set(e.id, e);
  return [...entries]
    .sort((a, b) => (a.asOf !== b.asOf ? (a.asOf < b.asOf ? 1 : -1) : b.id - a.id))
    .map((e) => ({
      id: e.id,
      fundId: e.fundId,
      asOf: e.asOf,
      balanceCents: e.balanceCents,
      transferInCents: e.transferInCents,
      flowsCents: computed.get(e.id)?.flowsCents ?? null,
      gainCents: computed.get(e.id)?.gainCents ?? null,
      note: e.note,
      origin: e.origin,
      sheetRef: e.sheetRef,
    }));
}

// ─── Contributions ──────────────────────────────────────────────────────────────────────────────

/** The savings period a date falls in (its `(after, through]` window), or null (after the as-of). */
export function periodOfDate(
  periods: readonly Pick<SuperPeriod, 'periodMonth' | 'after' | 'through' | 'status'>[],
  date: IsoDate,
): { periodMonth: IsoMonth; provisional: boolean } | null {
  for (const p of periods) {
    if ((p.after === null || date > p.after) && date <= p.through) {
      return { periodMonth: p.periodMonth, provisional: p.status === 'provisional' };
    }
  }
  return null;
}

export function superContributionDto(
  e: SuperEntryRow,
  r: SuperContributionResult,
  o: { fundName: string | null; period: { periodMonth: IsoMonth; provisional: boolean } | null },
): SuperContributionDto {
  return {
    id: r.id,
    fundId: r.fundId,
    fundName: o.fundName,
    date: r.date,
    kind: r.kind,
    amountCents: r.amountCents,
    estimate: r.estimate,
    preTaxCents: r.preTaxCents,
    fundReceivesCents: r.fundReceivesCents,
    netPayCostCents: r.netPayCostCents,
    concessional: r.concessional,
    periodMonth: o.period?.periodMonth ?? null,
    provisional: o.period?.provisional ?? false,
    note: e.note,
    origin: e.origin,
    sheetRef: e.sheetRef,
  };
}

/** The engine's contributions (date desc, then id desc) joined with their rows. */
export function superContributionDtos(
  data: InvestmentData,
  result: SuperResult,
): SuperContributionDto[] {
  const rows = new Map(data.superEntries.map((e) => [e.id, e]));
  const funds = new Map(data.superFunds.map((f) => [f.id, f.name]));
  const out: SuperContributionDto[] = [];
  for (const r of result.contributions) {
    const e = rows.get(r.id);
    if (!e) continue;
    out.push(
      superContributionDto(e, r, {
        fundName: r.fundId === null ? null : (funds.get(r.fundId) ?? null),
        period: periodOfDate(result.periods, r.date),
      }),
    );
  }
  return out;
}

// ─── SG months, periods and notes ───────────────────────────────────────────────────────────────

export function sgMonthDto(m: SuperSgMonth, note: string | null): SuperSgMonthDto {
  return {
    month: m.month,
    source: m.source,
    grossCents: m.grossCents,
    fundReceivesCents: m.fundReceivesCents,
    fundId: m.fundId,
    capFinancialYear: m.capFinancialYear,
    note,
  };
}

/** The engine's SG months, month desc, each with its statement's note. */
export function sgMonthDtos(data: InvestmentData, result: SuperResult): SuperSgMonthDto[] {
  const notes = new Map(data.superSgOverrides.map((o) => [o.periodMonth, o.note]));
  return [...result.sgMonths]
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))
    .map((m) => sgMonthDto(m, notes.get(m.month) ?? null));
}

export function superFlowsDto(f: SuperFlows | null): SuperFlowsDto | null {
  if (f === null) return null;
  return {
    sgGrossCents: f.sgGrossCents,
    sgFundCents: f.sgFundCents,
    memberFundCents: f.memberFundCents,
    memberNetPayCents: f.memberNetPayCents,
    concessionalCents: f.concessionalCents,
    nonConcessionalCents: f.nonConcessionalCents,
    transferInCents: f.transferInCents,
  };
}

export function superPeriodDto(p: SuperPeriod, note: PeriodNoteDto | null): SuperPeriodDto {
  return {
    periodMonth: p.periodMonth,
    runDate: p.runDate,
    after: p.after,
    through: p.through,
    status: p.status,
    valueCents: p.valueCents,
    notUpdated: p.notUpdated,
    flows: superFlowsDto(p.flows),
    gainFrom: p.gainFrom,
    changeCents: p.changeCents,
    gainFlows: superFlowsDto(p.gainFlows),
    gainCents: p.gainCents,
    gainRatio: p.gainRatio,
    returnRatio: p.returnRatio,
    note,
  };
}

/** Every `super_option` note, month desc. */
export function superOptionNotes(notes: readonly PeriodNoteRow[]): PeriodNoteDto[] {
  return notes
    .filter((n) => n.kind === 'super_option')
    .sort((a, b) =>
      a.periodMonth !== b.periodMonth ? (a.periodMonth < b.periodMonth ? 1 : -1) : b.id - a.id,
    )
    .map(periodNoteDto)
    .filter((n): n is PeriodNoteDto => n !== null);
}

export function superCapYearDto(y: SuperCapYear): SuperCapYearDto {
  return {
    financialYear: y.financialYear,
    start: y.start,
    end: y.end,
    complete: y.complete,
    capCents: y.capCents,
    capSource: y.capSource,
    sgGrossCents: y.sgGrossCents,
    sgFundCents: y.sgFundCents,
    sgSource: y.sgSource,
    salarySacrificeCents: y.salarySacrificeCents,
    importedEstimateCents: y.importedEstimateCents,
    totalCents: y.totalCents,
    projectedCents: y.projectedCents,
    ratio: y.ratio,
    projectedRatio: y.projectedRatio,
    status: y.status,
    nonConcessionalCents: y.nonConcessionalCents,
    memberCents: y.memberCents,
    memberFundCents: y.memberFundCents,
    memberNetPayCents: y.memberNetPayCents,
    estimateCount: y.estimateCount,
  };
}

export function superChartPointDto(p: SuperChartPoint): SuperChartPointDto {
  return {
    label: p.label,
    period: p.period,
    date: p.date,
    live: p.live,
    valueCents: p.valueCents,
    gainCents: p.gainCents,
    returnRatio: p.returnRatio,
    memberNetPayCents: p.memberNetPayCents,
    memberFundCents: p.memberFundCents,
    sgFundCents: p.sgFundCents,
  };
}

// ─── The page ───────────────────────────────────────────────────────────────────────────────────

export function buildSuperPage(ctx: FinanceContext): SuperPageResponse {
  const { data } = ctx;
  const result = ctx.superResult();
  const notes = superOptionNotes(data.periodNotes);
  const noteByMonth = new Map<string, PeriodNoteDto>();
  // Month desc: the first note seen for a month is its newest row.
  for (const n of notes) if (!noteByMonth.has(n.periodMonth)) noteByMonth.set(n.periodMonth, n);
  const { unit, count } = chartOf(data.settings);
  return {
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    lastRun: latestSnapshot(data.snapshots)?.runDate ?? null,
    totalCents: result.totalCents,
    funds: superFundDtos(data, result),
    balanceEntries: balanceEntryDtos(data.superBalanceEntries, result),
    contributions: superContributionDtos(data, result),
    sgMonths: sgMonthDtos(data, result),
    periods: [...result.periods]
      .reverse()
      .map((p) => superPeriodDto(p, noteByMonth.get(p.periodMonth) ?? null)),
    notes,
    annualised: {
      cumulativeRatio: result.annualised.cumulativeRatio,
      returnRatio: result.annualised.returnRatio,
      from: result.annualised.from,
      through: result.annualised.through,
      days: result.annualised.days,
    },
    capYears: result.capYears.map(superCapYearDto),
    capOverride: capOverrideOf(data.settings),
    statutory: statutoryDto(data, ctx.asOf),
    flags: [...result.flags],
    charts: { unit, count, points: result.chart.map(superChartPointDto) },
    settings: settingsSliceDto(data.settings, data.settingOrigins, SUPER_PAGE_SETTING_KEYS),
  };
}
