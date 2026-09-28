// Production bundles of the server (esbuild; stage-0.md §1, stage-7.md §5.6), ESM for Node 24:
//   src/index.ts      → dist/server.js
//   src/cli/import.ts → dist/cli/import.js   (D34's override, in a one-off container)
//   src/cli/restore.ts → dist/cli/restore.js (restore, with the app stopped)
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

const source = (path) => fileURLToPath(new URL(path, serverDir));

await build({
  entryPoints: {
    server: source('src/index.ts'),
    'cli/import': source('src/cli/import.ts'),
    'cli/restore': source('src/cli/restore.ts'),
  },
  outdir: fileURLToPath(new URL('dist', serverDir)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external,
  define: { __APP_VERSION__: JSON.stringify(rootPkg.version) },
  logLevel: 'info',
});
