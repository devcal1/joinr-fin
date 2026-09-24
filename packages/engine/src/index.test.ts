import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@joinr/engine', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@joinr/engine');
  });
});
