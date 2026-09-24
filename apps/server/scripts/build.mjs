// Production bundle of the server (esbuild; stage-0.md §1): dist/server.js, ESM for Node 24.
// @joinr/* workspace code is bundled in; every third-party runtime dependency stays external.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const serverDir = new URL('..', import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

const pkg = readJson(new URL('package.json', serverDir));
const rootPkg = readJson(new URL('../../package.json', serverDir));

const external = Object.entries(pkg.dependencies ?? {})
  .filter(([, range]) => !String(range).startsWith('workspace:'))
  .map(([name]) => name);

await build({
  entryPoints: [fileURLToPath(new URL('src/index.ts', serverDir))],
  outfile: fileURLToPath(new URL('dist/server.js', serverDir)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external,
  define: { __APP_VERSION__: JSON.stringify(rootPkg.version) },
  logLevel: 'info',
});
