import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'engine',
    environment: 'node',
    // Golden tests read the local workbook; their describes set 120 s themselves.
    testTimeout: 60_000,
  },
});
