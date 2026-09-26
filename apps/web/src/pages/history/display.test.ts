// The Stage 5 display helpers (stage-5.md §5, §6.1, §6.4): the one Cash definition, other debts,
// month and list words, the hero deltas, the unit words and count choices, server times, the
// source markers, audit words and the recorder lines.
import { historyPages, netWorthPages } from '@joinr/schema/fixtures';
import type { RecorderStatusDto, SnapshotFiguresDto } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import { LIVE_FIRST_LABEL, MARKERS } from '../assets/display';
import {
  changePairText,
  autoRecordText,
  blockedText,
  changeDelta,
  changeKeyLabel,
  changeValueText,
  countOfValue,
  countOptions,
  countValue,
  groupCategory,
  hourText,
  lastRunText,
  listWords,
  monthsWords,
  otherDebtsCents,
  serverTimeText,
  snapshotMarkers,
  stackValueCents,
  unitTitle,
  viewAnnouncement,
} from './display';

const live = netWorthPages.populated.live.figures as SnapshotFiguresDto;
const imported = netWorthPages.populated.charts.groups[0]?.figures as SnapshotFiguresDto;
const recorder = historyPages.populated.recorder;

describe('the chart stack (§5)', () => {
  it('Cash is N + offsets − linked offsets on recorded months, N on imported ones', () => {
    // 24,400 + 15,000 − 10,000
    expect(stackValueCents(live, 'cash')).toBe(2_940_000);
    expect(stackValueCents(imported, 'cash')).toBe(imported.cashValueCents);
    expect(stackValueCents({ ...live, cashValueCents: null }, 'cash')).toBeNull();
  });

  it('the stack adds up to net worth', () => {
    const keys = [
      'stock',
      'etf',
      'crypto',
      'cash',
      'managed_fund',
      'other_assets',
      'super',
      'property',
    ] as const;
    const sum =
      keys.reduce((s, k) => s + (stackValueCents(live, k) ?? 0), 0) + (otherDebtsCents(live) ?? 0);
    expect(sum).toBe(netWorthPages.populated.live.netWorth.netWorthCents);
  });

  it('other debts are drawn below zero', () => {
    expect(otherDebtsCents({ ...live, liabilitiesBalanceCents: 15_000 })).toBe(-15_000);
    expect(otherDebtsCents({ ...live, liabilitiesBalanceCents: -15_000 })).toBe(-15_000);
    expect(otherDebtsCents({ ...live, liabilitiesBalanceCents: null })).toBeNull();
  });
});

describe('words', () => {
  it('lists months', () => {
    expect(listWords([])).toBe('');
    expect(listWords(['A'])).toBe('A');
    expect(listWords(['A', 'B'])).toBe('A and B');
    expect(listWords(['A', 'B', 'C'])).toBe('A, B and C');
    expect(monthsWords(['2027-01', '2027-02'])).toBe('Jan 2027 and Feb 2027');
  });

  it('names the live group and titles charts by the unit', () => {
    expect(groupCategory({ label: 'Sep 2026', live: true })).toBe('Sep 2026 (live)');
    expect(unitTitle('Net worth', 'monthly')).toBe('Net worth by month');
    expect(unitTitle('Net worth', 'quarterly')).toBe('Net worth by quarter');
    expect(unitTitle('Net worth', 'yearly')).toBe('Net worth by year');
    expect(viewAnnouncement('quarterly', 8)).toBe('Showing quarterly, last 8');
    expect(viewAnnouncement('monthly', null)).toBe('Showing monthly, all');
  });

  it('the count choices keep a saved count that is none of them', () => {
    expect(countValue(null)).toBe('all');
    expect(countValue(240)).toBe('all');
    expect(countValue(12)).toBe('12');
    expect(countOfValue('all')).toBe(240);
    expect(countOfValue('6')).toBe(6);
    expect(countOptions(null).map((o) => o.label)).toEqual(['6', '12', '24', 'All']);
    expect(countOptions(8).map((o) => o.value)).toEqual(['6', '8', '12', '24', 'all']);
  });

  it('a change: the percentage, the direction and the base date', () => {
    expect(changeDelta(netWorthPages.populated.sinceLastRecord)).toEqual({
      value: '0.9%',
      direction: 'up',
      text: 'up since 31/08/2026',
    });
    expect(
      changeDelta({ ...netWorthPages.populated.sinceLastRecord, cents: -100, ratio: '-0.001' }),
    ).toMatchObject({ direction: 'down', text: 'down since 31/08/2026' });
    expect(changeDelta({ base: null, cents: null, ratio: null })).toBeUndefined();
  });
});

describe('times (§6.1)', () => {
  it('shows a server time in its own wall time, saying so when the browser differs', () => {
    const iso = '2026-09-30T23:00:00.000+10:00';
    const text = serverTimeText(iso) ?? '';
    expect(text.startsWith('30/09/2026 at 23:00')).toBe(true);
    const browserOffset = -new Date(iso).getTimezoneOffset();
    expect(text.endsWith('(server time)')).toBe(browserOffset !== 600);
    expect(serverTimeText(null)).toBeNull();
    expect(hourText(23)).toBe('23:00');
    expect(hourText(7)).toBe('07:00');
  });
});

describe('sources and the audit (§6.1, §6.4)', () => {
  it('markers from the one registry', () => {
    expect(snapshotMarkers({ source: 'recorded', revision: 0 })).toEqual(['recorded']);
    expect(snapshotMarkers({ source: 'late', revision: 0 })).toEqual(['recordedLate']);
    expect(snapshotMarkers({ source: 'lookback', revision: 0 })).toEqual(['recordedLate']);
    expect(snapshotMarkers({ source: 'migrated', revision: 1 })).toEqual(['imported', 'corrected']);
  });

  it('audit changes in words, the next month prefixed', () => {
    expect(changeKeyLabel('cashValueCents')).toBe('Cash');
    expect(changeKeyLabel('2026-07.cashGainCents')).toBe('Jul 2026 Cash change');
    expect(changeValueText('cashValueCents', 2_320_000)).toBe('$23,200.00');
    expect(changeValueText('cashIncreaseRatio', '0.125')).toBe('12.5%');
    expect(changeValueText('superMeasuredThrough', '2026-09-20')).toBe('20/09/2026');
    expect(changeValueText('cashValueCents', null)).toBe('—');
  });
});

describe('the recorder (§6.4 item 2)', () => {
  const off: RecorderStatusDto = {
    ...recorder,
    autoRecord: { enabled: false, source: 'setting' },
    nextRunAt: null,
  };

  it('auto-record on, off, or set by the server', () => {
    expect(autoRecordText(recorder)).toMatch(/^On · next 30\/09\/2026 at 23:00/);
    expect(autoRecordText(off)).toBe('Off');
    expect(autoRecordText({ ...recorder, autoRecord: { enabled: true, source: 'env' } })).toMatch(
      /^On \(set by the server\)/,
    );
  });

  it('the last run in words', () => {
    expect(lastRunText(off)).toBe('No automatic run yet');
    const run = netWorthPages.populated.recorder.lastRun;
    expect(lastRunText({ ...recorder, lastRun: run })).toBe('Recorded Aug 2026');
    expect(
      lastRunText({
        ...recorder,
        lastRun: run && { ...run, trigger: 'startup', detail: { recorded: ['2027-01'] } },
      }),
    ).toBe('Recorded Jan 2027 late at start-up');
    expect(lastRunText({ ...recorder, lastRun: run && { ...run, detail: { recorded: [] } } })).toBe(
      'Nothing due',
    );
    expect(
      lastRunText({ ...recorder, lastRun: run && { ...run, status: 'failed', error: 'Boom' } }),
    ).toBe('Failed: Boom');
    const blocked = { periodMonth: '2027-02', missing: ['2027-01'] };
    expect(lastRunText({ ...recorder, blocked })).toBe('Waiting: Jan 2027 is not recorded');
    expect(blockedText(blocked)).toBe('Waiting: Jan 2027 is not recorded');
  });
});

describe('the History markers in the one registry (§6.1)', () => {
  it('Recorded and Recorded late are finished records; imported and corrected are tags', () => {
    expect(MARKERS.recorded).toEqual({ kind: 'badge', status: 'recorded', label: 'Recorded' });
    expect(MARKERS.recordedLate).toEqual({
      kind: 'badge',
      status: 'recorded',
      label: 'Recorded late',
    });
    expect(MARKERS.imported).toMatchObject({ kind: 'pill', label: 'Imported' });
    expect(MARKERS.corrected).toMatchObject({ kind: 'pill', label: 'Corrected' });
    expect(MARKERS.live).toEqual({ kind: 'badge', status: 'pending', label: 'Live' });
    expect(LIVE_FIRST_LABEL).toBe('Live (provisional)');
    // A projection is not a status.
    expect(MARKERS.projected).toEqual({ kind: 'pill', tone: 'na', label: 'Projected' });
  });
});

describe('changePairText (Fixer round 1, STYLE-11)', () => {
  const audit = historyPages.populated.audit;
  const change = (key: string) => audit.flatMap((a) => a.changes).find((c) => c.key === key)!;

  it('a ratio change that one decimal hides shows two decimals', () => {
    const c = change('superGainRatio');
    const text = changePairText(c.key, c.before, c.after);
    expect(text).toBe('0.55% → 0.54%');
    const [before, after] = text.split(' → ');
    expect(before).not.toBe(after);
  });

  it('a normal ratio change keeps one decimal; money is unchanged', () => {
    const c = change('cashIncreaseRatio');
    expect(changePairText(c.key, c.before, c.after)).toBe('12.5% → 3.6%');
    expect(changePairText('cashValueCents', 2520000, 2320000)).toBe('$25,200.00 → $23,200.00');
  });

  it('falls back to three decimals when two still hide it', () => {
    expect(changePairText('superGainRatio', '0.0012341', '0.0012362')).toBe('0.123% → 0.124%');
  });
});
