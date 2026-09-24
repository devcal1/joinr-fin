import { defineConfig } from 'vitest/config';

// Each app, package and tool is a Vitest project with its own vitest.config.ts.
// Project names: web, server, ui, engine, schema, importer, privacy-guard.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'tools/*'],
  },
});
