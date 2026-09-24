import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'importer',
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // Parsing a workbook takes about a second; golden and CLI tests set longer timeouts.
    testTimeout: 30_000,
  },
});
