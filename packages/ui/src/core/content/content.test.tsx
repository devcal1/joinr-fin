import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Amount } from './Amount';
import { Callout } from './Callout';
import { Card } from './Card';
import { ImageFrame } from './ImageFrame';
import { KeyValueTable } from './KeyValueTable';
import { Pill } from './Pill';
import { SectionBar } from './SectionBar';
import { StatTile } from './StatTile';
import { StatusBadge, statusTone, type StatusKind } from './StatusBadge';
import { StepCard } from './StepCard';

describe('SectionBar', () => {
  it('renders an h2 coded by role (primary by default)', () => {
    const { container } = render(<SectionBar title="Holdings" id="holdings" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Holdings' });
    expect(heading).toHaveAttribute('id', 'holdings');
    expect(container.firstChild).toHaveClass('jf-section-bar', 'jf-section-bar--primary');
  });

  it.each([
    ['supporting', 'jf-section-bar--supporting'],
    ['reference', 'jf-section-bar--reference'],
  ] as const)('role %s', (role, className) => {
    const { container } = render(<SectionBar title="X" role={role} level={3} />);
    expect(container.firstChild).toHaveClass(className);
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('renders actions', () => {
    render(<SectionBar title="X" actions={<button>Edit</button>} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});

describe('Card', () => {
  it('renders a teal h3 heading, sub-line, actions and body', () => {
    const { container } = render(
      <Card title="Summary" subtitle="As at today" actions={<button>More</button>}>
        <p>Body</p>
      </Card>,
    );
    expect(container.firstChild).toHaveClass('jf-card');
    expect(screen.getByRole('heading', { level: 3, name: 'Summary' })).toHaveClass(
      'jf-card__title',
    );
    expect(screen.getByText('As at today')).toHaveClass('jf-card__subtitle');
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('labels a titled section by its heading, and supports flush padding', () => {
    render(
      <Card as="section" title="Holdings" padding="none" className="x">
        body
      </Card>,
    );
    const region = screen.getByRole('region', { name: 'Holdings' });
    expect(region.tagName).toBe('SECTION');
    expect(region).toHaveClass('jf-card', 'jf-card--flush', 'x');
  });

  it('renders no head without a title or actions', () => {
    const { container } = render(<Card>body</Card>);
    expect(container.querySelector('.jf-card__head')).toBeNull();
  });
});

describe('Callout', () => {
  it.each([
    ['note', 'Note'],
    ['important', 'Important'],
    ['do-not', 'Do not'],
  ] as const)('%s has a default title and its accent class', (kind, title) => {
    const { container } = render(<Callout kind={kind}>Body text</Callout>);
    const note = screen.getByRole('note', { name: title });
    expect(note).toHaveClass('jf-callout', `jf-callout--${kind}`);
    expect(note).toHaveTextContent('Body text');
    // The word carries the meaning; the icon is decorative.
    expect(container.querySelector('.jf-callout__title svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('takes a custom title', () => {
    render(
      <Callout kind="important" title="Prices are 2 days old">
        Refresh them.
      </Callout>,
    );
    expect(screen.getByRole('note', { name: 'Prices are 2 days old' })).toBeInTheDocument();
  });
});

describe('KeyValueTable', () => {
  it('renders row-header labels and values, numeric values as figures', () => {
    render(
      <KeyValueTable
        caption="Account details"
        items={[
          { label: 'Name', value: 'Example Co' },
          { label: 'Balance', value: '$12,480.00', numeric: true },
        ]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Account details' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByRole('rowheader', { name: 'Name' })).toHaveClass(
      'jf-kv__label',
    );
    expect(within(rows[1] as HTMLElement).getByRole('cell')).toHaveClass(
      'jf-kv__value',
      'jf-kv__value--num',
    );
    expect(within(rows[0] as HTMLElement).getByRole('cell')).not.toHaveClass('jf-kv__value--num');
  });

  it('sets the 38% label column on a colgroup, so a hidden caption cannot undo it', () => {
    render(<KeyValueTable caption="Facts" items={[{ label: 'Name', value: 'Example Co' }]} />);
    const table = screen.getByRole('table', { name: 'Facts' });
    const cols = table.querySelectorAll('colgroup > col');
    expect(cols).toHaveLength(2);
    expect(cols[0]).toHaveClass('jf-kv__col-label');
  });
});

describe('StatTile', () => {
  it('renders a labelled group with a monospaced figure', () => {
    const { container } = render(<StatTile label="Net worth" value="$12,480" />);
    const group = screen.getByRole('group', { name: 'Net worth' });
    expect(within(group).getByText('$12,480')).toHaveClass('jf-stat-tile__value');
    expect(container.firstChild).not.toHaveClass('jf-stat-tile--key');
  });

  it('marks the key figure', () => {
    const { container } = render(<StatTile label="Net worth" value="$12,480" keyFigure />);
    expect(container.firstChild).toHaveClass('jf-stat-tile--key');
  });

  it.each([
    ['up', undefined, 'go'],
    ['down', undefined, 'stop'],
    ['flat', undefined, 'neutral'],
    ['up', 'stop', 'stop'],
  ] as const)(
    'delta %s (tone %s) → %s, with an arrow, a sign and a word',
    (direction, tone, cls) => {
      const { container } = render(
        <StatTile
          label="Change"
          value="$1,240"
          delta={{ value: '+$1,240', direction, text: 'this month', tone }}
          hint="Since the last snapshot"
        />,
      );
      const delta = container.querySelector('.jf-stat-tile__delta');
      expect(delta).toHaveClass(`jf-stat-tile__delta--${cls}`);
      expect(delta).toHaveTextContent('+$1,240');
      expect(delta).toHaveTextContent('this month');
      expect(delta?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText('Since the last snapshot')).toHaveClass('jf-stat-tile__hint');
    },
  );
});

describe('StatusBadge', () => {
  const cases: [StatusKind, 'go' | 'check' | 'stop', string][] = [
    ['go', 'go', 'Go'],
    ['fresh', 'go', 'Fresh'],
    ['recorded', 'go', 'Recorded'],
    ['check', 'check', 'Check'],
    ['stale', 'check', 'Stale'],
    ['pending', 'check', 'Pending'],
    ['stop', 'stop', 'Stop'],
    ['failed', 'stop', 'Failed'],
  ];

  it.each(cases)('%s → %s tone, icon and word', (status, tone, word) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild;
    expect(badge).toHaveClass('jf-badge', `jf-badge--${tone}`);
    expect(badge).toHaveAttribute('data-status', status);
    expect(badge).toHaveTextContent(word);
    expect(badge?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(statusTone(status)).toBe(tone);
  });

  it('takes a custom label', () => {
    render(<StatusBadge status="stale" label="2 days old" />);
    expect(screen.getByText('2 days old')).toBeInTheDocument();
  });
});

describe('Pill', () => {
  it.each(['teal', 'violet', 'fuchsia', 'na'] as const)('tone %s', (tone) => {
    const { container } = render(<Pill tone={tone}>Tag</Pill>);
    expect(container.firstChild).toHaveClass('jf-pill', `jf-pill--${tone}`);
  });

  it('defaults to teal', () => {
    const { container } = render(<Pill>Tag</Pill>);
    expect(container.firstChild).toHaveClass('jf-pill--teal');
  });
});

describe('StepCard', () => {
  it('shows the disc and names the heading with the step number', () => {
    const { container } = render(
      <StepCard step={2} title="Import your data" subtitle="About five minutes">
        <p>Details</p>
      </StepCard>,
    );
    expect(container.querySelector('.jf-step__disc')).toHaveTextContent('2');
    expect(container.querySelector('.jf-step__disc')).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByRole('heading', { level: 3, name: 'Step 2: Import your data' }),
    ).toBeInTheDocument();
    expect(screen.getByText('About five minutes')).toHaveClass('jf-step__subtitle');
    expect(screen.getByText('Details')).toBeInTheDocument();
  });
});

describe('ImageFrame', () => {
  it('frames the image with alt text and a caption', () => {
    const { container } = render(
      <ImageFrame src="data:image/svg+xml,%3Csvg/%3E" alt="Diagram" width="half" caption="Fig 1" />,
    );
    expect(screen.getByRole('img', { name: 'Diagram' })).toHaveClass('jf-image-frame__img');
    expect(container.firstChild).toHaveClass('jf-image-frame', 'jf-image-frame--half');
    const figure = screen.getByRole('figure');
    expect(within(figure).getByText('Fig 1').tagName).toBe('FIGCAPTION');
  });

  it('defaults to full width and lazy loading', () => {
    const { container, rerender } = render(<ImageFrame src="x.png" alt="" />);
    expect(container.firstChild).toHaveClass('jf-image-frame--full');
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy');
    rerender(<ImageFrame src="x.png" alt="" loading="eager" />);
    expect(container.querySelector('img')).toHaveAttribute('loading', 'eager');
  });
});

describe('Amount', () => {
  it('formats cents and marks negatives', () => {
    const { rerender, container } = render(<Amount cents={1_248_000} />);
    expect(container.firstChild).toHaveTextContent('$12,480.00');
    expect(container.firstChild).not.toHaveClass('jf-amount--negative');

    rerender(<Amount cents={-123_400} />);
    expect(container.firstChild).toHaveTextContent('−$1,234.00');
    expect(container.firstChild).toHaveClass('jf-amount', 'jf-amount--negative');

    rerender(<Amount cents={-123_400} colorNegative={false} />);
    expect(container.firstChild).not.toHaveClass('jf-amount--negative');

    rerender(<Amount cents={124_000} wholeDollars signDisplay="always" />);
    expect(container.firstChild).toHaveTextContent('+$1,240');
  });
});
