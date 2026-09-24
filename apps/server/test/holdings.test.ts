import { instruments, trades } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { heldUnitsByInstrument, isHeld } from '../src/db/queries/holdings';

let testDb: TestDb;

beforeEach(() => {
  testDb = createTestDb();
});

afterEach(() => {
  testDb.close();
});

describe('heldUnitsByInstrument', () => {
  it('is empty without trades', () => {
    expect(heldUnitsByInstrument(testDb.db).size).toBe(0);
  });

  it('sums units per instrument in decimal, including sells', () => {
    const { instrumentIds } = seedGenericData(testDb.db);
    const held = heldUnitsByInstrument(testDb.db);
    expect(held.get(instrumentIds['ASX:ABC']!)).toBe('150');
    expect(held.get(instrumentIds['ASX:OLD']!)).toBe('0'); // bought 20, sold 20
    expect(held.get(instrumentIds.BTC!)).toBe('0.05');
    expect(held.has(instrumentIds.EXAMPLEFUND2!)).toBe(false);
  });

  it('has no float noise', () => {
    const id = testDb.db
      .insert(instruments)
      .values({ kind: 'crypto', symbol: 'ETH', code: 'ETH', sortOrder: 1 })
      .returning({ id: instruments.id })
      .get().id;
    testDb.db
      .insert(trades)
      .values([
        { instrumentId: id, tradeDate: '2025-01-01', units: '0.1', price: '1', seq: 1 },
        { instrumentId: id, tradeDate: '2025-01-02', units: '0.2', price: '1', seq: 2 },
        { instrumentId: id, tradeDate: '2025-01-03', units: '-0.3', price: '1', seq: 3 },
        { instrumentId: id, tradeDate: '2025-01-04', units: '0.00000001', price: '1', seq: 4 },
      ])
      .run();
    expect(heldUnitsByInstrument(testDb.db).get(id)).toBe('0.00000001');
  });

  it('treats only positive sums as held', () => {
    expect(isHeld('0.00000001')).toBe(true);
    expect(isHeld('0')).toBe(false);
    expect(isHeld('-1')).toBe(false);
    expect(isHeld(undefined)).toBe(false);
  });
});
