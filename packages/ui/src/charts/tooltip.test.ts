import { describe, expect, it } from 'vitest';
import { CHART_OTHER } from './palette';
import { readParamIndex, tooltipHtml } from './tooltip';

describe('tooltipHtml', () => {
  it('puts the value before the name and keys rows by kind', () => {
    const html = tooltipHtml({
      title: 'Jan 2026',
      rows: [
        { name: 'Net worth', value: '$12,480', color: '#07AE8B', key: 'line' },
        { name: 'Cash', value: '$1,400', color: '#7744DD', note: '11.2%' },
      ],
    });
    expect(html).toContain('<div class="jf-chart-tooltip__title">Jan 2026</div>');
    expect(html.indexOf('$12,480')).toBeLessThan(html.indexOf('Net worth'));
    expect(html).toContain('jf-chart-tooltip__key--line" style="background-color:#07AE8B"');
    expect(html).toContain('jf-chart-tooltip__key--swatch" style="background-color:#7744DD"');
    expect(html).toContain(
      '<span class="jf-chart-tooltip__note jf-chart-tooltip__note--num">11.2%</span>',
    );
  });

  it('sets a figure note in mono and leaves a word note alone', () => {
    const html = (note: string): string =>
      tooltipHtml({ rows: [{ name: 'X', value: '1', color: '#07AE8B', note }] });
    for (const figure of ['41.7%', '−2.1%', '+0.5%', '$1,200', '12']) {
      expect(html(figure), figure).toContain('jf-chart-tooltip__note--num');
    }
    for (const word of ['Gain', 'Loss', 'No change', '12 months']) {
      expect(html(word), word).not.toContain('jf-chart-tooltip__note--num');
    }
  });

  it('escapes labels and refuses unsafe colours', () => {
    const html = tooltipHtml({
      title: '<img src=x onerror=alert(1)>',
      rows: [{ name: '<b>ABC</b>', value: '1 & 2', color: 'red" onmouseover="x' }],
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;ABC&lt;/b&gt;');
    expect(html).toContain('1 &amp; 2');
    expect(html).toContain(`background-color:${CHART_OTHER}`);
    expect(html).not.toContain('onmouseover');
  });

  it('adds a total row last', () => {
    const html = tooltipHtml({
      rows: [{ name: 'A', value: '1', color: '#07AE8B' }],
      total: { name: 'Total', value: '3' },
    });
    expect(html).toMatch(/jf-chart-tooltip__row--total.*Total<\/span><\/div><\/div>$/);
  });
});

describe('readParamIndex', () => {
  it('reads item and axis params', () => {
    expect(readParamIndex({ seriesIndex: 2, dataIndex: 4 })).toEqual({
      seriesIndex: 2,
      dataIndex: 4,
    });
    expect(readParamIndex([{ seriesIndex: 1, dataIndex: 3 }, { seriesIndex: 0 }])).toEqual({
      seriesIndex: 1,
      dataIndex: 3,
    });
    expect(readParamIndex({ dataIndex: 0 })).toEqual({ seriesIndex: 0, dataIndex: 0 });
  });

  it('returns null for anything else', () => {
    expect(readParamIndex(null)).toBeNull();
    expect(readParamIndex([])).toBeNull();
    expect(readParamIndex({ seriesIndex: 1 })).toBeNull();
    expect(readParamIndex('x')).toBeNull();
  });
});
