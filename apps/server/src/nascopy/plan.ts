// The copy's plan (stage-8.md §5.5 step 4; pure): a local file whose name the NAS holds at the
// same byte size is already there; anything else (absent, another size, an unreadable size) is
// sent. The send list is newest first (the Stage 7 name order, reversed).
import type { ParsedBackupName } from '../backups/names';
import { compareBackupNames } from '../backups/names';
import type { RemoteFile } from './listing';

export interface LocalFile extends ParsedBackupName {
  sizeBytes: number;
}

export interface PlannedFile {
  name: string;
  /** The local size when planned: the proof compares the NAS size with this. */
  bytes: number;
}

export interface CopyPlan {
  alreadyThere: number;
  /** Newest first. */
  toSend: PlannedFile[];
}

export function planCopy(local: readonly LocalFile[], remote: readonly RemoteFile[]): CopyPlan {
  const remoteSizes = new Map(remote.map((f) => [f.name, f.bytes]));
  let alreadyThere = 0;
  const send: LocalFile[] = [];
  for (const f of local) {
    const size = remoteSizes.get(f.name);
    if (size !== undefined && size === f.sizeBytes) alreadyThere += 1;
    else send.push(f);
  }
  send.sort((a, b) => compareBackupNames(b, a));
  return { alreadyThere, toSend: send.map((f) => ({ name: f.name, bytes: f.sizeBytes })) };
}
