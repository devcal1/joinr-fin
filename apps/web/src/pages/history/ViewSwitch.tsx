// The chart view switch of the Net Worth and History pages (stage-5.md §6.3 item 5, §6.4 item 6):
// Monthly | Quarterly | Yearly and a count (6, 12, 24, All) applied to every chart below. The
// choice is sent as the query (a view-only override, never saved); the saved default is changed
// in Settings. The controls stay mounted while a new view loads (§6.2).
import { CHART_DATE_UNITS, type ChartDateUnit } from '@joinr/schema';
import { Select } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';
import type { ChartView } from '../../api/hooks';
import { Segmented } from '../investments/Segmented';
import { UNIT_LABELS, countOfValue, countOptions, countValue } from './display';

const UNIT_OPTIONS = CHART_DATE_UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] }));

export function ViewSwitch({
  unit,
  count,
  onChange,
}: {
  /** The view on screen (from the response). */
  unit: ChartDateUnit;
  count: number | null;
  onChange: (view: ChartView) => void;
}): JSX.Element {
  const value = countValue(count);
  return (
    <div className="jf-app-view-switch" role="group" aria-label="Chart view">
      <Segmented
        label="Group by"
        options={UNIT_OPTIONS}
        value={unit}
        onChange={(next) => onChange({ unit: next, count: countOfValue(value) })}
      />
      <Select
        label="Show"
        className="jf-app-view-switch__count"
        value={value}
        options={countOptions(count)}
        onChange={(next) => onChange({ unit, count: countOfValue(next) })}
      />
      <p className="jf-app-meta jf-app-view-switch__link">
        <Link to="/settings" hash="history">
          Default set in Settings
        </Link>
      </p>
    </div>
  );
}
