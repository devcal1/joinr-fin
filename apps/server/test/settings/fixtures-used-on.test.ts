// The Settings fixtures' "Used on" lists equal the server's SETTING_READERS (stage-5.md §3.6, §4.5,
// D86; Fixer round 1, SPEC-2 / STYLE-3 / CODE-4): the web tests and the history-states screenshots
// then link back exactly as the real API does, in `PAGES` order, and the two cannot drift again.
import { settingsPages } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import { settingReaders } from '../../src/settings/readers';

describe('settingsPages fixtures: usedOn = settingReaders(key)', () => {
  for (const [state, page] of Object.entries(settingsPages)) {
    it(`${state}: every setting`, () => {
      expect(page.settings.length).toBeGreaterThan(0);
      for (const setting of page.settings) {
        expect(setting.usedOn, setting.key).toEqual(settingReaders(setting.key));
      }
    });
  }
});
