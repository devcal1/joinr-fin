// The traversal corpus over a REAL SOCKET (stage-9.md §6.10, the test of record): `app.inject`
// (light-my-request) resolves `..`, `%2e%2e` and `./` before routing, so it would hide a traversal
// bug; Fastify over a socket matches the raw path. Every raw request below, with GET, HEAD, POST and
// DELETE, must answer 404, 405 or a 401 from the mobile hook: never 200 from another route and
// never the SPA. A copy through `inject` is kept only to document that inject normalises. Made-up
// file names; no key is used.
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMobileApp, type MobileApp } from './helpers';

const SPA_MARKER = 'spa-index-marker-7f3a';
// A name the download route accepts (BACKUP_FILE_NAME_RE needs the offset), so the direct
// control below proves the file is really downloadable.
const BACKUP_NAME = 'manual-20300912-052000+1000.db';

let t: MobileApp;
let port: number;

beforeAll(async () => {
  const { makeTempDir } = await import('../helpers');
  const web = await makeTempDir('joinr-mobile-web-');
  writeFileSync(join(web, 'index.html'), `<!doctype html><title>${SPA_MARKER}</title>`);
  t = await startMobileApp({ seed: true });
  // Rebuild with the SPA served, so a fall-through to it would be visible.
  const backups = join(t.dataDir, 'backups');
  mkdirSync(backups, { recursive: true });
  writeFileSync(join(backups, BACKUP_NAME), 'not really a database');
  await t.restart({ config: { ...t.config, serveWeb: true, webDistDir: web } });
  await t.app.listen({ host: '127.0.0.1', port: 0 });
  port = (t.app.server.address() as AddressInfo).port;
});
afterAll(() => t.close());

/** One raw HTTP/1.1 request; resolves the status code and the body text. */
function raw(method: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let data = '';
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => {
      data += chunk;
    });
    socket.on('error', reject);
    socket.on('end', () => {
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0);
      const body = data.slice(data.indexOf('\r\n\r\n') + 4);
      resolve({ status, body });
    });
    const length = method === 'POST' ? 'Content-Length: 0\r\n' : '';
    socket.write(
      `${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n${length}Connection: close\r\n\r\n`,
    );
  });
}

const CORPUS = [
  '/api/mobile/../backups',
  '/api/mobile/%2e%2e/backups',
  '/api/mobile/%2E%2E%2Fbackups',
  '/api/mobile/..%2fbackups',
  '/api/mobile/today/../../backups',
  '/api/mobile//../backups',
  '/api/mobile/./today',
  '/api/mobile/;/../backups',
  '/api/mobile/today%00',
  '/api/mobile\\..\\backups',
  '/api/mobile/../status',
  '/api/mobile/../phone',
  `/api/mobile/../backups/${BACKUP_NAME}`,
  // Stage 10 (stage-10.md §6.6): the periods path.
  '/api/mobile/periods/../backups',
  '/api/mobile/periods%2f..%2fbackups',
  '/api/mobile/periods/..;/status',
];

describe('the traversal corpus over a socket (the test of record)', () => {
  it('the targets are reachable directly (so a traversal would show)', async () => {
    expect((await raw('GET', '/api/status')).status).toBe(200);
    expect((await raw('GET', '/api/backups')).status).toBe(200);
    expect((await raw('GET', '/api/phone')).status).toBe(200);
    const direct = await raw('GET', `/api/backups/${encodeURIComponent(BACKUP_NAME)}`);
    expect(direct.status).toBe(200);
    expect(direct.body).toContain('not really a database');
    expect((await raw('GET', '/')).body).toContain(SPA_MARKER);
  });

  for (const path of CORPUS) {
    for (const method of ['GET', 'HEAD', 'POST', 'DELETE']) {
      it(`${method} ${path}`, async () => {
        const res = await raw(method, path);
        expect([401, 404, 405], `${method} ${path} → ${res.status}`).toContain(res.status);
        expect(res.body).not.toContain(SPA_MARKER);
        expect(res.body).not.toContain('"backups"');
        expect(res.body).not.toContain('"devices"');
        expect(res.body).not.toContain('not really a database');
        if (res.status === 401) expect(res.body).toContain('DEVICE_KEY');
      });
    }
  }
});

describe('inject normalises (documentation only, not the test of record)', () => {
  it('an injected GET /api/mobile/../backups reaches /api/backups', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/mobile/../backups' });
    expect(res.statusCode).toBe(200);
  });
});
