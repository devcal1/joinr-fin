// The what-if panel on the FIRE page (stage-6.md §6.2, §6.4, D100): field and slider in sync, an
// off-step value shown as is, a saved 0.0375 showing no what-if, sliders' ranges extended to the
// current value, keys through the handler, one request per burst with only the changed fields,
// "Saved: X", Enter sends one GET and no PATCH, Save PATCHes only the changed keys (with the save
// summary), Reset, untouched fields following a refetch, server errors mapped to fields, no Loading
// line while recomputing (aria-busy, "Updating…"), the what-if failure callout, the live region
// texts and focus after Save and Reset.
import type { FirePageResponse } from '@joinr/schema';
import { apiErrors, firePages, fireSettingsPatchResponse } from '@joinr/schema/fixtures';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockHandler, type MockReply, type MockRequest } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';
import { WHAT_IF_DEBOUNCE_MS } from './whatIf';

const onTrack = firePages.onTrack;

/** A page whose saved and derived inputs are adjusted. */
function withInputs(
  base: FirePageResponse,
  inputs: Partial<FirePageResponse['inputs']>,
): FirePageResponse {
  return { ...base, inputs: { ...base.inputs, ...inputs } };
}

/** The saved plan without a query; `whatIf` (or the given handler) for any query. */
function fireHandler(
  saved: () => FirePageResponse,
  whatIf: (req: MockRequest) => MockReply | Promise<MockReply> = () => ({ body: firePages.whatIf }),
): MockHandler {
  return (req) => ([...req.query.keys()].length === 0 ? { body: saved() } : whatIf(req));
}

async function openPage(handler: MockHandler, routes: Record<string, MockHandler> = {}) {
  const api = mockApi({ 'GET /api/fire': handler, ...routes });
  const view = renderApp('/fire');
  await screen.findByRole('heading', { level: 2, name: 'What if' });
  return { ...view, api };
}

function field(name: string): HTMLInputElement {
  return screen.getByRole('textbox', { name });
}

function slider(name: string): HTMLInputElement {
  return screen.getByRole('slider', { name });
}

/** The GETs of /api/fire with a query (what-ifs), as plain objects. */
function whatIfCalls(api: { calls: (route: string) => MockRequest[] }): Record<string, string>[] {
  return api
    .calls('GET /api/fire')
    .filter((r) => [...r.query.keys()].length > 0)
    .map((r) => Object.fromEntries(r.query.entries()));
}

/** Waits past the debounce so a pending request would have gone out. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, WHAT_IF_DEBOUNCE_MS + 150));
  });
}

function results(): HTMLElement {
  return document.querySelector('.jf-app-fire-results') as HTMLElement;
}

function strip(): HTMLElement {
  return document.querySelector('.jf-app-fire-strip') as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what-if: fields and sliders (§6.4)', () => {
  it('lays out the six labelled fields, each with its slider, at the values in use', async () => {
    await openPage(fireHandler(() => onTrack));
    expect(field('Yearly spend').value).toBe('40,000');
    expect(field('Withdrawal rate').value).toBe('5');
    expect(field('Inflation rate').value).toBe('2');
    expect(field('Market return').value).toBe('6.12');
    expect(field('Access age').value).toBe('60');
    expect(field('Extra savings a year').value).toBe('0');
    expect(slider('Yearly spend').value).toBe('40000');
    expect(slider('Yearly spend')).toHaveAttribute('aria-valuetext', '$40,000 a year');
    expect(slider('Withdrawal rate')).toHaveAttribute('aria-valuetext', '5.0%');
    expect(slider('Access age')).toHaveAttribute('aria-valuetext', 'age 60');
    expect(strip()).toHaveTextContent('FIRE in 2031 · age 56');
    expect(screen.getByText('Saving never blocks re-importing the workbook.')).toBeVisible();
  });

  it('keeps field and slider in sync both ways', async () => {
    const { user } = await openPage(fireHandler(() => onTrack));
    await user.clear(field('Yearly spend'));
    await user.type(field('Yearly spend'), '45000');
    expect(slider('Yearly spend').value).toBe('45000');
    fireEvent.change(slider('Withdrawal rate'), { target: { value: '4.5' } });
    expect(field('Withdrawal rate').value).toBe('4.5');
    expect(slider('Withdrawal rate')).toHaveAttribute('aria-valuetext', '4.5%');
  });

  it('shows an off-step value as is and starts no what-if', async () => {
    const derived = withInputs(onTrack, {
      yearlySpend: {
        cents: 4_123_700,
        source: 'derived',
        savedCents: null,
        derivedCents: 4_123_700,
      },
    });
    const { api } = await openPage(fireHandler(() => derived));
    expect(field('Yearly spend').value).toBe('41,237');
    await settle();
    expect(whatIfCalls(api)).toEqual([]);
    // Moving the slider snaps to its step.
    fireEvent.keyDown(slider('Yearly spend'), { key: 'ArrowRight' });
    expect(field('Yearly spend').value).toBe('41,500');
  });

  it('shows a saved 0.0375 at its precision with no what-if', async () => {
    const saved = withInputs(onTrack, {
      withdrawalRate: { ratio: '0.0375', source: 'setting', savedRatio: '0.0375' },
    });
    const { api } = await openPage(fireHandler(() => saved));
    expect(field('Withdrawal rate').value).toBe('3.75');
    await settle();
    expect(whatIfCalls(api)).toEqual([]);
    expect(screen.queryByText(/^Saved: /)).toBeNull();
  });

  it('extends each slider’s range to include the current value', async () => {
    const odd = withInputs(onTrack, {
      inflationRate: { ratio: '-0.005', source: 'setting', savedRatio: '-0.005' },
      accessAge: { value: 50, source: 'setting', savedValue: 50, replaced: null },
      withdrawalRate: { ratio: '0.09', source: 'setting', savedRatio: '0.09' },
    });
    await openPage(fireHandler(() => odd));
    expect(slider('Inflation rate')).toHaveAttribute('min', '-0.5');
    expect(slider('Access age')).toHaveAttribute('min', '50');
    expect(slider('Withdrawal rate')).toHaveAttribute('max', '9');
    expect(slider('Yearly spend')).toHaveAttribute('max', '200000');
  });

  it('steps with the keys (through the handler: jsdom has no range keys)', async () => {
    const { api } = await openPage(fireHandler(() => onTrack));
    const age = slider('Access age');
    fireEvent.keyDown(age, { key: 'ArrowUp' });
    expect(field('Access age').value).toBe('61');
    fireEvent.keyDown(age, { key: 'PageUp' });
    expect(field('Access age').value).toBe('71');
    fireEvent.keyDown(age, { key: 'Home' });
    expect(field('Access age').value).toBe('55');
    fireEvent.keyDown(age, { key: 'End' });
    expect(field('Access age').value).toBe('75');
    fireEvent.keyDown(age, { key: 'PageDown' });
    expect(field('Access age').value).toBe('65');
    await waitFor(() => expect(whatIfCalls(api)).toEqual([{ accessAge: '65' }]));
  });

  const noRate = () =>
    withInputs(onTrack, {
      withdrawalRate: { ratio: null, source: 'missing', savedRatio: null },
    });

  it('marks a slider with no value as unset until a value is typed (triage STYLE-8)', async () => {
    const { user } = await openPage(fireHandler(noRate));
    expect(field('Withdrawal rate').value).toBe('');
    expect(slider('Withdrawal rate')).toHaveAttribute('data-unset');
    expect(slider('Withdrawal rate')).toHaveAttribute('aria-valuetext', 'not set');
    expect(slider('Withdrawal rate')).toBeEnabled();
    await user.type(field('Withdrawal rate'), '4');
    await user.keyboard('{Enter}');
    expect(slider('Withdrawal rate')).not.toHaveAttribute('data-unset');
    expect(slider('Withdrawal rate')).toHaveAttribute('aria-valuetext', '4.0%');
  });

  it('sets an unset field from a slider move', async () => {
    await openPage(fireHandler(noRate));
    expect(slider('Withdrawal rate')).toHaveAttribute('data-unset');
    fireEvent.change(slider('Withdrawal rate'), { target: { value: '4.5' } });
    expect(field('Withdrawal rate').value).toBe('4.5');
    expect(slider('Withdrawal rate')).not.toHaveAttribute('data-unset');
  });
});

describe('what-if: the recompute (§6.2, §6.4)', () => {
  it('sends one request per burst, with only the changed fields', async () => {
    const { api, user } = await openPage(fireHandler(() => onTrack));
    await user.clear(field('Yearly spend'));
    await user.type(field('Yearly spend'), '45000');
    // The unchanged fields stay out of the query.
    await user.clear(field('Withdrawal rate'));
    await user.type(field('Withdrawal rate'), '5');
    await waitFor(() => expect(whatIfCalls(api)).toHaveLength(1));
    await settle();
    expect(whatIfCalls(api)).toEqual([{ spend: '4500000' }]);
    expect(api.calls('PATCH /api/settings')).toHaveLength(0);
  });

  it('shows "Saved: X" once a field differs', async () => {
    const { user } = await openPage(fireHandler(() => onTrack));
    expect(screen.queryByText('Saved: $40,000')).toBeNull();
    await user.clear(field('Yearly spend'));
    await user.type(field('Yearly spend'), '45000');
    expect(screen.getByText('Saved: $40,000')).toHaveClass('jf-app-fire-saved');
  });

  it('Enter recomputes at once: one GET and no PATCH, in every field', async () => {
    const values: Record<string, [string, Record<string, string>]> = {
      'Yearly spend': ['45000', { spend: '4500000' }],
      'Withdrawal rate': ['4.5', { withdrawalRate: '0.045' }],
      'Inflation rate': ['3', { inflationRate: '0.03' }],
      'Market return': ['7', { marketReturn: '0.07' }],
      'Access age': ['62', { accessAge: '62' }],
      'Extra savings a year': ['5000', { extraSavings: '500000' }],
    };
    for (const [name, [text, query]] of Object.entries(values)) {
      const { api, user, unmount } = await openPage(fireHandler(() => onTrack));
      await user.clear(field(name));
      await user.type(field(name), `${text}{Enter}`);
      // Sent at once, before the debounce would have fired.
      expect(whatIfCalls(api), name).toEqual([query]);
      await settle();
      expect(whatIfCalls(api), name).toEqual([query]);
      expect(api.calls('PATCH /api/settings'), name).toHaveLength(0);
      unmount();
    }
  });

  it('shows the error of out-of-range text on blur and sends nothing', async () => {
    const { api, user } = await openPage(fireHandler(() => onTrack));
    await user.clear(field('Access age'));
    await user.type(field('Access age'), '120');
    await user.tab();
    expect(screen.getByText('Enter a whole age from 30 to 99')).toBeVisible();
    expect(field('Access age')).toHaveAttribute('aria-invalid', 'true');
    await settle();
    // "12" was valid on the way (below 30 it is not): nothing was sent.
    expect(whatIfCalls(api)).toEqual([]);
  });

  it('reverts a cleared field on blur and sends nothing', async () => {
    const { api, user } = await openPage(fireHandler(() => onTrack));
    await user.clear(field('Inflation rate'));
    await user.tab();
    expect(field('Inflation rate').value).toBe('2');
    await settle();
    expect(whatIfCalls(api)).toEqual([]);
  });

  it('keeps the page while recomputing: aria-busy, "Updating…", no Loading line', async () => {
    const { user } = await openPage(
      fireHandler(
        () => onTrack,
        () => new Promise(() => undefined),
      ),
    );
    await user.clear(field('Yearly spend'));
    await user.type(field('Yearly spend'), '45000{Enter}');
    await waitFor(() => expect(results()).toHaveAttribute('aria-busy', 'true'));
    expect(strip()).toHaveTextContent('Updating…');
    expect(screen.queryByText('Loading FIRE…')).toBeNull();
    expect(screen.getByRole('group', { name: 'Years to FIRE' })).toHaveTextContent('1 year');
  });

  it('shows the what-if result with its baseline and announces it', async () => {
    const { user } = await openPage(fireHandler(() => onTrack));
    await user.clear(field('Yearly spend'));
    await user.type(field('Yearly spend'), '50000{Enter}');
    await screen.findByText('What-if (not saved)');
    const { projection, baseline } = firePages.whatIf;
    const expected = `FIRE in ${projection.fire?.year} · age ${projection.fire?.age} · Saved: ${baseline?.fireYear}`;
    await waitFor(() => expect(strip()).toHaveTextContent(expected));
    const live = screen.getByRole('status', { name: 'What-if result' });
    await waitFor(() => expect(live).toHaveTextContent(expected));
  });

  it('keeps the previous figures under a callout when a what-if fails, with Try again', async () => {
    let failures = 0;
    const { api, user } = await openPage(
      fireHandler(
        () => onTrack,
        () => {
          failures += 1;
          return { status: 500, body: apiErrors.internal };
        },
      ),
    );
    await user.clear(field('Yearly spend'));
    await user.type(field('Yearly spend'), '45000{Enter}');
    const callout = await screen.findByRole('note', { name: 'What-if not updated' });
    expect(callout).toHaveTextContent(
      'Couldn’t recompute: Internal server error. The figures shown are for your previous inputs.',
    );
    expect(screen.getByRole('group', { name: 'Years to FIRE' })).toHaveTextContent('1 year');
    await user.click(within(callout).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(failures).toBe(2));
    expect(whatIfCalls(api)).toHaveLength(2);
  });

  it('maps the server’s validation errors to the fields', async () => {
    const { user } = await openPage(
      fireHandler(
        () => onTrack,
        () => ({ status: 400, body: apiErrors.fireValidation }),
      ),
    );
    await user.clear(field('Withdrawal rate'));
    await user.type(field('Withdrawal rate'), '4.5{Enter}');
    expect(await screen.findByText('Withdrawal rate must be above 0')).toBeVisible();
    expect(screen.getByText(/^Access age Too big/)).toBeVisible();
    expect(screen.queryByRole('note', { name: 'What-if not updated' })).toBeNull();
  });

  it('untouched fields follow a refetch; touched fields keep their values', async () => {
    let derivedCents = 4_000_000;
    const page = (): FirePageResponse =>
      withInputs(onTrack, {
        yearlySpend: { cents: derivedCents, source: 'derived', savedCents: null, derivedCents },
      });
    const { queryClient, user } = await openPage(
      fireHandler(page, () => ({
        body: { ...page(), whatIfActive: true, baseline: firePages.whatIf.baseline },
      })),
    );
    await user.clear(field('Withdrawal rate'));
    await user.type(field('Withdrawal rate'), '4.5{Enter}');
    derivedCents = 4_500_000;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['fire'] });
    });
    await waitFor(() => expect(field('Yearly spend').value).toBe('45,000'));
    expect(field('Withdrawal rate').value).toBe('4.5');
  });
});

describe('what-if: Save and Reset (§6.4)', () => {
  it('Save PATCHes only the changed keys, then clears the what-if and focuses the heading', async () => {
    const { api, user } = await openPage(
      fireHandler(() => onTrack),
      {
        'PATCH /api/settings': { body: fireSettingsPatchResponse },
      },
    );
    const save = screen.getByRole('button', { name: 'Save as my settings' });
    expect(save).toBeDisabled();
    await user.clear(field('Extra savings a year'));
    await user.type(field('Extra savings a year'), '5000');
    await user.clear(field('Market return'));
    await user.type(field('Market return'), '6.5');
    expect(
      screen.getByText('Saves: market return 6.5% · extra savings a year $5,000'),
    ).toBeVisible();
    expect(
      screen.getByText('Sets a return for FIRE only; the Investing return is unchanged.'),
    ).toBeVisible();
    await user.click(save);
    await waitFor(() => expect(api.calls('PATCH /api/settings')).toHaveLength(1));
    expect(api.calls('PATCH /api/settings')[0]?.body).toEqual({
      values: { 'fire.marketReturn': '0.065', 'fire.extraSavingsPerYearCents': 500_000 },
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'What if' }),
      ),
    );
    expect(screen.getByRole('status', { name: 'What-if result' })).toHaveTextContent(
      'FIRE settings saved',
    );
    expect(field('Extra savings a year').value).toBe('0');
    expect(save).toBeDisabled();
  });

  it('Save with a spend says it stays until Use the derived figure', async () => {
    const { user } = await openPage(fireHandler(() => onTrack));
    await user.clear(field('Yearly spend'));
    await user.type(field('Yearly spend'), '42000');
    expect(screen.getByText('Saves: yearly spend $42,000')).toBeVisible();
    expect(
      screen.getByText('Your spend will stay at $42,000 until you choose Use the derived figure.'),
    ).toBeVisible();
  });

  it('a failed Save keeps the what-if and announces the error', async () => {
    const { user } = await openPage(
      fireHandler(() => onTrack),
      {
        'PATCH /api/settings': { status: 500, body: apiErrors.internal },
      },
    );
    await user.clear(field('Access age'));
    await user.type(field('Access age'), '62');
    await user.click(screen.getByRole('button', { name: 'Save as my settings' }));
    expect(
      await screen.findByText('Couldn’t save: Internal server error', {
        selector: '.jf-app-fire-save-error span',
      }),
    ).toBeVisible();
    expect(screen.getByRole('alert', { name: 'What-if errors' })).toHaveTextContent(
      'Couldn’t save: Internal server error',
    );
    expect(field('Access age').value).toBe('62');
  });

  it('Reset goes back to the saved values without a request and focuses the heading', async () => {
    const { api, user } = await openPage(fireHandler(() => onTrack));
    const reset = screen.getByRole('button', { name: 'Reset' });
    expect(reset).toBeDisabled();
    await user.clear(field('Access age'));
    await user.type(field('Access age'), '62{Enter}');
    expect(whatIfCalls(api)).toHaveLength(1);
    const before = api.requests.length;
    await user.click(reset);
    expect(field('Access age').value).toBe('60');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'What if' }));
    expect(screen.getByRole('status', { name: 'What-if result' })).toHaveTextContent(
      'What-if cleared',
    );
    await settle();
    // The saved plan is cached: nothing new is fetched for it.
    expect(
      api.requests.slice(before).filter((r) => r.method !== 'GET' || r.path === '/api/fire'),
    ).toEqual([]);
    expect(reset).toBeDisabled();
  });
});
