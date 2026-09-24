// A Card holding a chart and its table twin, with a Chart | Table toggle. A chart never replaces
// the numbers (STYLE_GUIDE §6): the table view is always one click (or key press) away.
import { ChartColumn, Table2 } from 'lucide-react';
import { useId, useState, type JSX } from 'react';
import { Button, Card } from '../core';
import type { ChartCardProps } from './types';

type ChartView = 'chart' | 'table';

const VIEWS: readonly { view: ChartView; label: string; icon: typeof ChartColumn }[] = [
  { view: 'chart', label: 'Chart', icon: ChartColumn },
  { view: 'table', label: 'Table', icon: Table2 },
];

export function ChartCard({
  title,
  subtitle,
  chart,
  table,
  defaultView = 'chart',
  actions,
}: ChartCardProps): JSX.Element {
  const [view, setView] = useState<ChartView>(defaultView);
  const panelId = useId();

  const toggle = (
    <div className="jf-chart-card__toggle" role="group" aria-label={`${title}: view as`}>
      {VIEWS.map((option) => {
        const pressed = view === option.view;
        return (
          <Button
            key={option.view}
            size="sm"
            variant={pressed ? 'secondary' : 'ghost'}
            icon={option.icon}
            aria-pressed={pressed}
            aria-controls={panelId}
            onClick={() => setView(option.view)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );

  return (
    <Card
      as="section"
      title={title}
      subtitle={subtitle}
      className="jf-chart-card"
      actions={
        <>
          {actions}
          {toggle}
        </>
      }
    >
      <div id={panelId} className="jf-chart-card__panel" data-view={view}>
        {view === 'chart' ? chart : table}
      </div>
    </Card>
  );
}
