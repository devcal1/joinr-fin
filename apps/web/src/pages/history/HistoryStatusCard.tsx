// The History status card (stage-5.md §6.4 item 2, §6.9): the latest recorded month's net worth
// (the page's one teal figure), auto-record (on with the next record time in the server's wall
// time, off with a link to Settings, or set by the server), the last automatic run, the missing
// months with "Record them now" (it opens the record form with them ticked; it never records by
// itself) and the gaps.
import type { HistoryPageResponse, IsoMonth } from '@joinr/schema';
import { Button, Card, KeyValueTable, StatTile, formatDate, formatMoney } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { CalendarPlus } from 'lucide-react';
import type { JSX } from 'react';
import { autoRecordText, lastRunText, lastRunTime, monthWords } from './display';
import { gapsText, missingText } from './historyText';

export function HistoryStatusCard({
  page,
  onRecordMissing,
}: {
  page: HistoryPageResponse;
  onRecordMissing: (months: IsoMonth[]) => void;
}): JSX.Element {
  const latest = page.snapshots[0] ?? null;
  const { recorder, record } = page;
  const autoRecord = autoRecordText(recorder);
  return (
    <Card as="section" title="Status">
      <div className="jf-app-status-card">
        <StatTile
          label="Latest recorded"
          value={latest ? formatMoney(latest.netWorth.netWorthCents, { wholeDollars: true }) : '—'}
          keyFigure={latest !== null}
          hint={
            latest
              ? `${monthWords(latest.periodMonth)} · recorded ${formatDate(latest.runDate)}`
              : 'No month recorded yet'
          }
        />
        <KeyValueTable
          caption="Recording status"
          items={[
            {
              label: 'Auto-record',
              value: (
                <span className="jf-app-kv-stack" data-testid="auto-record-status">
                  <span>{autoRecord}</span>
                  {recorder.autoRecord.source === 'setting' ? (
                    <Link to="/settings" hash="history">
                      Change in Settings
                    </Link>
                  ) : null}
                </span>
              ),
            },
            {
              label: 'Last automatic run',
              value: (
                <span data-testid="last-run">
                  {recorder.running ? 'Recording now' : lastRunText(recorder)}
                  {!recorder.running && lastRunTime(recorder) ? (
                    <span className="jf-app-meta"> · {lastRunTime(recorder)}</span>
                  ) : null}
                </span>
              ),
            },
            {
              label: 'Missing months',
              value:
                record.missing.length > 0 ? (
                  <span className="jf-app-kv-stack jf-app-kv-stack--start">
                    <span>{missingText(record.missing)}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={CalendarPlus}
                      data-cf-action="record-missing"
                      onClick={() => onRecordMissing(record.missing)}
                    >
                      Record them now
                    </Button>
                  </span>
                ) : (
                  <span className="jf-app-muted">None</span>
                ),
            },
            {
              label: 'Gaps',
              value:
                record.gaps.length > 0 ? (
                  gapsText(record.gaps)
                ) : (
                  <span className="jf-app-muted">None</span>
                ),
            },
          ]}
        />
      </div>
    </Card>
  );
}
