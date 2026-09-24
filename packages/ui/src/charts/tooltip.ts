// Tooltip markup (pure). ECharts renders the returned HTML inside the chart container; charts.css
// styles it. Values lead and labels follow; series are keyed with a short stroke or a swatch.
// Every label is escaped, and colours are allow-listed, because labels are data.
import { escapeHtml } from './format';
import { CHART_OTHER, isSafeColor } from './palette';

export interface TooltipRow {
  name: string;
  value: string;
  color: string;
  /** 'line' for line/area series, 'swatch' for bars and slices. Default 'swatch'. */
  key?: 'line' | 'swatch';
  /** Secondary text after the name, e.g. "42.0%" or "Gain". */
  note?: string;
}

export interface TooltipContent {
  title?: string;
  rows: TooltipRow[];
  /** Emphasised last row, e.g. the stack total. */
  total?: { name: string; value: string };
}

/** A note that is a figure ("41.7%", "−2.1%", "$1,200") is monospaced; a word ("Gain") is not. */
const FIGURE_NOTE = /^[-+−]?\$?[\d,.]+%?$/;

function noteHtml(note: string | undefined): string {
  if (!note) return '';
  const cls = FIGURE_NOTE.test(note.trim())
    ? 'jf-chart-tooltip__note jf-chart-tooltip__note--num'
    : 'jf-chart-tooltip__note';
  return `<span class="${cls}">${escapeHtml(note)}</span>`;
}

function row(r: TooltipRow): string {
  const color = isSafeColor(r.color) ? r.color.trim() : CHART_OTHER;
  const key = r.key === 'line' ? 'line' : 'swatch';
  const note = noteHtml(r.note);
  return (
    `<div class="jf-chart-tooltip__row">` +
    `<span class="jf-chart-tooltip__key jf-chart-tooltip__key--${key}" style="background-color:${color}"></span>` +
    `<span class="jf-chart-tooltip__value">${escapeHtml(r.value)}</span>` +
    `<span class="jf-chart-tooltip__name">${escapeHtml(r.name)}${note}</span>` +
    `</div>`
  );
}

/** Builds the tooltip HTML string. */
export function tooltipHtml({ title, rows, total }: TooltipContent): string {
  const head = title ? `<div class="jf-chart-tooltip__title">${escapeHtml(title)}</div>` : '';
  const foot = total
    ? `<div class="jf-chart-tooltip__row jf-chart-tooltip__row--total">` +
      `<span class="jf-chart-tooltip__key" aria-hidden="true"></span>` +
      `<span class="jf-chart-tooltip__value">${escapeHtml(total.value)}</span>` +
      `<span class="jf-chart-tooltip__name">${escapeHtml(total.name)}</span>` +
      `</div>`
    : '';
  return `<div class="jf-chart-tooltip">${head}${rows.map(row).join('')}${foot}</div>`;
}

/** Reads `{ seriesIndex, dataIndex }` from ECharts formatter params (item or axis trigger). */
export function readParamIndex(params: unknown): { seriesIndex: number; dataIndex: number } | null {
  const first: unknown = Array.isArray(params) ? (params as unknown[])[0] : params;
  if (typeof first !== 'object' || first === null) return null;
  const { seriesIndex, dataIndex } = first as { seriesIndex?: unknown; dataIndex?: unknown };
  if (typeof dataIndex !== 'number') return null;
  return { seriesIndex: typeof seriesIndex === 'number' ? seriesIndex : 0, dataIndex };
}
