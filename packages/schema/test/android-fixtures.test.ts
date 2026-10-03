// The drift check of the Android unit tests' JSON copies (stage-9.md §3.6): the folder holds
// exactly the exported files, and each parses to its TS fixture (deep-equal, never a text compare,
// so Prettier's layout of the JSON does not matter). Re-export with
// `pnpm exec tsx packages/schema/scripts/exportMobileFixtures.ts` after changing a fixture.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANDROID_FIXTURES_DIR } from '../scripts/exportMobileFixtures';
import { ANDROID_FIXTURE_FILES } from '../src/fixtures/index';

const ANDROID_DIR = ANDROID_FIXTURES_DIR;

describe('the Android JSON copies (§3.6 drift check)', () => {
  it('holds exactly the exported files', () => {
    const files = readdirSync(ANDROID_DIR)
      .filter((n) => n.endsWith('.json'))
      .sort();
    expect(files).toEqual(Object.keys(ANDROID_FIXTURE_FILES).sort());
  });

  it.each(Object.entries(ANDROID_FIXTURE_FILES))('%s parses to the TS fixture', (name, value) => {
    const parsed: unknown = JSON.parse(readFileSync(join(ANDROID_DIR, name), 'utf8'));
    expect(parsed).toEqual(JSON.parse(JSON.stringify(value)));
  });
});
