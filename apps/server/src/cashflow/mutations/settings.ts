// PATCH /api/settings (stage-3.md §3.3, §4.5): the editable keys. Each key's parsed value is
// compared with the stored one (unset and JSON null are equal); only changed keys are written, with
// `origin = 'app'`, so a no-op save never flips a workbook setting's origin. Stage 4 (stage-4.md
// §3.3, §4.5 step 7): a patch naming `super.concessionalCapCents` also writes the server-only
// `super.concessionalCapFy` (the as-of date's FY start year; null when the cap is cleared).
import {
  financialYearOfIso,
  settingsPatchSchema,
  settingValueSchema,
  type EditableSettingKey,
  type SettingKey,
  type SettingValue,
} from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { inArray } from 'drizzle-orm';
import { parseWith } from '../../errors';
import { localIsoDate } from '../../investments/format';
import type { MutationDeps } from './cash';
import { assertNoImportRunning } from './common';

/** A stored value_json parsed with the key's registry schema; invalid or JSON null → null. */
function storedValue(key: SettingKey, valueJson: string | undefined): SettingValue | null {
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
  const now = deps.now();
  const updatedAt = now.toISOString();
  // The values to write: the named keys, plus the cap's FY whenever the cap is named (§3.3).
  const writes = new Map<SettingKey, SettingValue | null>(keys.map((k) => [k, values[k] ?? null]));
  if (writes.has('super.concessionalCapCents')) {
    const cap = writes.get('super.concessionalCapCents') ?? null;
    writes.set(
      'super.concessionalCapFy',
      cap === null ? null : financialYearOfIso(localIsoDate(now)),
    );
  }
  deps.database.db.transaction(
    (tx) => {
      const stored = new Map(
        tx
          .select({ key: settings.key, valueJson: settings.valueJson })
          .from(settings)
          .where(inArray(settings.key, [...writes.keys()]))
          .all()
          .map((r) => [r.key, r.valueJson]),
      );
      for (const [key, next] of writes) {
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
