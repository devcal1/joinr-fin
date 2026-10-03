// The pairing QR model (stage-9.md §8.2, §8.3, R49): deterministic for a payload, in module units
// with the 4-module quiet zone, and the same modules the generator reports, for a payload that
// parses back through the frozen pairing-URL rule.
import { pairingUrl, parsePairingUrl } from '@joinr/schema';
import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { QR_QUIET_MODULES } from './phoneDisplay';
import { modulesFromPath, qrModel } from './qrModel';

const PAYLOAD = pairingUrl('http://umbrel.example-tailnet.ts.net:4932', 'ABCDE12345');

describe('qrModel', () => {
  it('the payload is the frozen pairing URL and parses back', () => {
    expect(PAYLOAD).toBe(
      'joinrfinance://pair?v=1&u=http%3A%2F%2Fumbrel.example-tailnet.ts.net%3A4932&c=ABCDE12345',
    );
    expect(parsePairingUrl(PAYLOAD)).toEqual({
      serverUrl: 'http://umbrel.example-tailnet.ts.net:4932',
      code: 'ABCDE12345',
    });
  });

  it('is deterministic for a payload and differs for another code', () => {
    const a = qrModel(PAYLOAD);
    expect(qrModel(PAYLOAD)).toEqual(a);
    expect(
      qrModel(pairingUrl('http://umbrel.example-tailnet.ts.net:4932', 'ABCDE12346')).path,
    ).not.toBe(a.path);
  });

  it('is in module units with the 4-module quiet zone on each side', () => {
    const m = qrModel(PAYLOAD);
    expect(m.size).toBe(m.modules + 2 * QR_QUIET_MODULES);
    // Version 5 or 6 at level M for a ~90-character URL: 37 or 41 modules.
    expect([37, 41]).toContain(m.modules);
    // Every rectangle sits inside the code area (the quiet zone stays empty).
    for (const r of m.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      const [x, y, run, back] = [r[1], r[2], r[3], r[4]].map(Number) as [
        number,
        number,
        number,
        number,
      ];
      expect(run).toBe(back);
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_MODULES);
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_MODULES);
      expect(x + run).toBeLessThanOrEqual(QR_QUIET_MODULES + m.modules);
      expect(y).toBeLessThan(QR_QUIET_MODULES + m.modules);
    }
  });

  it('draws exactly the generator’s dark modules (error correction M)', () => {
    const m = qrModel(PAYLOAD);
    const qr = qrcode(0, 'M');
    qr.addData(PAYLOAD, 'Byte');
    qr.make();
    const expected = Array.from({ length: m.modules }, (_, r) =>
      Array.from({ length: m.modules }, (_, c) => qr.isDark(r, c)),
    );
    expect(modulesFromPath(m)).toEqual(expected);
    // The three finder patterns: dark corners top-left, top-right and bottom-left, light bottom-right.
    const grid = modulesFromPath(m);
    expect(grid[0]?.[0]).toBe(true);
    expect(grid[0]?.[m.modules - 1]).toBe(true);
    expect(grid[m.modules - 1]?.[0]).toBe(true);
  });
});
