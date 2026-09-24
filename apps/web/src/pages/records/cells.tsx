// Cell renderers for the generic record table, one per RecordColumnType (stage-1.md §6.3).
import type {
  RecordCell,
  RecordColumn,
  RecordColumnType,
  RecordEntityId,
  RecordRow,
  ReviewFlag,
  SettingType,
} from '@joinr/schema';
import {
  Amount,
  MINUS,
  StatusBadge,
  formatDate,
  formatMonth,
  formatPercent,
  formatPrice,
  formatQuantity,
  type ColumnTableColumn,
} from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import { Missing } from '../../components/QueryStates';
import { formatCount, formatDateTime } from '../../formatting';
import { KIND_LABELS } from '../prices/priceDisplay';

/** Readable words for the review flags (D26). */
export const FLAG_LABELS: Readonly<Record<ReviewFlag, string>> = {
  out_of_order: 'Out of order',
  price_outlier: 'Price outlier',
  oversell: 'Oversell',
  future_date: 'Future date',
  non_positive_price: 'Non-positive price',
  zero_units: 'Zero units',
  unmatched_ticker: 'Unmatched ticker',
  unmatched_account: 'Unmatched account',
};

export function flagLabel(flag: string): string {
  return (FLAG_LABELS as Record<string, string>)[flag] ?? flag.replace(/_/g, ' ');
}

/** Column types shown right-aligned and monospaced. */
const NUMERIC_TYPES: ReadonlySet<RecordColumnType> = new Set([
  'integer',
  'money',
  'quantity',
  'price',
  'ratio',
]);

export function isNumericType(type: RecordColumnType): boolean {
  return NUMERIC_TYPES.has(type);
}

/** Runs a formatter; a value it rejects is shown as sent rather than breaking the page. */
function safe(format: () => string, value: RecordCell): string {
  try {
    return format();
  } catch {
    return String(value);
  }
}

function formatInteger(value: RecordCell): string {
  return typeof value === 'number' ? formatCount(value) : String(value);
}

function formatBoolean(value: RecordCell): string {
  return value === true ? 'Yes' : value === false ? 'No' : String(value);
}

function renderFlags(value: RecordCell): ReactNode {
  const flags = Array.isArray(value) ? value : [String(value)];
  if (flags.length === 0) return <Missing />;
  return (
    <span className="jf-app-flags">
      {flags.map((flag) => (
        <StatusBadge key={flag} status="check" label={flagLabel(flag)} />
      ))}
    </span>
  );
}

function renderMoney(value: RecordCell): ReactNode {
  return typeof value === 'number' && Number.isSafeInteger(value) ? (
    <Amount cents={value} />
  ) : (
    String(value)
  );
}

/** A figure inside a left-aligned text column: monospaced and tabular, not right-aligned. */
function inlineFigure(text: string): JSX.Element {
  return <span className="jf-app-num jf-app-num--inline">{text}</span>;
}

/**
 * A settings row's value, formatted by the row's `valueType`. The Value column mixes words and
 * figures, so it stays left-aligned; figures (money, percentages, integers, dates) are set in the
 * mono face (STYLE_GUIDE §3) and enum codes read as words ("monthly" → "Monthly").
 */
export function renderSettingValue(
  value: RecordCell,
  valueType: SettingType | undefined,
): ReactNode {
  if (value === null) return <Missing />;
  switch (valueType) {
    case 'money':
      return renderMoney(value);
    case 'ratio':
      return inlineFigure(safe(() => formatPercent(Number(value), { dp: 2 }), value));
    case 'integer':
      // Small counts and years (a birth year reads 1990, not 1,990); U+2212 for negatives.
      return inlineFigure(String(value).replace(/^-/, MINUS));
    case 'boolean':
      return formatBoolean(value);
    case 'date':
      return inlineFigure(
        typeof value === 'string' ? safe(() => formatDate(value), value) : String(value),
      );
    case 'enum':
      return typeof value === 'string' ? enumWords(value) : String(value);
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

/** The display for one cell. `null` (and an empty flag list) → a muted dash. */
export function renderCell(type: RecordColumnType, value: RecordCell, row?: RecordRow): ReactNode {
  if (value === null) return <Missing />;
  switch (type) {
    case 'money':
      return renderMoney(value);
    case 'quantity':
      return safe(() => formatQuantity(value as string | number, { maxDp: 8 }), value);
    case 'price':
      return safe(() => formatPrice(value as string | number, { maxDp: 8 }), value);
    case 'ratio':
      return safe(() => formatPercent(Number(value), { dp: 2 }), value);
    case 'integer':
      return formatInteger(value);
    case 'date':
      return safe(() => formatDate(String(value)), value);
    case 'month':
      return safe(() => formatMonth(String(value)), value);
    case 'timestamp':
      return formatDateTime(String(value));
    case 'boolean':
      return formatBoolean(value);
    case 'flags':
      return renderFlags(value);
    case 'setting':
      return renderSettingValue(value, row?.valueType);
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

/** The sort key for one cell: numbers for figures, ISO text for dates, words otherwise. */
export function sortValue(type: RecordColumnType, value: RecordCell): string | number | null {
  if (value === null) return null;
  if (Array.isArray(value)) return value.length ? value.map(flagLabel).join(', ') : null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value;
  if (isNumericType(type)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  return value;
}

/** Enum-valued text columns, shown as words ("managed_fund" → "Managed fund"). */
const ENUM_TEXT_COLUMNS: ReadonlySet<string> = new Set(['kind', 'source', 'priceSource', 'metal']);

/** Short code-like text columns that never wrap, so rows keep one height. */
const NOWRAP_TEXT_COLUMNS: ReadonlySet<string> = new Set([
  'sheetRef',
  'symbol',
  'ticker',
  'kind',
  'key',
  'currency',
  'correction',
  'providerSymbol',
]);

/** "managed_fund" → "Managed fund"; instrument kinds use their labels ("etf" → "ETF"). */
export function enumWords(value: string): string {
  const known = (KIND_LABELS as Record<string, string>)[value];
  if (known) return known;
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Free-text columns that get a sensible minimum width instead of one word per line. */
const WIDE_TEXT_COLUMNS: ReadonlySet<string> = new Set([
  'name',
  'label',
  'description',
  'note',
  'url',
]);
export const WIDE_TEXT_MIN_WIDTH = 200;

function isEnumTextColumn(columnId: string, entity: RecordEntityId | undefined): boolean {
  // Settings categories are codes ("allocation"); other entities' categories are the owner's words.
  return ENUM_TEXT_COLUMNS.has(columnId) || (entity === 'settings' && columnId === 'category');
}

/**
 * Money columns whose sign is a direction, not a loss: a sell's order value and a month's net
 * movement. Their negatives keep the U+2212 sign but use body text, not the stop tint (D33).
 */
export const SIGNED_FLOW_COLUMNS: Readonly<Partial<Record<RecordEntityId, ReadonlySet<string>>>> = {
  trades: new Set(['orderValue']),
  snapshots: new Set(['stocksMovements', 'etfMovements', 'cryptoMovements', 'mfMovements']),
};

function isSignedFlow(columnId: string, entity: RecordEntityId | undefined): boolean {
  return entity !== undefined && (SIGNED_FLOW_COLUMNS[entity]?.has(columnId) ?? false);
}

function renderColumnCell(
  column: RecordColumn,
  row: RecordRow,
  entity: RecordEntityId | undefined,
): ReactNode {
  const value = row.cells[column.id] ?? null;
  if (
    column.type === 'money' &&
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    isSignedFlow(column.id, entity)
  )
    return <Amount cents={value} colorNegative={false} />;
  if (column.type !== 'text' || typeof value !== 'string')
    return renderCell(column.type, value, row);
  const text = isEnumTextColumn(column.id, entity) ? enumWords(value) : value;
  return NOWRAP_TEXT_COLUMNS.has(column.id) ? <span className="jf-app-nowrap">{text}</span> : text;
}

/** The column shown first (and sticky) for an entity, when it is not the registry's first. */
const FIRST_COLUMNS: Readonly<Partial<Record<RecordEntityId, string>>> = {
  instruments: 'symbol',
  // The readable label, then the key (D35).
  settings: 'label',
};

/**
 * The web's column order for an entity. The registry order is frozen (§2.6); for instruments the
 * symbol and for settings the label come first here, so the sticky first column names the row.
 */
function displayOrder(
  columns: readonly RecordColumn[],
  entity: RecordEntityId | undefined,
): readonly RecordColumn[] {
  const firstId = entity === undefined ? undefined : FIRST_COLUMNS[entity];
  const first = firstId === undefined ? undefined : columns.find((column) => column.id === firstId);
  return first ? [first, ...columns.filter((column) => column !== first)] : columns;
}

/** Registry columns → ColumnTable columns (all sortable; figures right-aligned and monospaced). */
export function recordTableColumns(
  columns: readonly RecordColumn[],
  entity?: RecordEntityId,
): ColumnTableColumn<RecordRow>[] {
  return displayOrder(columns, entity).map((column): ColumnTableColumn<RecordRow> => ({
    id: column.id,
    header: column.label,
    value: (row) => sortValue(column.type, row.cells[column.id] ?? null),
    cell: (row): JSX.Element => <>{renderColumnCell(column, row, entity)}</>,
    numeric: isNumericType(column.type),
    sortable: true,
    ...(column.type === 'text' && WIDE_TEXT_COLUMNS.has(column.id)
      ? { minWidth: WIDE_TEXT_MIN_WIDTH }
      : {}),
  }));
}
