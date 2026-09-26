// PATCH /api/settings (stage-3.md §3.3, §4.5): the editable keys. Each key's parsed value is
// compared with the stored one (unset and JSON null are equal); only changed keys are written, with
// `origin = 'app'`, so a no-op save never flips a workbook setting's origin.
import {
  settingsPatchSchema,
  settingValueSchema,
  type EditableSettingKey,
  type SettingValue,
} from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { inArray } from 'drizzle-orm';
import { parseWith } from '../../errors';
import type { MutationDeps } from './cash';
import { assertNoImportRunning } from './common';

/** A stored value_json parsed with the key's registry schema; invalid or JSON null → null. */
function storedValue(key: EditableSettingKey, valueJson: string | undefined): SettingValue | null {
  if (valueJson === undefined) return null;
  try {
    const raw: unknown = JSON.parse(valueJson);
    if (raw === null) return null;
    const parsed = settingValueSchema(key).safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Applies the patch; returns the keys the body named (the response slice follows them). */
export function patchSettings(deps: MutationDeps, body: unknown): EditableSettingKey[] {
  assertNoImportRunning();
  const { values } = parseWith(settingsPatchSchema, body);
  const keys = Object.keys(values) as EditableSettingKey[];
  const updatedAt = deps.now().toISOString();
  deps.database.db.transaction(
    (tx) => {
      const stored = new Map(
        tx
          .select({ key: settings.key, valueJson: settings.valueJson })
          .from(settings)
          .where(inArray(settings.key, keys))
          .all()
          .map((r) => [r.key, r.valueJson]),
      );
      for (const key of keys) {
        const next = values[key] ?? null;
        if (storedValue(key, stored.get(key)) === next) continue;
        const valueJson = JSON.stringify(next);
        tx.insert(settings)
          .values({ key, valueJson, updatedAt, origin: 'app' })
          .onConflictDoUpdate({
            target: settings.key,
            set: { valueJson, updatedAt, origin: 'app' },
          })
          .run();
      }
    },
    { behavior: 'immediate' },
  );
  return keys;
}
