import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { CODE_SPLITTING_GROUPS } from './src/codeSplitting.ts';

const rootPkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

// Ports come from env and are always strict (docs/stages/stage-0.md §4).
const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiTarget = process.env.API_TARGET ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`;

// The dev server may read only what the app is built from. Vite's default is the whole
// workspace, which would serve git-ignored private files (reference/, docs/private/, data/,
// artifacts/) over /@fs/ to anyone who can reach the port, e.g. with `--host`.
const fromRoot = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const FS_ALLOW = [fromRoot('apps/web'), fromRoot('packages'), fromRoot('node_modules')];

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  define: { __APP_VERSION__: JSON.stringify(rootPkg.version) },
  server: {
    port: webPort,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    fs: { strict: true, allow: FS_ALLOW },
  },
  preview: { port: webPort, strictPort: true },
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: CODE_SPLITTING_GROUPS } },
    },
  },
});
