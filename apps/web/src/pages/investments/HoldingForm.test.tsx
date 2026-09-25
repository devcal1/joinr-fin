import { instrumentCreateSchema, type InstrumentKind } from '@joinr/schema';
import { apiErrors, instrumentDtos } from '@joinr/schema/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KIND_PATHS, mockInvestments } from '../../../test/investments';
import { apiError, mockApi } from '../../../test/mockApi';
import { findMain, renderApp } from '../../../test/renderApp';
import { HoldingForm } from './HoldingForm';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const NOUNS = { stock: 'stock', etf: 'ETF', managed_fund: 'fund', crypto: 'coin' } as const;

async function openAddHolding(kind: InstrumentKind, routes = {}) {
  const api = mockInvestments(kind, { routes });
  const view = renderApp(KIND_PATHS[kind]);
  const main = await findMain();
  const add = await within(main).findByRole('button', { name: 'Add holding' });
  await view.user.click(add);
  const form = await screen.findByRole('form', { name: `Add ${NOUNS[kind]}` });
  return { ...view, api, form, add };
}

describe('Add holding (§6.6)', () => {
  it.each([
    ['stock', 'EXCHANGE:CODE, e.g. ASX:ABC', true, false],
    ['etf', 'EXCHANGE:CODE, e.g. ASX:ABC', true, true],
    ['managed_fund', 'The fund code or price symbol, e.g. EXAMPLEFUND', true, true],
    ['crypto', 'Coin symbol, e.g. BTC', false, false],
  ] as const)(
    '%s: the symbol hint and the fields that apply',
    async (kind, hint, sector, regions) => {
      const { form } = await openAddHolding(kind);
      const symbol = within(form).getByRole('textbox', { name: /^Symbol/ });
      expect(symbol).toHaveFocus();
      expect(within(form).getByText(hint)).toBeVisible();
      expect(within(form).queryByRole('textbox', { name: 'Sector' }) !== null).toBe(sector);
      expect(within(form).queryByRole('textbox', { name: 'Location' }) !== null).toBe(regions);
      expect(within(form).queryAllByRole('textbox', { name: /^Region:/ })).toHaveLength(
        regions ? 4 : 0,
      );
      expect(within(form).queryByRole('textbox', { name: /^Management fee/ }) !== null).toBe(
        regions,
      );
      expect(within(form).getByRole('switch', { name: 'Watched' })).toBeChecked();
      expect(within(form).getByRole('textbox', { name: /^Currency/ })).toHaveValue('AUD');
      expect(within(form).getByRole('combobox', { name: /DRP/ })).toHaveValue('unknown');
      expect(
        within(form).getByRole('checkbox', { name: 'Use the global default fee' }),
      ).toBeChecked();
      expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    },
  );

  it('creates a holding: the body parses with the server’s create schema; empty text → null', async () => {
    const { form, user, api } = await openAddHolding('stock', {
      'POST /api/instruments': { status: 201, body: instrumentDtos.stock },
    });
    await user.type(within(form).getByRole('textbox', { name: /^Symbol/ }), 'asx:zzz');
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'ZZZ Example Ltd');
    await user.type(within(form).getByRole('textbox', { name: /^Target/ }), '5');
    await user.type(within(form).getByRole('textbox', { name: 'Sector' }), '   ');
    await user.selectOptions(within(form).getByRole('combobox', { name: /DRP/ }), 'no');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/instruments')).toHaveLength(1));
    const body = api.calls('POST /api/instruments')[0]?.body;
    expect(body).toEqual({
      kind: 'stock',
      symbol: 'asx:zzz',
      name: 'ZZZ Example Ltd',
      quoteCurrency: 'AUD',
      watched: true,
      targetRatio: '0.05',
      sector: null,
      location: null,
      mgmtFeeRatio: null,
      regions: null,
      dividendFreqMonths: null,
      drp: false,
      defaultFee: null,
      note: null,
    });
    expect(instrumentCreateSchema.safeParse(body).success).toBe(true);
    expect(await screen.findByRole('status', { name: 'Save result' })).toHaveTextContent(
      'Holding saved.',
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add holding' })).toHaveFocus());
  });

  it('checks the symbol rule on the client, as the server does', async () => {
    const { form, user, api } = await openAddHolding('etf');
    await user.type(within(form).getByRole('textbox', { name: /^Symbol/ }), 'nocolon');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    // Worded apart from the field's hint ("EXCHANGE:CODE, e.g. ASX:ABC").
    expect(within(form).getByText('Use the exchange, a colon, then the code.')).toBeVisible();
    expect(api.calls('POST /api/instruments')).toHaveLength(0);
  });

  it('shows every problem on the first Save, percent bounds in percent', async () => {
    const { form, user, api } = await openAddHolding('etf');
    await user.type(within(form).getByRole('textbox', { name: /^Symbol/ }), 'ASX:ZZZ');
    await user.type(within(form).getByRole('textbox', { name: /^Target/ }), '120');
    await user.type(within(form).getByRole('textbox', { name: /^Management fee/ }), '12');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByText('Must be 100% or less.')).toBeVisible();
    expect(within(form).getByText('Must be 10% or less.')).toBeVisible();
    expect(api.calls('POST /api/instruments')).toHaveLength(0);
  });

  it('409 INSTRUMENT_EXISTS goes under the Symbol field', async () => {
    const { form, user } = await openAddHolding('etf', {
      'POST /api/instruments': apiError(409, apiErrors.instrumentExists),
    });
    await user.type(within(form).getByRole('textbox', { name: /^Symbol/ }), 'ASX:DEF');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    const symbol = within(form).getByRole('textbox', { name: /^Symbol/ });
    await waitFor(() => expect(symbol).toHaveAttribute('aria-invalid', 'true'));
    expect(within(form).getByText('An ETF with the symbol ASX:DEF already exists.')).toBeVisible();
    expect(within(form).queryByRole('note', { name: 'Not saved' })).toBeNull();
  });

  it('crypto: a percentage default fee, sent as a ratio', async () => {
    const { form, user, api } = await openAddHolding('crypto', {
      'POST /api/instruments': { status: 201, body: instrumentDtos.crypto },
    });
    await user.type(within(form).getByRole('textbox', { name: /^Symbol/ }), 'eth');
    await user.click(within(form).getByRole('checkbox', { name: 'Use the global default fee' }));
    await user.type(within(form).getByRole('textbox', { name: /^Default fee %/ }), '0.35');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/instruments')).toHaveLength(1));
    expect(api.calls('POST /api/instruments')[0]?.body).toMatchObject({
      kind: 'crypto',
      symbol: 'eth',
      defaultFee: { kind: 'rate', rate: '0.0035' },
      regions: null,
      sector: null,
    });
  });

  it('ETF: regions typed in percent are sent as ratios; all empty sends null', async () => {
    const { form, user, api } = await openAddHolding('etf', {
      'POST /api/instruments': { status: 201, body: instrumentDtos.etf },
    });
    await user.type(within(form).getByRole('textbox', { name: /^Symbol/ }), 'ASX:ZZZ');
    await user.type(within(form).getByRole('textbox', { name: /Region: US/ }), '60');
    await user.type(within(form).getByRole('textbox', { name: /Region: Australia/ }), '35');
    expect(within(form).getByTestId('regions-total')).toHaveTextContent('Regions add up to 95%');
    await user.type(within(form).getByRole('textbox', { name: /^Management fee/ }), '0.07');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/instruments')).toHaveLength(1));
    expect(api.calls('POST /api/instruments')[0]?.body).toMatchObject({
      regions: { us: '0.6', asia: null, aus: '0.35', other: null },
      mgmtFeeRatio: '0.0007',
    });
  });

  it('Cancel closes the form and returns focus', async () => {
    const { form, user, add } = await openAddHolding('etf');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add ETF' })).toBeNull();
    await waitFor(() => expect(add).toHaveFocus());
  });
});

describe('Edit holding: the save outlives a remount', () => {
  it('reports "Holding saved" even when the form remounts while the save is in flight', async () => {
    // On the detail page a save that changes the editable fields remounts the form (its key)
    // when the refetched detail arrives. The parent's onDone must still run.
    const dto = instrumentDtos.etf;
    let remount = (): void => undefined;
    function Harness({ onDone }: { onDone: (message: string) => void }): JSX.Element {
      const [generation, setGeneration] = useState(0);
      remount = () => setGeneration((n) => n + 1);
      return <HoldingForm key={generation} kind="etf" instrument={dto} onDone={onDone} />;
    }
    mockApi({
      [`PUT /api/instruments/${dto.id}`]: async () => {
        remount();
        // Let React commit the remount before the response arrives: the form that sent the
        // request is gone (a fresh, pristine one replaced it).
        await waitFor(() =>
          expect(screen.getByRole('textbox', { name: /^Note/ })).toHaveValue(dto.note ?? ''),
        );
        return { body: dto };
      },
    });
    const onDone = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <Harness onDone={onDone} />
      </QueryClientProvider>,
    );
    const form = screen.getByRole('form', { name: `Holding settings for ${dto.symbol}` });
    await user.type(within(form).getByRole('textbox', { name: /^Note/ }), 'Changed');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Holding saved'));
  });
});
