// Zip pre-scan (stage-1.md §7.7 zip-bomb review): an .xlsx is a zip, and SheetJS would otherwise
// parse any bytes (CSV, HTML, …) and inflate every entry up front at its declared size. Before
// SheetJS sees the bytes we require the zip magic, walk the central directory, bound the entry
// count and the declared uncompressed total, and inflate each entry with a hard output cap so a
// header that lies about its size is caught too. Any failure is a WorkbookFormatError (→ 422).
import { inflateRawSync } from 'node:zlib';
import { WorkbookFormatError } from './errors';

/** More entries than any real template export (the owner-sized workbook has ~100–200). */
export const ZIP_MAX_ENTRIES = 2000;
/** Declared uncompressed total; real workbooks are a few tens of MB at most. */
export const ZIP_MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

const unreadable = (): WorkbookFormatError =>
  new WorkbookFormatError('The file is not a readable .xlsx workbook');

function findEocd(view: DataView): number {
  const last = view.byteLength - EOCD_MIN;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let i = last; i >= first; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Throws WorkbookFormatError unless `bytes` is a plain (non-ZIP64, unencrypted) zip whose entries
 * are stored or deflated, number at most ZIP_MAX_ENTRIES, and inflate to at most their declared
 * sizes within ZIP_MAX_UNCOMPRESSED_BYTES in total.
 */
export function assertSafeZip(bytes: Uint8Array): void {
  if (bytes.length < EOCD_MIN + 4) throw unreadable();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== LOCAL_SIG) throw unreadable();
  const eocd = findEocd(view);
  if (eocd < 0) throw unreadable();
  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw unreadable(); // ZIP64
  }
  if (entries === 0 || entries > ZIP_MAX_ENTRIES) throw unreadable();
  if (cdOffset + cdSize > eocd) throw unreadable();

  interface Entry {
    method: number;
    compressed: number;
    size: number;
    local: number;
  }
  const list: Entry[] = [];
  let declared = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== CENTRAL_SIG) throw unreadable();
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    if ((flags & 1) !== 0) throw unreadable(); // encrypted
    if (method !== 0 && method !== 8) throw unreadable();
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) {
      throw unreadable(); // ZIP64
    }
    declared += size;
    if (declared > ZIP_MAX_UNCOMPRESSED_BYTES) throw unreadable();
    list.push({ method, compressed, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }

  for (const e of list) {
    if (e.local + 30 > bytes.length || view.getUint32(e.local, true) !== LOCAL_SIG) {
      throw unreadable();
    }
    const start =
      e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
    const end = start + e.compressed;
    if (end > bytes.length) throw unreadable();
    if (e.method === 0) {
      if (e.compressed !== e.size) throw unreadable();
      continue;
    }
    let out: Buffer;
    try {
      // One byte of headroom: an entry that inflates past its declared size fails here (or
      // comes back one byte long) instead of allocating whatever it really holds.
      out = inflateRawSync(bytes.subarray(start, end), { maxOutputLength: e.size + 1 });
    } catch {
      throw unreadable();
    }
    if (out.length !== e.size) throw unreadable();
  }
}
