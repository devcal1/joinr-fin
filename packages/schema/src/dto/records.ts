// Record browser DTOs (stage-1.md §3.3, frozen).
import type { RecordColumn, RecordEntityId, RecordGroupId } from '../records';
import type { SettingType } from '../settings';

/** money = integer cents; quantities, prices and ratios = decimal strings; flags = string[]. */
export type RecordCell = string | number | boolean | string[] | null;

export interface RecordRow {
  id: string;
  cells: Record<string, RecordCell>;
  /** Settings rows only: how to format the `value` cell. */
  valueType?: SettingType;
}

export interface RecordEntitySummary {
  id: RecordEntityId;
  label: string;
  group: RecordGroupId;
  count: number;
}

/** Entities in registry order. */
export interface RecordsIndexResponse {
  entities: RecordEntitySummary[];
}

export interface RecordsPageResponse {
  entity: RecordEntitySummary;
  columns: RecordColumn[];
  rows: RecordRow[];
}
