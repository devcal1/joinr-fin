// A recorded month's Details (stage-5.md §6.4 item 5): KeyValueTables grouped as the History
// headers; owed figures (the mortgage, accounts in debit, other debts) as positive amounts without
// the stop tint; the extras "—" with "Not recorded (imported month)" on imported months; the row's
// check ("Every stored figure reproduces" or the differences); the month's audit entries.
import type {
  SnapshotAuditDto,
  SnapshotDifferenceDto,
  SnapshotDto,
  SnapshotFigureKey,
} from '@joinr/schema';
import {
  Button,
  Card,
  ColumnTable,
  Grid,
  GridItem,
  KeyValueTable,
  formatDate,
  type ColumnTableColumn,
  type KeyValueItem,
} from '@joinr/ui';
import { X } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { DashWithReason, MoneyCell, RatioCell } from '../investments/cells';
import {
  AUDIT_ACTION_WORDS,
  TRIGGER_WORDS,
  columnLabel,
  lateHowText,
  localTimeText,
  monthWords,
  owedCents,
} from './display';
import {
  NOT_RECORDED_IMPORTED,
  differenceColumn,
  differenceValue,
  differenceWhy,
} from './historyText';

type Kind = 'money' | 'ratio' | 'owed' | 'date';

interface DetailGroup {
  title: string;
  rows: readonly [SnapshotFigureKey, Kind, string?][];
}

const GROUPS: readonly DetailGroup[] = [
  {
    title: 'Investments',
    rows: [
      ['stocksValueCents', 'money'],
      ['stocksGainCents', 'money'],
      ['stocksGainRatio', 'ratio'],
      ['stocksMovementsCents', 'money'],
      ['etfValueCents', 'money'],
      ['etfGainCents', 'money'],
      ['etfGainRatio', 'ratio'],
      ['etfMovementsCents', 'money'],
      ['cryptoValueCents', 'money'],
      ['cryptoGainCents', 'money'],
      ['cryptoGainRatio', 'ratio'],
      ['cryptoMovementsCents', 'money'],
      ['mfValueCents', 'money'],
      ['mfGainCents', 'money'],
      ['mfGainRatio', 'ratio'],
      ['mfMovementsCents', 'money'],
    ],
  },
  {
    title: 'Cash',
    rows: [
      ['cashValueCents', 'money'],
      ['cashGainCents', 'money'],
      ['cashIncreaseRatio', 'ratio'],
      ['cashDebtCents', 'owed', 'Accounts in debit (owed)'],
      ['offsetCents', 'money'],
      ['mortgageOffsetCents', 'money'],
    ],
  },
  {
    title: 'Super',
    rows: [
      ['superValueCents', 'money'],
      ['superContribCents', 'money'],
      ['superGainCents', 'money'],
      ['superGainRatio', 'ratio'],
      ['superMeasuredThrough', 'date'],
    ],
  },
  {
    title: 'Property',
    rows: [
      ['propertyValueCents', 'money'],
      ['propertyPurchaseCents', 'money'],
      ['propertyEquityCents', 'money'],
      ['propertyGainCents', 'money'],
      ['propertyGainRatio', 'ratio'],
      ['mortgageBalanceCents', 'owed', 'Mortgage owed'],
      ['mortgageInterestFeesCents', 'money'],
      ['mortgagePrincipalPaidCents', 'money'],
    ],
  },
  {
    title: 'Other assets',
    rows: [
      ['otherValueCents', 'money'],
      ['otherGainCents', 'money'],
    ],
  },
  { title: 'Pay', rows: [['salaryMonthlyCents', 'money']] },
  {
    title: 'Untracked loans (not rebuilt)',
    rows: [
      ['liabilitiesBalanceCents', 'owed', 'Other debts (owed)'],
      ['liabilitiesPaidCents', 'money'],
    ],
  },
];

const EXTRAS: ReadonlySet<SnapshotFigureKey> = new Set([
  'offsetCents',
  'mortgageOffsetCents',
  'cashDebtCents',
  'superMeasuredThrough',
]);

function valueOf(snapshot: SnapshotDto, key: SnapshotFigureKey, kind: Kind): ReactNode {
  const value = snapshot.figures[key];
  if (value === null) {
    return EXTRAS.has(key) && snapshot.source === 'migrated' ? (
      <DashWithReason reason={NOT_RECORDED_IMPORTED} />
    ) : (
      <DashWithReason reason="Not recorded" />
    );
  }
  switch (kind) {
    case 'ratio':
      return <RatioCell ratio={String(value)} loss />;
    case 'date':
      return formatDate(String(value));
    case 'owed':
      // Owed figures are positive amounts in body text (never the stop tint, §6.4 item 5).
      return <MoneyCell cents={owedCents(value as number)} loss={false} />;
    case 'money':
      return <MoneyCell cents={value as number} />;
  }
}

const DIFFERENCE_COLUMNS: ColumnTableColumn<SnapshotDifferenceDto>[] = [
  { id: 'column', header: 'Column', value: differenceColumn, minWidth: 160 },
  {
    id: 'stored',
    header: 'Stored',
    value: (d) => differenceValue(d, 'stored'),
    numeric: true,
  },
  {
    id: 'recomputed',
    header: 'Recomputed',
    value: (d) => differenceValue(d, 'recomputed'),
    numeric: true,
  },
  { id: 'why', header: 'Why', value: differenceWhy, minWidth: 200 },
];

function auditLine(entry: SnapshotAuditDto): string {
  const when = localTimeText(entry.at) ?? entry.at;
  return `${AUDIT_ACTION_WORDS[entry.action]} · ${TRIGGER_WORDS[entry.trigger]} · ${when}${entry.note ? ` · ${entry.note}` : ''}`;
}

export function SnapshotDetails({
  snapshot,
  audit,
  onClose,
}: {
  snapshot: SnapshotDto;
  audit: readonly SnapshotAuditDto[];
  onClose: () => void;
}): JSX.Element {
  const month = monthWords(snapshot.periodMonth);
  const how = lateHowText(snapshot.source);
  const entries = audit.filter(
    (a) =>
      a.periodMonth === snapshot.periodMonth ||
      a.changes.some((c) => c.key.startsWith(`${snapshot.periodMonth}.`)),
  );
  return (
    <Card
      as="section"
      title={`${month} details`}
      subtitle={`Recorded ${formatDate(snapshot.runDate)}${how ? ` · ${how}` : ''}`}
      actions={
        <Button variant="ghost" size="sm" icon={X} onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="jf-app-block">
        <Grid>
          {GROUPS.map((group) => {
            const items: KeyValueItem[] = group.rows.map(([key, kind, label]) => ({
              label: label ?? columnLabel(key),
              value: valueOf(snapshot, key, kind),
              numeric: kind !== 'date',
            }));
            return (
              <GridItem key={group.title} span={6} spanTablet={6}>
                <div className="jf-app-block jf-app-block--tight">
                  <h4 className="jf-app-subhead__title">{group.title}</h4>
                  <KeyValueTable caption={`${month}: ${group.title}`} items={items} />
                </div>
              </GridItem>
            );
          })}
        </Grid>
        {snapshot.note ? <p className="jf-app-meta">Note: {snapshot.note}</p> : null}
        <div className="jf-app-block jf-app-block--tight">
          <h4 className="jf-app-subhead__title">Check</h4>
          {snapshot.check.differences.length === 0 ? (
            <p data-testid="details-check">Every stored figure reproduces</p>
          ) : (
            <ColumnTable
              columns={DIFFERENCE_COLUMNS}
              rows={snapshot.check.differences}
              getRowId={(d) => d.column}
              caption={`${month}: differences`}
            />
          )}
        </div>
        <div className="jf-app-block jf-app-block--tight">
          <h4 className="jf-app-subhead__title">Audit trail</h4>
          {entries.length === 0 ? (
            <p className="jf-app-muted">No entries for this month</p>
          ) : (
            <ul className="jf-app-note-list" aria-label={`${month}: audit entries`}>
              {entries.map((entry) => (
                <li key={entry.id} className="jf-app-note-list__item">
                  {auditLine(entry)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
