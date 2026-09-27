// stage-6.md §6.9 H: the vendor chunk groups match module ids with either path separator (Windows
// builds use backslashes) and the right group wins by priority.
import { describe, expect, it } from 'vitest';
import { CODE_SPLITTING_GROUPS } from './codeSplitting';

/** The group a module id lands in: the highest-priority group whose test matches. */
function groupOf(id: string): string | null {
  const matches = CODE_SPLITTING_GROUPS.filter((g) => g.test.test(id)).sort(
    (a, b) => b.priority - a.priority,
  );
  return matches[0]?.name ?? null;
}

const POSIX = '/repo/node_modules/.pnpm';
const WINDOWS = 'C:\\repo\\node_modules\\.pnpm';

function ids(pkg: string, file: string): [string, string] {
  return [
    `${POSIX}/${pkg}@1.0.0/node_modules/${pkg}/${file}`,
    `${WINDOWS}\\${pkg.replace('/', '\\')}@1.0.0\\node_modules\\${pkg.replace('/', '\\')}\\${file.replaceAll('/', '\\')}`,
  ];
}

describe('code-splitting groups (§6.9 H)', () => {
  it.each([
    ['zrender', 'lib/zrender.js', 'zrender'],
    ['echarts', 'lib/chart/line.js', 'echarts'],
    ['react', 'index.js', 'react'],
    ['react-dom', 'client.js', 'react'],
    ['scheduler', 'index.js', 'react'],
    ['@tanstack/react-router', 'dist/esm/index.js', 'tanstack'],
    ['@tanstack/react-query', 'build/modern/index.js', 'tanstack'],
  ])('%s → %s chunk, on either separator', (pkg, file, group) => {
    for (const id of ids(pkg, file)) expect(groupOf(id), id).toBe(group);
  });

  it('keeps zrender out of the echarts chunk (they pass 500 kB together)', () => {
    for (const id of ids('zrender', 'lib/core/util.js')) expect(groupOf(id)).toBe('zrender');
    const zrender = CODE_SPLITTING_GROUPS.find((g) => g.name === 'zrender')!;
    const echarts = CODE_SPLITTING_GROUPS.find((g) => g.name === 'echarts')!;
    expect(zrender.priority).toBeGreaterThan(echarts.priority);
  });

  it.each([
    'C:\\repo\\apps\\web\\src\\pages\\cash\\CashPage.tsx',
    '/repo/apps/web/src/pages/cash/CashPage.tsx',
    '/repo/node_modules/.pnpm/react-refresh@0.1.0/node_modules/react-refresh/runtime.js',
    '/repo/node_modules/.pnpm/lucide-react@1.0.0/node_modules/lucide-react/dist/esm/index.js',
    '/repo/packages/ui/src/charts/echarts.ts',
  ])('leaves app code and other libraries to the default chunks: %s', (id) => {
    expect(groupOf(id)).toBeNull();
  });
});
