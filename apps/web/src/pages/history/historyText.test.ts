// The History page's words and the correction model (stage-5.md §6.4): the record form's notes, the
// status lines, the consistency headline (derived figures only), the owed sign round trip and the
// read-only extras.
import type { SnapshotDto } from '@joinr/schema';
import { historyPages } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import {
  diffCorrection,
  displayCents,
  initialDrafts,
  isReadOnly,
  owedMessage,
  storedCents,
} from './correctDraft';
import {
  consistencyHeadline,
  gapsText,
  missingText,
  movementText,
  nextMonthOf,
  nothingToRecordText,
  recordNotes,
  recordedAnnouncement,
  sharedRunDateText,
} from './historyText';

const page = historyPages.populated;

describe('the record form notes (§6.4 item 3)', () => {
  const recordable = ['2027-01', '2027-02', '2027-03'];

  it("an ended month: today's values and date", () => {
    expect(recordNotes(recordable, new Set(['2027-01']), '2027-03-14')).toEqual([
      "Jan 2027 will be recorded with today's (14/03/2027) values and date, not its month-end figures.",
    ]);
  });

  it('months recorded together, the gap warning and the early record', () => {
    expect(recordNotes(recordable, new Set(['2027-02', '2027-03']), '2027-03-14')).toEqual([
      'Leaving Jan 2027 out makes it a permanent gap.',
      "Feb 2027 will be recorded with today's (14/03/2027) values and date, not its month-end figures.",
      'The months are recorded together; the later ones will show no change (recorded late).',
      'Recording before the month ends closes Mar 2027 now; the rest of the month counts toward Apr 2027.',
    ]);
  });

  it('the current month on its last day needs no note; nothing ticked, no notes', () => {
    expect(recordNotes(['2027-03'], new Set(['2027-03']), '2027-03-31')).toEqual([]);
    expect(recordNotes(recordable, new Set(), '2027-03-14')).toEqual([]);
  });

  it('announces and names months', () => {
    expect(recordedAnnouncement(['2027-03'])).toBe('Recorded Mar 2027');
    expect(recordedAnnouncement(['2027-02', '2027-03'])).toBe('Recorded Feb 2027 and Mar 2027');
    expect(nextMonthOf('2026-12')).toBe('2027-01');
  });
});

describe('status lines (§6.4 item 2, §6.9)', () => {
  it('missing months, gaps and nothing to record', () => {
    expect(missingText(['2027-01', '2027-02'])).toBe('Jan 2027 and Feb 2027 are not recorded');
    expect(gapsText(['2026-10'])).toBe(
      'Oct 2026 was never recorded; months before the latest recorded month cannot be filled',
    );
    expect(nothingToRecordText(historyPages.nothingToRecord)).toMatch(
      /is already recorded; the next month to record is/,
    );
  });

  it('months recorded on the same day', () => {
    const april = page.snapshots.find((s) => s.periodMonth === '2026-04') as SnapshotDto;
    expect(sharedRunDateText(april, page.snapshots)).toBe('Recorded together with May 2026');
    const june = page.snapshots.find((s) => s.periodMonth === '2026-06') as SnapshotDto;
    expect(sharedRunDateText(june, page.snapshots)).toBeNull();
  });
});

describe('consistency (§6.4 item 7)', () => {
  it('counts derived figures only; movements are information', () => {
    expect(consistencyHeadline(page.consistency)).toBe(
      'Every stored figure reproduces (6 of 6 imported months)',
    );
    expect(consistencyHeadline({ ...page.consistency, derivedMatchedMonths: 5 })).toBe(
      '5 of 6 imported months reproduce every stored figure',
    );
    expect(movementText(['2026-02'])).toMatch(/^1 month's movements differ from today's trades/);
    expect(movementText(['2026-02', '2026-03'])).toMatch(/^2 months' movements differ/);
    expect(movementText([])).toBeNull();
  });
});

describe('the correction model (§6.4 item 5, UX-5)', () => {
  const recorded = page.snapshots.find((s) => s.source === 'lookback') as SnapshotDto;
  const migrated = page.snapshots.find((s) => s.source === 'migrated') as SnapshotDto;

  it('owed figures show positive and are stored negative', () => {
    expect(displayCents('mortgageBalanceCents', -48_000_000)).toBe(48_000_000);
    expect(storedCents('mortgageBalanceCents', 48_000_000)).toBe(-48_000_000);
    expect(storedCents('cashDebtCents', 0)).toBe(0);
    expect(storedCents('cashValueCents', 100)).toBe(100);
    const drafts = initialDrafts(recorded);
    expect(drafts.mortgageBalanceCents).toBe(Math.abs(recorded.figures.mortgageBalanceCents ?? 0));
    // Unchanged drafts send nothing.
    expect(diffCorrection(recorded, drafts).values).toEqual({});
    const changed = diffCorrection(recorded, { ...drafts, mortgageBalanceCents: 47_000_000 });
    expect(changed.values).toEqual({ mortgageBalanceCents: -47_000_000 });
    expect(diffCorrection(recorded, { ...drafts, cashDebtCents: -5 }).errors.cashDebtCents).toBe(
      'Enter an amount of zero or more',
    );
    expect(owedMessage('cashDebtCents', 'must not be positive')).toBe(
      'Enter an amount of zero or more.',
    );
  });

  it('the extras are read-only on an imported month and required on a recorded one', () => {
    expect(isReadOnly(migrated, 'offsetCents')).toBe(true);
    expect(isReadOnly(migrated, 'cashValueCents')).toBe(false);
    expect(isReadOnly(recorded, 'offsetCents')).toBe(false);
    expect('offsetCents' in initialDrafts(migrated)).toBe(false);
    const drafts = initialDrafts(recorded);
    expect(diffCorrection(recorded, { ...drafts, offsetCents: null }).errors.offsetCents).toBe(
      'Enter an amount (0 when there is none)',
    );
    // A migrated row may clear a primary figure (null clears the cell).
    const cleared = diffCorrection(migrated, { ...initialDrafts(migrated), stocksGainCents: null });
    expect(cleared.values).toEqual({ stocksGainCents: null });
  });
});
