// Build configuration (vite.config.ts), kept in src so its test runs with the web project.

/**
 * Vendor chunks (stage-6.md §6.9 H, D104): the pages load lazily (router.tsx) and the libraries
 * every page shares get their own long-cached chunks. Higher priority wins; the tests are
 * separator-agnostic (`[\\/]`: Windows paths use backslashes). zrender gets its own group because
 * echarts and zrender together pass 500 kB.
 */
export const CODE_SPLITTING_GROUPS: { name: string; test: RegExp; priority: number }[] = [
  { name: 'zrender', test: /[\\/]zrender[\\/]/, priority: 40 },
  { name: 'echarts', test: /[\\/]echarts[\\/]/, priority: 30 },
  { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
  { name: 'tanstack', test: /[\\/]node_modules[\\/]@tanstack[\\/]/, priority: 10 },
];
