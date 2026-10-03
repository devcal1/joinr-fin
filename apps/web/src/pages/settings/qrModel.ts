// The pairing QR code as one SVG path (stage-9.md §8.2, R49): `qrcode-generator` at error
// correction M, read module by module with `isDark` (never its SVG or HTML output). The path and
// the viewBox are in module units, with the standard 4-module quiet zone; the page sizes the tile to
// an integer number of pixels per module, so the edges stay sharp at any display scaling.
import qrcode from 'qrcode-generator';
import { QR_QUIET_MODULES } from './phoneDisplay';

export interface QrModel {
  /** Modules per side of the code itself (no quiet zone). */
  modules: number;
  /** Modules per side with the quiet zone on both sides (the viewBox size). */
  size: number;
  /** One path of every dark module: a rectangle per horizontal run, offset by the quiet zone. */
  path: string;
}

/** The QR model of `text`, deterministic for a given text. */
export function qrModel(text: string): QrModel {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const modules = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < modules; row++) {
    let col = 0;
    while (col < modules) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < modules && qr.isDark(row, col)) col++;
      const run = col - start;
      parts.push(`M${start + QR_QUIET_MODULES} ${row + QR_QUIET_MODULES}h${run}v1h-${run}z`);
    }
  }
  return { modules, size: modules + 2 * QR_QUIET_MODULES, path: parts.join('') };
}

/**
 * The dark modules back as a matrix, read from a path `qrModel` wrote (for the tests' decode
 * check): `true` where a module is dark, without the quiet zone.
 */
export function modulesFromPath(model: QrModel): boolean[][] {
  const grid = Array.from({ length: model.modules }, () =>
    Array.from({ length: model.modules }, () => false),
  );
  for (const m of model.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const x = Number(m[1]) - QR_QUIET_MODULES;
    const y = Number(m[2]) - QR_QUIET_MODULES;
    const run = Number(m[3]);
    const row = grid[y];
    if (!row) continue;
    for (let i = 0; i < run; i++) row[x + i] = true;
  }
  return grid;
}
