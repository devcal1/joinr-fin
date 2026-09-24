import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@joinr/schema', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@joinr/schema');
  });
});
