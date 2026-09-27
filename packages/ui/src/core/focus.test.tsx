// Keyboard focus (web-polish-ui, stage-6.md §6.9 F): every ui control shows the teal 2 px ring on
// :focus-visible, and no stylesheet removes a focus outline without drawing a ring elsewhere. The
// e2e (e2e/polish.spec.ts) walks the real pages; these tests guard the ui package's own rules.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChartCard } from '../charts/ChartCard';
import { Button } from './forms/Button';
import { Checkbox } from './forms/Checkbox';
import { TextField } from './forms/TextField';
import { ColumnTable } from './table/ColumnTable';
import { ALL_UI_STYLESHEETS, readUiCss } from './testing/cssHarness';

/**
 * Rules allowed to remove a focus outline, each with where its ring is drawn instead.
 * - The input control: its frame rings (`.jf-input:focus-within`, a teal border + outline).
 * - The main landmark: a programmatic focus target (tabIndex -1 after navigation), never tabbed to.
 */
const OUTLINE_REMOVAL_ALLOWED: Record<string, string> = {
  '.jf-input__control:focus': '.jf-input:focus-within',
  '.jf-input__control:focus-visible': '.jf-input:focus-within',
  '.jf-shell__main:focus': 'programmatic focus target',
};

/** `selector { body }` pairs of every plain rule in a stylesheet (comments removed). */
function rulesOf(css: string): { selectors: string[]; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selectors: string[]; body: string }[] = [];
  for (const match of text.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({ selectors, body: match[2] ?? '' });
  }
  return out;
}

describe('focus ring rules', () => {
  it('the base ring is a 2 px teal outline on :focus-visible', () => {
    const base = rulesOf(readUiCss('base')).find((r) => r.selectors.includes(':focus-visible'));
    expect(base?.body).toMatch(/outline:\s*2px solid var\(--teal\)/);
  });

  it('no ui stylesheet removes a focus outline outside the documented exceptions', () => {
    const offenders: string[] = [];
    for (const sheet of ALL_UI_STYLESHEETS) {
      for (const rule of rulesOf(readUiCss(sheet))) {
        if (!/outline(-style)?:\s*(none|0)\b/.test(rule.body)) continue;
        for (const selector of rule.selectors) {
          if (/:focus/.test(selector) && !(selector in OUTLINE_REMOVAL_ALLOWED)) {
            offenders.push(`${sheet}: ${selector}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every exception has its replacement ring', () => {
    const forms = rulesOf(readUiCss('forms'));
    const frame = forms.find((r) => r.selectors.includes('.jf-input:focus-within'));
    expect(frame?.body).toMatch(/outline:\s*1px solid var\(--teal\)/);
    expect(frame?.body).toMatch(/border-color:\s*var\(--teal\)/);
    const boxes = forms.find((r) =>
      r.selectors.includes('.jf-check__input:focus-visible + .jf-check__box'),
    );
    expect(boxes?.body).toMatch(/outline:\s*2px solid var\(--teal\)/);
  });
});

/** Selectors whose rule draws a teal focus ring (an outline, or a frame's border + outline). */
function ringSelectors(): string[] {
  return ALL_UI_STYLESHEETS.flatMap((sheet) =>
    rulesOf(readUiCss(sheet))
      .filter((rule) => /outline:\s*\d+px solid var\(--teal\)/.test(rule.body))
      .flatMap((rule) => rule.selectors.filter((selector) => /:focus/.test(selector))),
  );
}

/**
 * Whether a ring rule applies to the element. jsdom never applies :focus rules in computed styles
 * and its :focus-visible heuristic is unreliable after the first Tab, so the selectors are matched
 * with :focus-visible read as :focus (keyboard focus is what these tests simulate).
 */
function ringed(element: Element): boolean {
  return ringSelectors().some((selector) =>
    element.matches(selector.replaceAll(':focus-visible', ':focus')),
  );
}

describe('focus ring on the ui controls', () => {
  it('buttons, the Chart | Table toggle and sort headers get the ring when tabbed to', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button>Save</Button>
        <ChartCard title="Example" chart={<p>chart</p>} table={<p>table</p>} />
        <ColumnTable
          caption="Rows"
          columns={[
            { id: 'name', header: 'Name', value: (r: { n: string }) => r.n, sortable: true },
            { id: 'n2', header: 'Other', value: (r) => r.n },
          ]}
          rows={[{ n: 'A' }]}
          getRowId={(r) => r.n}
        />
      </>,
    );
    const targets = [
      screen.getByRole('button', { name: 'Save' }),
      screen.getByRole('button', { name: 'Chart' }),
      screen.getByRole('button', { name: 'Table' }),
      screen.getByRole('button', { name: /Name/ }),
    ];
    for (const target of targets) {
      await user.tab();
      expect(document.activeElement).toBe(target);
      expect(ringed(target), target.textContent ?? '').toBe(true);
    }
  });

  it('a text field rings its frame; a checkbox rings its box', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <TextField label="Name" value="" onChange={() => undefined} />
        <Checkbox label="Include" checked={false} onChange={() => undefined} />
      </>,
    );
    await user.tab();
    const frame = container.querySelector('.jf-input') as HTMLElement;
    expect(frame.contains(document.activeElement)).toBe(true);
    expect(ringed(frame)).toBe(true);
    await user.tab();
    const box = container.querySelector('.jf-check__box') as HTMLElement;
    expect(ringed(box)).toBe(true);
  });
});
