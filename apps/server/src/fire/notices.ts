// The FIRE notices (stage-6.md §3.3, §3.4, §4.5): the D98 access-age note (the FIRE page shows it
// from `inputs.accessAge.replaced`; the Settings field shows it as `SettingDto.notice`) and the
// import-origin super contribution note on the Settings field. Wording only; no figure but the ages.
import type { FireAccessAgeReplacedDto, Origin, SettingKey } from '@joinr/schema';
import { localIsoDate } from '../investments/format';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** An instant as a prose date (STYLE_GUIDE §8 `d MMMM yyyy`), on the server's calendar. */
export function proseDate(iso: string): string {
  const day = localIsoDate(new Date(iso));
  const month = MONTHS[Number(day.slice(5, 7)) - 1];
  return `${Number(day.slice(8, 10))} ${month} ${day.slice(0, 4)}`;
}

/** The D98 note (§3.4). */
export function accessAgeNotice(replaced: FireAccessAgeReplacedDto): string {
  return (
    `Access age changed from ${replaced.from} (the workbook) to ${replaced.to} on ` +
    `${proseDate(replaced.at)}: 60 is the preservation age for anyone born after 30 June 1964; ` +
    '65 is when super is released unconditionally.'
  );
}

/** The Settings note on an import-origin super contribution (owner question 1, §4.5). */
export const WORKBOOK_CONTRIBUTION_NOTICE =
  'From the workbook. The FIRE page uses your super contributions from the last 12 months unless you set a figure here.';

/**
 * `SettingDto.notice` (§4.5): the D98 note on `fire.preservationAge` while it applies, the
 * workbook note on an import-origin `fire.superContributionPerYearCents`, null otherwise.
 */
export function fireSettingNotice(
  key: SettingKey,
  o: { origin: Origin | null; replaced: FireAccessAgeReplacedDto | null },
): string | null {
  if (key === 'fire.preservationAge' && o.replaced !== null) return accessAgeNotice(o.replaced);
  if (key === 'fire.superContributionPerYearCents' && o.origin === 'import') {
    return WORKBOOK_CONTRIBUTION_NOTICE;
  }
  return null;
}
