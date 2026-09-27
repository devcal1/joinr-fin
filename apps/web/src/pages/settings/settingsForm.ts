// The Settings page's form model (stage-5.md §6.5, D86, D91, D95): the drafts of a group, the
// changed keys a group's Save sends, the write bounds on top of the page rules (SETTING_WRITE_BOUNDS),
// each field's hint (its default and where its value came from), the pages that read it, the
// one-or-the-other callout choice, the allocation sum, and the tax suggestion's words (D85, D90).
// Pure functions, no React.
import {
  MEDICARE_LEVY_RATIO,
  RESIDENT_TAX_TABLES,
  SETTING_WRITE_BOUNDS,
  isEditableSettingKey,
  ratioFromPercentText,
  type DecimalString,
  type EditableSettingKey,
  type MarginalRateSuggestionDto,
  type SettingDto,
  type SettingKey,
  type SettingValue,
} from '@joinr/schema';
import { formatDate, formatFinancialYear, formatMoney } from '@joinr/ui';
import { PAGES } from '../../pages';
import { formatRate } from '../assets/display';
import {
  draftOf,
  parseDraft,
  settingText,
  type SettingDraft,
  type SettingDrafts,
} from '../cashflow/settingsDraft';

export type { SettingDraft, SettingDrafts };

/** The Settings page's workbook callout (D34). */
export const SETTINGS_WORKBOOK_NOTE =
  'Saving counts as an app edit: re-importing the workbook will then be blocked.';
/** App-only and preference keys (D95). */
export const SETTINGS_KEPT_NOTE = 'Kept when you re-import';
export const FEATURES_NOTE = 'Hidden pages still count in your net worth.';
export const FIRE_NOTE = 'Used by the FIRE planner; its what-if panel can save them too.';
export const UNUSED_NOTE =
  "The app does not use these; they are kept so the workbook's settings stay complete.";
export const AUTO_RECORD_APP_DATA_NOTE =
  'Recorded months are app data: once a month is recorded, re-importing the workbook is blocked. Leave this off until you stop using the workbook (Stage 7).';
export const ENV_LOCKED_TEXT = 'Set by the server (AUTO_RECORD)';
export const NOT_USED_TEXT = 'Not used by the app';
export const NO_SALARY_TEXT = 'Set your gross salary to see a suggestion';

/** The editable keys of a group (the server-written cap FY is shown read-only). */
export function editableKeys(settings: readonly SettingDto[]): EditableSettingKey[] {
  return settings.flatMap((s) =>
    s.editable && s.lockedBy === null && isEditableSettingKey(s.key) ? [s.key] : [],
  );
}

/** A group's starting drafts. */
export function draftsOf(settings: readonly SettingDto[]): SettingDrafts {
  const drafts: SettingDrafts = {};
  for (const key of editableKeys(settings)) {
    drafts[key] = draftOf(key, settings.find((s) => s.key === key)?.value ?? null);
  }
  return drafts;
}

/** The write bound of a key in its entry unit (ratios as percentages), or null. */
export function writeBound(key: EditableSettingKey): { min: number; max: number } | null {
  return SETTING_WRITE_BOUNDS[key] ?? null;
}

type Parsed = { ok: true; value: SettingValue | null } | { ok: false; message: string };

/** The page rules (parseDraft), then the write-only bounds of §3.3 (charts.unitCount, 4 ratios). */
export function parseSetting(dto: SettingDto, draft: SettingDraft): Parsed {
  if (!isEditableSettingKey(dto.key)) return { ok: false, message: 'Not editable' };
  const key = dto.key;
  const bound = writeBound(key);
  if (bound && dto.type === 'ratio' && typeof draft === 'string' && draft !== '') {
    // Ratios with write bounds may be negative (a return, inflation): parsed here, not by the
    // page rule, which reads the registry's 0–100 %.
    const ratio = ratioFromPercentText(draft);
    if (ratio === null) return { ok: false, message: 'Enter a percentage like 20' };
    const n = Number(ratio);
    if (n < bound.min || n > bound.max) {
      return {
        ok: false,
        message: `Enter a percentage from ${bound.min * 100} to ${bound.max * 100}`,
      };
    }
    return { ok: true, value: ratio };
  }
  const parsed = parseDraft(key, draft);
  if (!parsed.ok || parsed.value === null || !bound) return parsed;
  const n = Number(parsed.value);
  if (n < bound.min || n > bound.max) {
    return { ok: false, message: `Enter a whole number from ${bound.min} to ${bound.max}` };
  }
  return parsed;
}

function same(dto: SettingDto, a: SettingValue | null, b: SettingValue | null): boolean {
  if (a === null || b === null) return a === b;
  if (dto.type === 'ratio') return Number(a) === Number(b);
  return a === b;
}

export interface GroupDiff {
  values: Partial<Record<EditableSettingKey, SettingValue | null>>;
  errors: Partial<Record<EditableSettingKey, string>>;
}

/** The changed keys only (a group's PATCH body) and the invalid drafts. */
export function diffGroup(settings: readonly SettingDto[], drafts: SettingDrafts): GroupDiff {
  const diff: GroupDiff = { values: {}, errors: {} };
  for (const key of editableKeys(settings)) {
    const dto = settings.find((s) => s.key === key);
    if (!dto || !(key in drafts)) continue;
    const parsed = parseSetting(dto, drafts[key] ?? null);
    if (!parsed.ok) {
      diff.errors[key] = parsed.message;
      continue;
    }
    if (!same(dto, parsed.value, dto.value)) diff.values[key] = parsed.value;
  }
  return diff;
}

/**
 * The one-or-the-other callout (Stage 4 §6.7): while pristine, the workbook callout when the group
 * holds a workbook key; once edited, when a changed key is one. Otherwise the import-safe note
 * when the group holds an app-only or preference key.
 */
export function groupCallout(
  settings: readonly SettingDto[],
  changed: readonly SettingKey[],
): 'workbook' | 'kept' | null {
  const editable = settings.filter((s) => s.editable && s.lockedBy === null);
  const workbook =
    changed.length === 0
      ? editable.some((s) => s.workbook)
      : changed.some((key) => settings.find((s) => s.key === key)?.workbook === true);
  if (workbook) return 'workbook';
  return editable.some((s) => !s.workbook) ? 'kept' : null;
}

/** Hints for keys whose blank (null) default means "automatic". */
const NULL_DEFAULT_HINTS: Partial<Record<string, string>> = {
  'charts.unitCount': 'Blank = automatic: 12 months, 8 quarters or every year',
};

/** "Default: Monthly · From the workbook" (§6.5 item 2). */
export function fieldHint(dto: SettingDto): string | undefined {
  const parts: string[] = [];
  if (dto.defaultValue !== null && isEditableSettingKey(dto.key)) {
    parts.push(`Default: ${settingText(dto.key, dto.defaultValue) ?? String(dto.defaultValue)}`);
  } else if (dto.defaultValue === null && NULL_DEFAULT_HINTS[dto.key]) {
    parts.push(NULL_DEFAULT_HINTS[dto.key]!);
  }
  if (dto.workbook) {
    if (dto.origin === 'import') parts.push('From the workbook');
    else if (dto.origin === 'app') parts.push('Changed in the app');
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** The pages that read a key, as links (§6.5 item 9); [] for the unused keys. */
export function usedOnPages(dto: SettingDto): { id: string; title: string; path: string }[] {
  return dto.usedOn.flatMap((id) => {
    const page = PAGES.find((p) => p.id === id);
    return page ? [{ id, title: page.title, path: page.path }] : [];
  });
}

/** The live allocation sum from the drafts: "Targets add up to 100%" (§6.5 item 4). */
export function allocationSum(
  settings: readonly SettingDto[],
  drafts: SettingDrafts,
): { text: string; ok: boolean } | null {
  let sum = 0;
  let any = false;
  for (const key of editableKeys(settings)) {
    const dto = settings.find((s) => s.key === key);
    if (!dto || dto.group !== 'allocation') continue;
    const parsed = parseSetting(dto, drafts[key] ?? null);
    if (!parsed.ok || parsed.value === null) continue;
    any = true;
    sum += Number(parsed.value);
  }
  if (!any) return null;
  const rounded = Math.round(sum * 10000) / 10000;
  const text = formatRate(String(rounded)) ?? `${rounded * 100}%`;
  const ok = Math.abs(rounded - 1) < 1e-9;
  return ok
    ? { text: `Targets add up to ${text}`, ok }
    : { text: `Targets add up to ${text}: they should total 100%`, ok };
}

// ─── The tax suggestion (§6.5 item 3, D85, D90) ─────────────────────────────────────────────────

const whole = (cents: number): string => formatMoney(cents, { wholeDollars: true });

/**
 * The suggestion in words, by the Medicare band, in parts (Fixer round 1, STYLE-8): the page sets
 * the FY label in a no-wrap span and the suggested rate in bold. `rate` is null when there is no
 * levy (the sentence names the bracket only).
 */
export interface TaxSuggestionParts {
  /** "For a gross salary of $X in " */
  lead: string;
  /** "FY2026–27" */
  fy: string;
  /** ": the 30% bracket plus … = " (or the whole no-levy sentence after the FY). */
  body: string;
  rate: string | null;
  /** "; the full 2% applies above $Y" (shade-in), else "". */
  tail: string;
}

export function taxSuggestionParts(s: MarginalRateSuggestionDto): TaxSuggestionParts {
  const lead = `For a gross salary of ${whole(s.incomeCents)} in `;
  const fy = formatFinancialYear(s.financialYear);
  const bracket = formatRate(s.bracketRatio) ?? s.bracketRatio;
  const suggested = formatRate(s.suggestedRatio) ?? s.suggestedRatio;
  const levy = formatRate(MEDICARE_LEVY_RATIO) ?? '2%';
  const threshold = s.medicare.thresholdCents;
  const shadeEnd = Math.round(threshold * 1.25);
  switch (s.medicare.band) {
    case 'full':
      return {
        lead,
        fy,
        body: `: the ${bracket} bracket plus the ${levy} Medicare levy = `,
        rate: suggested,
        tail: '',
      };
    case 'shade_in':
      return {
        lead,
        fy,
        body: `: the ${bracket} bracket plus the Medicare levy shade-in (10c per dollar between ${whole(threshold)} and ${whole(shadeEnd)}) = `,
        rate: suggested,
        tail: `; the full ${levy} applies above ${whole(shadeEnd)}`,
      };
    case 'none':
      return {
        lead,
        fy,
        body: `: the ${bracket} bracket; no Medicare levy below ${whole(threshold)}`,
        rate: null,
        tail: '',
      };
  }
}

/** The suggestion in words, by the Medicare band (the parts joined). */
export function taxSuggestionText(s: MarginalRateSuggestionDto): string {
  const p = taxSuggestionParts(s);
  return `${p.lead}${p.fy}${p.body}${p.rate ?? ''}${p.tail}`;
}

export const LITO_TEXT =
  'The low income tax offset is not included: between $37,500 and $66,667 it adds up to 5 points to your true marginal rate.';

/** The notes under the suggestion: an older Medicare threshold or tax table in use. */
export function taxTableNotes(s: MarginalRateSuggestionDto): string[] {
  const notes: string[] = [];
  if (!s.tableCurrent) {
    notes.push(
      `The ${formatFinancialYear(s.financialYear)} rates are not out yet; using ${formatFinancialYear(s.tableFinancialYear)}'s.`,
    );
  }
  if (s.medicare.thresholdFinancialYear < s.financialYear) {
    const fy = (year: number): string => formatFinancialYear(year).replace(/^FY/, '');
    notes.push(
      `The ${fy(s.financialYear)} Medicare threshold is not out yet; using ${fy(s.medicare.thresholdFinancialYear)}'s.`,
    );
  }
  return notes;
}

/** "ATO rates checked 26/09/2026". */
export function checkedOnText(s: MarginalRateSuggestionDto): string {
  return `ATO rates checked ${formatDate(s.checkedOn)}`;
}

/** The bands of the table in use: "$0 – $18,200" … "Over $190,000", each with its rate. */
export function taxBands(s: MarginalRateSuggestionDto): { band: string; rate: string }[] {
  const table = RESIDENT_TAX_TABLES[s.tableFinancialYear] ?? [];
  return table.map((band, i) => {
    const next = table[i + 1];
    const from = band.thresholdCents === 0 ? '$0' : whole(band.thresholdCents + 100);
    return {
      band: next ? `${from} – ${whole(next.thresholdCents)}` : `Over ${whole(band.thresholdCents)}`,
      rate: formatRate(band.ratio) ?? band.ratio,
    };
  });
}

/** True when a draft percentage equals a ratio (the "In use" button). */
export function draftMatches(draft: SettingDraft, ratio: DecimalString): boolean {
  if (typeof draft !== 'string' || draft === '') return false;
  const parsed = ratioFromPercentText(draft);
  return parsed !== null && Number(parsed) === Number(ratio);
}
