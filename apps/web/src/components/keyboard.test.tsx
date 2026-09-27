// stage-6.md §6.9 F: keyboard access per shared control. Escape closes inline editors (every page's
// add/edit form, the balances forms, trades, holdings, prices), delete confirms and the phone nav
// drawer, and focus returns to the control that opened them; forms submit with Enter; Tab order
// follows the DOM (the skip link first, then the header, then the page).
import {
  investmentPages,
  investmentTrades,
  pricesLive,
  sideIncomePages,
} from '@joinr/schema/fixtures';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockCashflow } from '../../test/cashflow';
import { emulatePhone } from '../../test/media';
import { mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { DeleteConfirm, InlineForm } from '../pages/cashflow/forms';
import { escapeCancels } from './keyboard';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('escapeCancels', () => {
  const stopPropagation = vi.fn();
  const key = (k: string, defaultPrevented = false) =>
    ({
      key: k,
      defaultPrevented,
      preventDefault: () => undefined,
      stopPropagation,
    }) as unknown as Parameters<ReturnType<typeof escapeCancels>>[0];

  it('runs the cancel on Escape only, and stops the event', () => {
    const cancel = vi.fn();
    const event = key('Escape');
    escapeCancels(cancel)(event);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalled();
    escapeCancels(cancel)(key('Enter'));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does nothing while busy, without a cancel, or once a nested control handled it', () => {
    const cancel = vi.fn();
    escapeCancels(cancel, true)(key('Escape'));
    escapeCancels(undefined)(key('Escape'));
    escapeCancels(cancel)(key('Escape', true));
    expect(cancel).not.toHaveBeenCalled();
  });
});

/** An opener button and the inline form it opens, as the pages wire them. */
function Harness({ pending = false }: { pending?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(0);
  const [name, setName] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <p>Saved {saved}</p>
      {open ? (
        <InlineForm
          title="Edit item"
          onSubmit={() => {
            setSaved((n) => n + 1);
            return true;
          }}
          onCancel={() => {
            setOpen(false);
            document.querySelector<HTMLElement>('button')?.focus();
          }}
          pending={pending}
          pristine={name === ''}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </InlineForm>
      ) : null}
    </>
  );
}

describe('InlineForm (every add and edit form)', () => {
  it('focuses its first field; Tab goes field → Save → Cancel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const field = screen.getByRole('textbox', { name: 'Name' });
    expect(field).toHaveFocus();
    await user.type(field, 'x');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('submits with Enter in a field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x{Enter}');
    expect(screen.getByText('Saved 1')).toBeInTheDocument();
  });

  it('Escape closes it and focus returns to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'Edit item' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('Escape does nothing while it saves', async () => {
    const user = userEvent.setup();
    render(<Harness pending />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    expect(screen.getByRole('form', { name: 'Edit item' })).toBeInTheDocument();
  });
});

describe('DeleteConfirm (every inline delete)', () => {
  it('starts on Cancel and Escape cancels without closing the form around it', async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <DeleteConfirm
          question="Delete the row?"
          label="row"
          busy={false}
          onConfirm={() => undefined}
          onCancel={cancel}
        />
      </div>,
    );
    expect(document.querySelector('[data-confirm="cancel"]')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(cancel).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('page editors: Escape closes and focus returns to the opener', () => {
  it('Cash: Add account', async () => {
    mockCashflow();
    const { user } = renderApp('/cash');
    const add = await screen.findByRole('button', { name: 'Add account' });
    await user.click(add);
    const form = await screen.findByRole('form', { name: /account/i });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(form).not.toBeInTheDocument());
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('Side Income: Add stream', async () => {
    mockCashflow({ sideIncome: sideIncomePages.populated });
    const { user } = renderApp('/side-income');
    const add = await screen.findByRole('button', { name: 'Add stream' });
    await user.click(add);
    const form = await screen.findByRole('form', { name: /stream/i });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(form).not.toBeInTheDocument());
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('ETFs: Add trade', async () => {
    mockApi({
      'GET /api/investments/etf': { body: investmentPages.etf },
      'GET /api/investments/etf/trades': { body: investmentTrades.etf },
    });
    const { user } = renderApp('/etfs');
    const add = await screen.findByRole('button', { name: 'Add trade' });
    await user.click(add);
    const form = await screen.findByRole('form', { name: /trade/i });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(form).not.toBeInTheDocument());
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('Prices: Set price', async () => {
    mockApi({ 'GET /api/prices': { body: pricesLive } });
    const { user } = renderApp('/prices');
    const set = (await screen.findAllByRole('button', { name: /^Set price for / }))[0]!;
    await user.click(set);
    const form = await screen.findByRole('form', { name: /^Set price for / });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(form).not.toBeInTheDocument());
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        set.getAttribute('aria-label'),
      ),
    );
  });
});

describe('the shell', () => {
  it('Tab starts at the skip link, which moves focus into main', async () => {
    mockCashflow();
    const { user } = renderApp('/cash');
    await screen.findByRole('button', { name: 'Add account' });
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('phone: Escape closes the nav drawer and focus returns to the menu button', async () => {
    emulatePhone();
    mockCashflow();
    const { user } = renderApp('/cash');
    await screen.findByRole('button', { name: 'Add account' });
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(menu).toHaveAttribute('aria-expanded', 'false'));
    expect(menu).toHaveFocus();
  });
});
