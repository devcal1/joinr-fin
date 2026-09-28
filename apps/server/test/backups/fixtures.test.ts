// The fixture-consistency check (stage-7.md §3.4, §8.2 step 7): for every `backupsPages` state,
// the real list code (`toBackupDtos` → `retain` at the §4.3 reference instant) reproduces the
// fixture's order, createdAt and keptAs; totalBytes is the sum; lastBackupAt ignores future
// files; each name parses to its createdAt.
process.env.TZ = 'Australia/Melbourne';

import {
  backupNowResponses,
  backupsFixtureNow,
  backupsPages,
  type BackupsPageFixture,
} from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import { newestRoutineBackup, toBackupDtos, type ListedBackup } from '../../src/backups/list';
import { parseBackupName } from '../../src/backups/names';

const states = Object.keys(backupsPages) as BackupsPageFixture[];

function listed(state: BackupsPageFixture): ListedBackup[] {
  return backupsPages[state].backups.map((b) => {
    const parsed = parseBackupName(b.name);
    if (parsed === null) throw new Error(`${state}: ${b.name} breaks the name rule`);
    return { ...parsed, sizeBytes: b.sizeBytes };
  });
}

describe('backupsPages fixtures agree with the real list code', () => {
  it.each(states)('%s', (state) => {
    const page = backupsPages[state];
    const now = new Date(backupsFixtureNow[state]);
    const files = listed(state);
    // Newest first, as the list sorts.
    const sorted = [...files].sort(
      (a, b) => b.instant.getTime() - a.instant.getTime() || b.suffix - a.suffix,
    );
    expect(sorted.map((f) => f.name)).toEqual(page.backups.map((b) => b.name));
    expect(toBackupDtos(sorted, now)).toEqual(page.backups);
    expect(page.totalBytes).toBe(page.backups.reduce((s, b) => s + b.sizeBytes, 0));
    expect(page.lastBackupAt).toBe(newestRoutineBackup(sorted, now)?.createdAt ?? null);
  });

  it('the "Back up now" responses parse and carry their createdAt', () => {
    for (const r of Object.values(backupNowResponses)) {
      expect(parseBackupName(r.backup.name)?.createdAt).toBe(r.backup.createdAt);
      expect(parseBackupName(r.backup.name)?.kind).toBe(r.backup.kind);
    }
  });
});
