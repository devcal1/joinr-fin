import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION, readVersionFromPackageJson } from '../src/version';
import { makeTempDir, removeDir } from './helpers';

let tempDir: string;

beforeEach(async () => {
  tempDir = await makeTempDir();
});

afterEach(async () => {
  await removeDir(tempDir);
});

describe('app version', () => {
  it('matches the root package.json in dev and tests', () => {
    const rootPkg = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(APP_VERSION).toBe(rootPkg.version);
  });

  it('reads the version field', async () => {
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    expect(readVersionFromPackageJson(tempDir)).toBe('1.2.3');
  });

  it('falls back when the file or the field is missing', async () => {
    expect(readVersionFromPackageJson(undefined)).toBe('0.0.0-dev');
    expect(readVersionFromPackageJson(tempDir)).toBe('0.0.0-dev');
    await writeFile(join(tempDir, 'package.json'), '{"name":"x"}');
    expect(readVersionFromPackageJson(tempDir)).toBe('0.0.0-dev');
    await writeFile(join(tempDir, 'package.json'), 'not json');
    expect(readVersionFromPackageJson(tempDir)).toBe('0.0.0-dev');
  });
});
