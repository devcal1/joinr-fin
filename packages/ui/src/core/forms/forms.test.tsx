import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Checkbox, Switch } from './Checkbox';
import { DATE_INVALID_MESSAGE, DateField } from './DateField';
import { MONEY_INVALID_MESSAGE, MONEY_NEGATIVE_MESSAGE, MoneyField } from './MoneyField';
import { NumberField, numberInvalidMessage } from './NumberField';
import { Select } from './Select';
import { TextField } from './TextField';

const M = '−';

describe('Button', () => {
  it('defaults to a secondary md type="button"', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('jf-button', 'jf-button--secondary', 'jf-button--md');
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)('variant %s', (variant) => {
    render(
      <Button variant={variant} size="sm">
        Go
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveClass(`jf-button--${variant}`, 'jf-button--sm');
  });

  it('places the icon before or after the label', () => {
    const { container, rerender } = render(<Button icon={Plus}>Add</Button>);
    expect(container.querySelector('button')?.firstElementChild?.tagName).toBe('svg');
    rerender(
      <Button icon={Plus} iconPosition="end">
        Add
      </Button>,
    );
    expect(container.querySelector('button')?.lastElementChild?.tagName).toBe('svg');
  });

  it('supports icon-only buttons named by aria-label (also the tooltip)', () => {
    render(<Button icon={Trash2} aria-label="Delete row" variant="danger" />);
    const button = screen.getByRole('button', { name: 'Delete row' });
    expect(button).toHaveClass('jf-button--icon');
    expect(button).toHaveAttribute('title', 'Delete row');
  });

  it('passes native attributes and handles clicks; disabled blocks them', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Button type="submit" onClick={onClick} data-x="1">
        Send
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveAttribute('data-x', '1');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} disabled>
        Send
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('TextField', () => {
  it('labels the input, and wires hint, error and required', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TextField
        label="Account name"
        value=""
        onChange={onChange}
        hint="As shown on the statement"
        error="Enter a name"
        required
        placeholder="Example Co"
      />,
    );
    const input = screen.getByRole('textbox', { name: /Account name/ });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription('Enter a name As shown on the statement');
    await user.type(input, 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('is valid by default and can be disabled', () => {
    render(
      <TextField label="Search" type="search" value="x" onChange={() => undefined} disabled />,
    );
    const input = screen.getByRole('searchbox', { name: 'Search' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).toBeDisabled();
    expect(input.closest('.jf-field')).toHaveClass('jf-field--disabled');
  });

  it('uses the given id', () => {
    render(<TextField id="acct" label="Account" value="" onChange={() => undefined} />);
    expect(screen.getByLabelText('Account')).toHaveAttribute('id', 'acct');
  });
});

/** A controlled wrapper so the fields behave as they do in a form. */
function Controlled<T>({
  initial,
  children,
}: {
  initial: T;
  children: (value: T, setValue: (next: T) => void) => JSX.Element;
}): JSX.Element {
  const [value, setValue] = useState<T>(initial);
  return (
    <>
      {children(value, setValue)}
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const valueOf = (): unknown => JSON.parse(screen.getByTestId('value').textContent ?? 'null');

describe('MoneyField', () => {
  function renderMoney(initial: number | null, props: { allowNegative?: boolean } = {}) {
    return render(
      <Controlled initial={initial}>
        {(value, setValue) => (
          <MoneyField label="Amount" value={value} onChange={setValue} {...props} />
        )}
      </Controlled>,
    );
  }

  it('shows the formatted amount without $, with a $ adornment', () => {
    const { container } = renderMoney(123_456);
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('1,234.56');
    expect(container.querySelector('.jf-input__adorn--start')).toHaveTextContent('$');
    expect(container.querySelector('.jf-input')).toHaveClass('jf-input--numeric');
  });

  it('shows raw text while focused, reports cents live and formats on blur', async () => {
    const user = userEvent.setup();
    renderMoney(123_456);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    await user.click(input);
    expect(input).toHaveValue('1234.56');
    await user.clear(input);
    await user.type(input, '2500.5');
    expect(valueOf()).toBe(250_050);
    expect(input).toHaveValue('2500.5');
    await user.tab();
    expect(input).toHaveValue('2,500.50');
  });

  it('shows the error for invalid input and keeps the text', async () => {
    const user = userEvent.setup();
    renderMoney(null);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    await user.type(input, '12.345');
    expect(screen.queryByText(MONEY_INVALID_MESSAGE)).not.toBeInTheDocument();
    await user.tab();
    expect(input).toHaveValue('12.345');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(MONEY_INVALID_MESSAGE);
    expect(MONEY_INVALID_MESSAGE).toBe('Enter an amount like 1,234.56');
    // Fixing it clears the error.
    await user.click(input);
    await user.type(input, '{Backspace}');
    expect(screen.queryByText(MONEY_INVALID_MESSAGE)).not.toBeInTheDocument();
    expect(valueOf()).toBe(1234);
  });

  it('selects the raw text on focus, so typing replaces the amount', async () => {
    const user = userEvent.setup();
    renderMoney(123_456);
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Amount' });
    await user.tab();
    expect(input).toHaveFocus();
    expect(input).toHaveValue('1234.56');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 7]);
    await user.keyboard('99');
    expect(input).toHaveValue('99');
    expect(valueOf()).toBe(9900);
  });

  it('commits on Enter', async () => {
    const user = userEvent.setup();
    renderMoney(null);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    await user.type(input, '1000{Enter}');
    expect(input).toHaveValue('1,000.00');
    expect(valueOf()).toBe(100_000);
  });

  it('rejects negatives unless allowed', async () => {
    const user = userEvent.setup();
    renderMoney(null);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    await user.type(input, '-5');
    await user.tab();
    expect(screen.getByText(MONEY_NEGATIVE_MESSAGE)).toBeInTheDocument();
    expect(valueOf()).toBeNull();
  });

  it('accepts negatives when allowed and shows them with U+2212', async () => {
    const user = userEvent.setup();
    renderMoney(null, { allowNegative: true });
    const input = screen.getByRole('textbox', { name: 'Amount' });
    await user.type(input, '-1234');
    await user.tab();
    expect(valueOf()).toBe(-123_400);
    expect(input).toHaveValue(`${M}1,234.00`);
  });

  it('clearing the field reports null', async () => {
    const user = userEvent.setup();
    renderMoney(500);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    await user.clear(input);
    await user.tab();
    expect(valueOf()).toBeNull();
    expect(input).toHaveValue('');
  });

  it('an external error wins over the internal one', () => {
    render(<MoneyField label="Amount" value={null} onChange={() => undefined} error="Required" />);
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Required');
  });
});

describe('NumberField', () => {
  function renderNumber(initial: string, props: { maxDp?: number; allowNegative?: boolean } = {}) {
    return render(
      <Controlled initial={initial}>
        {(value, setValue) => (
          <NumberField label="Units" value={value} onChange={setValue} suffix="units" {...props} />
        )}
      </Controlled>,
    );
  }

  it('groups on blur, shows raw while focused, and describes the unit', async () => {
    const user = userEvent.setup();
    renderNumber('1234.5');
    const input = screen.getByRole('textbox', { name: 'Units' });
    expect(input).toHaveValue('1,234.5');
    expect(input).toHaveAccessibleDescription('units');
    await user.click(input);
    expect(input).toHaveValue('1234.5');
    await user.clear(input);
    await user.type(input, '0.12345678');
    expect(valueOf()).toBe('0.12345678');
    await user.tab();
    expect(input).toHaveValue('0.12345678');
  });

  it('enforces maxDp with a clear message', async () => {
    const user = userEvent.setup();
    renderNumber('', { maxDp: 2 });
    const input = screen.getByRole('textbox', { name: 'Units' });
    await user.type(input, '1.234');
    await user.tab();
    expect(screen.getByText(numberInvalidMessage(2))).toBeInTheDocument();
    expect(numberInvalidMessage(2)).toBe('Enter a number with up to 2 decimal places');
    expect(numberInvalidMessage(1)).toBe('Enter a number with up to 1 decimal place');
    expect(numberInvalidMessage(0)).toBe('Enter a whole number');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('normalises input and handles negatives', async () => {
    const user = userEvent.setup();
    renderNumber('', { allowNegative: true });
    const input = screen.getByRole('textbox', { name: 'Units' });
    await user.type(input, '-1,000.50');
    await user.tab();
    expect(valueOf()).toBe('-1000.5');
    expect(input).toHaveValue(`${M}1,000.5`);
  });

  it('rejects negatives unless allowed, and clears to ""', async () => {
    const user = userEvent.setup();
    renderNumber('7');
    const input = screen.getByRole('textbox', { name: 'Units' });
    await user.clear(input);
    await user.type(input, '-1');
    await user.tab();
    expect(screen.getByText('Enter a number of zero or more')).toBeInTheDocument();
    await user.clear(input);
    await user.tab();
    expect(valueOf()).toBe('');
  });
});

describe('DateField', () => {
  // jsdom may not implement showPicker; each test installs its own and this puts things back.
  const original = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'showPicker');

  afterEach(() => {
    if (original) Object.defineProperty(HTMLInputElement.prototype, 'showPicker', original);
    else Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
  });

  function renderDate(initial: string | null, props: { min?: string; max?: string } = {}) {
    return render(
      <Controlled initial={initial}>
        {(value, setValue) => (
          <DateField label="Trade date" value={value} onChange={setValue} {...props} />
        )}
      </Controlled>,
    );
  }

  it('shows dd/mm/yyyy and parses typed dates on blur', async () => {
    const user = userEvent.setup();
    renderDate('2026-08-18');
    const input = screen.getByRole('textbox', { name: 'Trade date' });
    expect(input).toHaveValue('18/08/2026');
    expect(input).toHaveAttribute('placeholder', 'dd/mm/yyyy');
    await user.clear(input);
    await user.type(input, '1/7/2026');
    expect(valueOf()).toBe('2026-07-01');
    await user.tab();
    expect(input).toHaveValue('01/07/2026');
  });

  it('flags invalid dates on blur', async () => {
    const user = userEvent.setup();
    renderDate(null);
    const input = screen.getByRole('textbox', { name: 'Trade date' });
    await user.type(input, '29/02/2026');
    await user.tab();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(DATE_INVALID_MESSAGE);
    expect(input).toHaveValue('29/02/2026');
    expect(valueOf()).toBeNull();
  });

  it('enforces min and max', async () => {
    const user = userEvent.setup();
    renderDate(null, { min: '2026-07-01', max: '2027-06-30' });
    const input = screen.getByRole('textbox', { name: 'Trade date' });
    await user.type(input, '30/06/2026');
    await user.tab();
    expect(screen.getByText('Enter a date on or after 01/07/2026')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '01/07/2027');
    await user.tab();
    expect(screen.getByText('Enter a date on or before 30/06/2027')).toBeInTheDocument();
  });

  it('opens the native picker from the calendar button and takes its value', async () => {
    const user = userEvent.setup();
    const showPicker = vi.fn();
    HTMLInputElement.prototype.showPicker = showPicker;
    const { container } = renderDate(null);
    const button = screen.getByRole('button', { name: 'Choose trade date from a calendar' });
    await user.click(button);
    expect(showPicker).toHaveBeenCalledTimes(1);

    const picker = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(picker).toHaveAttribute('tabindex', '-1');
    expect(picker).toHaveAttribute('aria-hidden', 'true');
    fireEvent.change(picker, { target: { value: '2026-08-18' } });
    expect(valueOf()).toBe('2026-08-18');
    expect(screen.getByRole('textbox', { name: 'Trade date' })).toHaveValue('18/08/2026');
  });

  it('falls back to focusing the native input when showPicker throws', async () => {
    const user = userEvent.setup();
    HTMLInputElement.prototype.showPicker = () => {
      throw new DOMException('Not allowed', 'NotAllowedError');
    };
    const { container } = renderDate(null);
    const picker = container.querySelector('input[type="date"]') as HTMLInputElement;
    const click = vi.spyOn(picker, 'click');
    await user.click(screen.getByRole('button', { name: /calendar/ }));
    expect(click).toHaveBeenCalled();
  });
});

describe('invalid drafts block form submission', () => {
  /** A form holding one draft field and a submit button. */
  function DraftForm<T>({
    initial,
    onSubmit,
    field,
  }: {
    initial: T;
    onSubmit: (value: T) => void;
    field: (value: T, setValue: (next: T) => void) => JSX.Element;
  }): JSX.Element {
    const [value, setValue] = useState<T>(initial);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        {field(value, setValue)}
        <button type="submit">Save</button>
      </form>
    );
  }

  // Enter goes through the submit button: user-event fires a bare `submit` event for a form with a
  // single input and no button, skipping the validation step a browser runs for implicit submission.
  it('MoneyField: invalid text + Enter does not submit the last valid amount', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <DraftForm<number | null>
        initial={null}
        onSubmit={onSubmit}
        field={(value, setValue) => <MoneyField label="Amount" value={value} onChange={setValue} />}
      />,
    );
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Amount' });
    await user.type(input, '12.5x{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.validity.valid).toBe(false);
    expect(input.validationMessage).toBe(MONEY_INVALID_MESSAGE);
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.clear(input);
    await user.type(input, '12.50{Enter}');
    expect(input.validity.valid).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(1250);
  });

  it('DateField: an impossible date blocks the submit button until it is fixed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <DraftForm<string | null>
        initial="2026-08-18"
        onSubmit={onSubmit}
        field={(value, setValue) => <DateField label="Date" value={value} onChange={setValue} />}
      />,
    );
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Date' });
    await user.click(input);
    await user.clear(input);
    await user.type(input, '31/04/2026');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.validationMessage).toBe(DATE_INVALID_MESSAGE);

    await user.clear(input);
    await user.type(input, '30/04/2026');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith('2026-04-30');
  });

  it('NumberField: too many decimal places block submission; clearing the text unblocks it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <DraftForm<string>
        initial="1.5"
        onSubmit={onSubmit}
        field={(value, setValue) => (
          <NumberField label="Units" value={value} onChange={setValue} maxDp={2} />
        )}
      />,
    );
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Units' });
    await user.click(input);
    await user.clear(input);
    await user.type(input, '1.234{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.validationMessage).toBe(numberInvalidMessage(2));

    await user.clear(input);
    expect(input.validity.valid).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith('');
  });
});

describe('Select', () => {
  it('renders options with a placeholder and reports changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select
        label="Asset class"
        value=""
        onChange={onChange}
        placeholder="Choose one"
        options={[
          { value: 'a', label: 'Asset class A' },
          { value: 'b', label: 'Asset class B' },
          { value: 'c', label: 'Asset class C', disabled: true },
        ]}
        hint="Used for allocation"
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Asset class' });
    expect(select).toHaveAccessibleDescription('Used for allocation');
    expect(screen.getByRole('option', { name: 'Choose one' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Asset class C' })).toBeDisabled();
    await user.selectOptions(select, 'b');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('marks the placeholder state (muted) only while nothing is chosen', () => {
    const options = [{ value: 'a', label: 'Asset class A' }];
    const { rerender } = render(
      <Select
        label="Asset class"
        value=""
        onChange={() => undefined}
        placeholder="Choose one"
        options={options}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Asset class' });
    expect(select).toHaveClass('jf-input__control--placeholder');
    rerender(
      <Select
        label="Asset class"
        value="a"
        onChange={() => undefined}
        placeholder="Choose one"
        options={options}
      />,
    );
    expect(select).not.toHaveClass('jf-input__control--placeholder');
  });

  it('shows the error state', () => {
    render(
      <Select
        label="Asset class"
        value="a"
        onChange={() => undefined}
        options={[{ value: 'a', label: 'A' }]}
        error="Pick a class"
      />,
    );
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Checkbox and Switch', () => {
  it('checkbox toggles through its label', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox
        label="Offset account"
        checked={false}
        onChange={onChange}
        hint="Reduces interest"
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'Offset account' });
    expect(box).toHaveAccessibleDescription('Reduces interest');
    await user.click(screen.getByText('Offset account'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('switch has role="switch" and toggles with Space', async () => {
    const user = userEvent.setup();
    function Harness(): JSX.Element {
      const [on, setOn] = useState(false);
      return <Switch label="Auto-record snapshots" checked={on} onChange={setOn} />;
    }
    render(<Harness />);
    const toggle = screen.getByRole('switch', { name: 'Auto-record snapshots' });
    expect(toggle).not.toBeChecked();
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).toBeChecked();
  });

  it('disabled toggles do not change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<Switch label="Locked" checked onChange={onChange} disabled />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
    expect(container.firstChild).toHaveClass('jf-switch--disabled');
  });
});
