import { defineConfig } from 'vitest/config';

// Each app, package and tool is a Vitest project with its own vitest.config.ts.
// Project names: web, server, ui, engine, schema, importer, privacy-guard, deploy.
// The apps are listed by name (stage-9.md §7.4): apps/android is Gradle's, never a Vitest project.
export default defineConfig({
  test: {
    projects: ['apps/server', 'apps/web', 'packages/*', 'tools/*'],
  },
});
