// The copy's plan (stage-8.md §5.5 step 4, §5.13): missing, same size, a different size, NaN,
// newest first across kinds, foreign remote names ignored.
process.env.TZ = 'Australia/Melbourne';

import { describe, expect, it } from 'vitest';
import { formatBackupName, parseBackupName } from '../../src/backups/names';
import { planCopy, type LocalFile } from '../../src/nascopy/plan';

function local(
  kind: Parameters<typeof formatBackupName>[0],
  at: Date,
  sizeBytes: number,
): LocalFile {
  const parsed = parseBackupName(formatBackupName(kind, at));
  if (parsed === null) throw new Error('bad name');
  return { ...parsed, sizeBytes };
}

const A = local('nightly', new Date(2030, 8, 14, 2, 30), 100);
const B = local('manual', new Date(2030, 8, 14, 18, 0), 200);
const C = local('pre-import', new Date(2030, 8, 13, 9, 0), 300);
const D = local('nightly', new Date(2030, 8, 15, 2, 30), 400);

describe('planCopy', () => {
  it('sends what is missing, a different size and an unreadable size; keeps the same size', () => {
    const plan = planCopy(
      [A, B, C, D],
      [
        { name: A.name, bytes: 100 },
        { name: B.name, bytes: 199 },
        { name: C.name, bytes: NaN },
        { name: 'notes.txt', bytes: 1 },
      ],
    );
    expect(plan.alreadyThere).toBe(1);
    expect(plan.toSend).toEqual([
      { name: D.name, bytes: 400 },
      { name: B.name, bytes: 200 },
      { name: C.name, bytes: 300 },
    ]);
  });

  it('orders the send newest first across kinds, whatever the input order', () => {
    const plan = planCopy([C, A, D, B], []);
    expect(plan.toSend.map((f) => f.name)).toEqual([D.name, B.name, A.name, C.name]);
    expect(plan.alreadyThere).toBe(0);
  });

  it('sends nothing when everything is there', () => {
    const plan = planCopy(
      [A, B],
      [
        { name: A.name, bytes: 100 },
        { name: B.name, bytes: 200 },
      ],
    );
    expect(plan).toEqual({ alreadyThere: 2, toSend: [] });
  });
});
