// Held units per instrument: Σ trades.units in decimal (stage-1.md §5.4 step 2).
import { trades } from '@joinr/schema/db';
import { JoinrDecimal, normaliseDecimal } from '@joinr/schema';
import type { Db } from '../database';

/**
 * instrument id → Σ units of its trades as a normalised decimal string (e.g. "0", "150",
 * "0.05"). Instruments without trades are absent. Held = the sum is greater than zero.
 */
export function heldUnitsByInstrument(db: Db): Map<number, string> {
  const sums = new Map<number, InstanceType<typeof JoinrDecimal>>();
  const rows = db
    .select({ instrumentId: trades.instrumentId, units: trades.units })
    .from(trades)
    .all();
  for (const { instrumentId, units } of rows) {
    const current = sums.get(instrumentId) ?? new JoinrDecimal(0);
    sums.set(instrumentId, current.plus(units));
  }
  const result = new Map<number, string>();
  for (const [id, sum] of sums) result.set(id, normaliseDecimal(sum.toFixed()));
  return result;
}

/** True when a held-units string is greater than zero. */
export function isHeld(units: string | undefined): boolean {
  return units !== undefined && new JoinrDecimal(units).greaterThan(0);
}
