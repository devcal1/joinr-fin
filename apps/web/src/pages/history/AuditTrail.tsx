// "Audit trail" (stage-5.md §6.4 item 8): When · Month · Action · By (You / Scheduled / At
// start-up) · Changes (a compact "Cash $X → $Y" list, "+N more" expands) · Note; newest first, at
// most 200 rows. Phone: When, Month, Action, Changes, By, Note (§6.8).
import type { SnapshotAuditDto } from '@joinr/schema';
import { Button, ColumnTable, SectionBar, type ColumnTableColumn } from '@joinr/ui';
import { useState, type JSX } from 'react';
import { Missing } from '../../components/QueryStates';
import { RATE_DP_PLACE } from '../../formatting';
import { useTableLayout } from '../assets/layout';
import { orderColumns } from '../cashflow/formState';
import {
  AUDIT_ACTION_WORDS,
  TRIGGER_WORDS,
  changeKeyLabel,
  changePairText,
  localTimeText,
  monthWords,
} from './display';

/** How many changes a row shows before "+N more". */
export const CHANGES_SHOWN = 2;

function ChangesCell({ entry }: { entry: SnapshotAuditDto }): JSX.Element {
  const [open, setOpen] = useState(false);
  if (entry.changes.length === 0) return <Missing />;
  const shown = open ? entry.changes : entry.changes.slice(0, CHANGES_SHOWN);
  const more = entry.changes.length - shown.length;
  return (
    <span className="jf-app-changes">
      {shown.map((c) => (
        <span key={c.key} className="jf-app-changes__line">
          {changeKeyLabel(c.key)}{' '}
          <span {...RATE_DP_PLACE}>{changePairText(c.key, c.before, c.after)}</span>
        </span>
      ))}
      {more > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          +{more} more
        </Button>
      ) : null}
    </span>
  );
}

const WHEN: ColumnTableColumn<SnapshotAuditDto> = {
  id: 'when',
  header: 'When',
  value: (a) => a.at,
  cell: (a) => <span className="jf-app-nowrap">{localTimeText(a.at)}</span>,
  minWidth: 150,
};

const COLUMNS: Record<string, ColumnTableColumn<SnapshotAuditDto>> = {
  when: WHEN,
  month: {
    id: 'month',
    header: 'Month',
    value: (a) => a.periodMonth,
    cell: (a) => monthWords(a.periodMonth),
  },
  action: { id: 'action', header: 'Action', value: (a) => AUDIT_ACTION_WORDS[a.action] },
  by: { id: 'by', header: 'By', value: (a) => TRIGGER_WORDS[a.trigger] },
  changes: {
    id: 'changes',
    header: 'Changes',
    value: (a) => a.changes.length,
    cell: (a) => <ChangesCell entry={a} />,
    minWidth: 220,
  },
  note: {
    id: 'note',
    header: 'Note',
    value: (a) => a.note,
    cell: (a) => (a.note ? <span className="jf-app-note-cell">{a.note}</span> : <Missing />),
    minWidth: 140,
  },
};

const DESKTOP = ['when', 'month', 'action', 'by', 'changes', 'note'];
const PHONE = ['when', 'month', 'action', 'changes', 'by', 'note'];

export function AuditTrail({ audit }: { audit: readonly SnapshotAuditDto[] }): JSX.Element {
  const layout = useTableLayout();
  return (
    <section className="jf-app-block" aria-labelledby="history-audit-heading">
      <SectionBar id="history-audit-heading" title="Audit trail" role="reference" />
      <div className="jf-app-compact-table jf-app-wide-table">
        <ColumnTable
          columns={orderColumns(
            // From 768 to 1199 px the first column keeps 200 px (§6.8, the Stage 4 compact grid).
            { ...COLUMNS, when: { ...WHEN, minWidth: layout.firstMin(150) } },
            layout.phone ? PHONE : DESKTOP,
          )}
          rows={audit}
          getRowId={(a) => String(a.id)}
          caption="Audit trail"
          emptyMessage="Nothing recorded, corrected or deleted yet."
        />
      </div>
    </section>
  );
}
