// Style guide: the core components in their real states (ui-core). All data here is generic.
import {
  Amount,
  AppShell,
  BrandBlock,
  Button,
  Callout,
  Card,
  Checkbox,
  Cluster,
  ColumnTable,
  DATE_INVALID_MESSAGE,
  DateField,
  Grid,
  GridItem,
  Icon,
  ImageFrame,
  KeyValueTable,
  MONEY_INVALID_MESSAGE,
  Meter,
  MoneyField,
  NumberField,
  PageHeader,
  Pill,
  SectionBar,
  Select,
  Skeleton,
  Stack,
  StatTile,
  StatusBadge,
  StepCard,
  Switch,
  TextField,
  financialYearBounds,
  financialYearOf,
  formatDate,
  formatDateLong,
  formatFinancialYear,
  formatMoney,
  formatMonth,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatTime,
  parseDate,
  parseDecimal,
  parseMoney,
  type AppLinkProps,
  type ColumnTableColumn,
  type NavGroup,
  type Span,
  type StatusKind,
} from '@joinr/ui';
import {
  Camera,
  ChartCandlestick,
  Download,
  History,
  Layers,
  LayoutDashboard,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Wallet,
} from 'lucide-react';
import { createContext, useContext, useState, type JSX } from 'react';
import { GalleryItem } from './GalleryItem';

/* ───────────────────────── AppShell demo ───────────────────────── */

const DEMO_NAV: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { id: 'net-worth', label: 'Net Worth', href: '#demo-net-worth', icon: LayoutDashboard },
      { id: 'history', label: 'History', href: '#demo-history', icon: History },
    ],
  },
  {
    id: 'investments',
    label: 'Investments',
    items: [
      { id: 'stocks', label: 'Stocks', href: '#demo-stocks', icon: ChartCandlestick },
      { id: 'etfs', label: 'ETFs', href: '#demo-etfs', icon: Layers },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [{ id: 'settings', label: 'Settings', href: '#demo-settings', icon: Settings }],
  },
];

const DemoNavigate = createContext<(href: string) => void>(() => undefined);

/** The demo's links switch the demo page instead of navigating the app. */
function DemoLink({ href, children, onClick, ...rest }: AppLinkProps): JSX.Element {
  const navigate = useContext(DemoNavigate);
  return (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

function AppShellDemo(): JSX.Element {
  const [href, setHref] = useState('#demo-stocks');
  const group = DEMO_NAV.find((g) => g.items.some((item) => item.href === href));
  const page = group?.items.find((item) => item.href === href);
  return (
    <DemoNavigate.Provider value={setHref}>
      <AppShell
        embedded
        brand={<BrandBlock size="sm" />}
        nav={DEMO_NAV}
        activeHref={href}
        pageTitle={page?.label ?? ''}
        freshness="Prices 14:32 · Snapshot Aug 2026"
        footer={{ version: __APP_VERSION__, right: 'Last snapshot Aug 2026 · Prices 14:32' }}
        linkComponent={DemoLink}
      >
        <PageHeader title={page?.label ?? ''} subtitle={group?.label} level={2} />
        <Callout kind="note">
          <p>
            A contained copy of the app frame. Pick a page in its nav; below 1024px the nav opens
            from the menu button.
          </p>
        </Callout>
      </AppShell>
    </DemoNavigate.Provider>
  );
}

/* ───────────────────────── ColumnTable demo ───────────────────────── */

interface DemoHolding {
  code: string;
  name: string;
  units: string;
  price: string;
  valueCents: number;
  costCents: number;
  priceDate: string;
  status: StatusKind;
}

const TOTAL_VALUE = 1_248_000;
const TOTAL_COST = 1_240_000;
/** Generic super figures for the tile-footer demo (integer cents). */
const SUPER_NOW = 30_000_000;
const SUPER_TARGET = 80_000_000;
const SUPER_PROJECTED = 70_000_000;

const HOLDINGS: DemoHolding[] = [
  {
    code: 'ABC',
    name: 'Example Co',
    units: '120',
    price: '25.40',
    valueCents: 304_800,
    costCents: 280_000,
    priceDate: '2026-08-18',
    status: 'fresh',
  },
  {
    code: 'XYZ',
    name: 'Sample Holdings',
    units: '50',
    price: '102.50',
    valueCents: 512_500,
    costCents: 545_000,
    priceDate: '2026-08-18',
    status: 'fresh',
  },
  {
    code: 'DEF',
    name: 'Placeholder Group',
    units: '1000',
    price: '1.3445',
    valueCents: 134_450,
    costCents: 100_000,
    priceDate: '2026-08-16',
    status: 'stale',
  },
  {
    code: 'GHI',
    name: 'Demo Industries',
    units: '0.125',
    price: '23700',
    valueCents: 296_250,
    costCents: 320_000,
    priceDate: '2026-08-11',
    status: 'failed',
  },
];

const gainOf = (row: DemoHolding): number => row.valueCents - row.costCents;

const HOLDING_COLUMNS: ColumnTableColumn<DemoHolding>[] = [
  { id: 'code', header: 'Code', value: (row) => row.code, sortable: true },
  { id: 'name', header: 'Name', value: (row) => row.name, sortable: true, minWidth: 160 },
  {
    id: 'units',
    header: 'Units',
    value: (row) => Number(row.units),
    cell: (row) => formatQuantity(row.units, { maxDp: 8 }),
    numeric: true,
    sortable: true,
  },
  {
    id: 'price',
    header: 'Price',
    value: (row) => Number(row.price),
    cell: (row) => formatPrice(row.price),
    numeric: true,
  },
  {
    id: 'value',
    header: 'Value',
    value: (row) => row.valueCents,
    cell: (row) => formatMoney(row.valueCents),
    numeric: true,
    sortable: true,
  },
  {
    id: 'cost',
    header: 'Cost base',
    value: (row) => row.costCents,
    cell: (row) => formatMoney(row.costCents),
    numeric: true,
  },
  {
    id: 'gain',
    header: 'Gain',
    value: gainOf,
    cell: (row) => <Amount cents={gainOf(row)} signDisplay="always" />,
    numeric: true,
    sortable: true,
  },
  {
    id: 'gainPct',
    header: 'Gain %',
    value: (row) => gainOf(row) / row.costCents,
    cell: (row) => formatPercent(gainOf(row) / row.costCents, { signDisplay: 'always' }),
    numeric: true,
  },
  {
    id: 'weight',
    header: 'Weight',
    value: (row) => row.valueCents / TOTAL_VALUE,
    cell: (row) => formatPercent(row.valueCents / TOTAL_VALUE),
    numeric: true,
  },
  {
    id: 'date',
    header: 'Price date',
    value: (row) => row.priceDate,
    cell: (row) => formatDate(row.priceDate),
    numeric: true,
  },
  {
    id: 'status',
    header: 'Status',
    value: (row) => row.status,
    cell: (row) => <StatusBadge status={row.status} />,
  },
];

const EMPTY_COLUMNS: ColumnTableColumn<DemoHolding>[] = HOLDING_COLUMNS.slice(0, 3);

/* ───────────────────────── Formatters demo ───────────────────────── */

interface FormatterExample {
  call: string;
  result: string;
}

const FORMATTER_EXAMPLES: FormatterExample[] = [
  { call: 'formatMoney(1248000)', result: formatMoney(1_248_000) },
  { call: 'formatMoney(-123400)', result: formatMoney(-123_400) },
  {
    call: 'formatMoney(1248000, { wholeDollars })',
    result: formatMoney(1_248_000, { wholeDollars: true }),
  },
  {
    call: "formatMoney(124000, { signDisplay: 'always' })",
    result: formatMoney(124_000, { signDisplay: 'always' }),
  },
  { call: 'formatPercent(0.074)', result: formatPercent(0.074) },
  { call: 'formatPercent(-0.021)', result: formatPercent(-0.021) },
  { call: "formatQuantity('1234.5678')", result: formatQuantity('1234.5678') },
  {
    call: "formatQuantity('0.12345678', { maxDp: 8 })",
    result: formatQuantity('0.12345678', { maxDp: 8 }),
  },
  { call: "formatPrice('1.2345')", result: formatPrice('1.2345') },
  { call: "formatDate('2026-08-18')", result: formatDate('2026-08-18') },
  { call: "formatDateLong('2026-08-18')", result: formatDateLong('2026-08-18') },
  { call: "formatMonth('2026-08')", result: formatMonth('2026-08') },
  {
    call: 'formatTime(new Date(2026, 7, 18, 14, 32))',
    result: formatTime(new Date(2026, 7, 18, 14, 32)),
  },
  {
    call: "formatFinancialYear(financialYearOf('2026-06-30'))",
    result: formatFinancialYear(financialYearOf('2026-06-30')),
  },
  {
    call: "formatFinancialYear(financialYearOf('2026-07-01'))",
    result: formatFinancialYear(financialYearOf('2026-07-01')),
  },
  {
    call: 'financialYearBounds(2026)',
    result: `${formatDate(financialYearBounds(2026).start)} – ${formatDate(financialYearBounds(2026).end)}`,
  },
  { call: "parseMoney('$1,234.50')", result: `${String(parseMoney('$1,234.50'))} cents` },
  { call: "parseMoney('12.345')", result: String(parseMoney('12.345')) },
  { call: "parseDate('18/8/2026')", result: String(parseDate('18/8/2026')) },
  { call: "parseDecimal('1,234.50')", result: String(parseDecimal('1,234.50')) },
];

const FORMATTER_COLUMNS: ColumnTableColumn<FormatterExample>[] = [
  { id: 'call', header: 'Call', value: (row) => row.call, cell: (row) => <code>{row.call}</code> },
  { id: 'result', header: 'Result', value: (row) => row.result, numeric: true },
];

/* ───────────────────────── ImageFrame demo ───────────────────────── */

const FRAME_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 240">',
  '<rect width="640" height="240" fill="#191A24"/>',
  '<path d="M48 200 H608 M48 150 H608 M48 100 H608 M48 50 H608" stroke="#24252F" stroke-width="2"/>',
  '<polyline points="48,180 140,160 232,168 324,120 416,128 508,84 608,72" fill="none" stroke="#17C8A0" stroke-width="4" stroke-linejoin="round"/>',
  '</svg>',
].join('');
const FRAME_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(FRAME_SVG)}`;

/* ───────────────────────── Form demos ───────────────────────── */

function TextFieldDemo(): JSX.Element {
  const [name, setName] = useState('Example Co');
  const [search, setSearch] = useState('');
  return (
    <Stack gap={4}>
      <TextField
        label="Account name"
        value={name}
        onChange={setName}
        hint="As shown on the statement"
        required
      />
      <TextField
        label="Focus state"
        value={search}
        onChange={setSearch}
        type="search"
        placeholder="Search holdings"
        className="jf-field--focus-demo"
      />
      <TextField label="Nickname" value="" onChange={() => undefined} error="Enter a nickname" />
      <TextField label="Account number" value="Locked" onChange={() => undefined} disabled />
    </Stack>
  );
}

function MoneyFieldDemo(): JSX.Element {
  const [amount, setAmount] = useState<number | null>(1_248_000);
  const [adjustment, setAdjustment] = useState<number | null>(-123_400);
  return (
    <Stack gap={4}>
      <MoneyField
        label="Balance"
        value={amount}
        onChange={setAmount}
        hint={`Stored as ${amount === null ? 'nothing' : `${amount} cents`}`}
      />
      <MoneyField
        label="Adjustment"
        value={adjustment}
        onChange={setAdjustment}
        allowNegative
        className="jf-field--focus-demo"
      />
      <MoneyField
        label="Opening balance"
        value={null}
        onChange={() => undefined}
        error={MONEY_INVALID_MESSAGE}
        placeholder="0.00"
      />
      <MoneyField label="Fee" value={995} onChange={() => undefined} disabled />
    </Stack>
  );
}

function NumberFieldDemo(): JSX.Element {
  const [units, setUnits] = useState('0.12345678');
  const [rate, setRate] = useState('7.4');
  return (
    <Stack gap={4}>
      <NumberField
        label="Units"
        value={units}
        onChange={setUnits}
        maxDp={8}
        suffix="units"
        hint="Up to 8 decimal places"
      />
      <NumberField label="Target allocation" value={rate} onChange={setRate} maxDp={1} suffix="%" />
      <NumberField
        label="Quantity"
        value=""
        onChange={() => undefined}
        maxDp={4}
        error="Enter a number with up to 4 decimal places"
      />
      <NumberField
        label="Units held"
        value="250"
        onChange={() => undefined}
        suffix="units"
        disabled
      />
    </Stack>
  );
}

function DateFieldDemo(): JSX.Element {
  const [date, setDate] = useState<string | null>('2026-08-18');
  const fy = financialYearBounds(2026);
  return (
    <Stack gap={4}>
      <DateField
        label="Trade date"
        value={date}
        onChange={setDate}
        hint={date ? formatDateLong(date) : 'Type dd/mm/yyyy or use the calendar'}
      />
      <DateField
        label="Within FY2026–27"
        value="2026-07-01"
        onChange={() => undefined}
        min={fy.start}
        max={fy.end}
        className="jf-field--focus-demo"
      />
      <DateField
        label="Settlement date"
        value={null}
        onChange={() => undefined}
        error={DATE_INVALID_MESSAGE}
      />
      <DateField label="Snapshot date" value="2026-08-01" onChange={() => undefined} disabled />
    </Stack>
  );
}

const REGION_OPTIONS = [
  { value: 'a', label: 'Region A' },
  { value: 'b', label: 'Region B' },
];
const CURRENCY_OPTIONS = [
  { value: 'AUD', label: 'AUD' },
  { value: 'USD', label: 'USD' },
];

function SelectDemo(): JSX.Element {
  const [assetClass, setAssetClass] = useState('');
  const options = [
    { value: 'a', label: 'Asset class A' },
    { value: 'b', label: 'Asset class B' },
    { value: 'c', label: 'Asset class C (closed)', disabled: true },
  ];
  return (
    <Stack gap={4}>
      <Select
        label="Asset class"
        value={assetClass}
        onChange={setAssetClass}
        options={options}
        placeholder="Choose a class"
        hint="Used for allocation targets"
      />
      <Select
        label="Region"
        value=""
        onChange={() => undefined}
        options={REGION_OPTIONS}
        placeholder="Choose a region"
        error="Choose a region"
      />
      <Select
        label="Currency"
        value="AUD"
        onChange={() => undefined}
        options={CURRENCY_OPTIONS}
        disabled
      />
    </Stack>
  );
}

function CheckboxDemo(): JSX.Element {
  const [offset, setOffset] = useState(true);
  const [include, setInclude] = useState(false);
  return (
    <Stack gap={3}>
      <Checkbox label="Offset account" checked={offset} onChange={setOffset} />
      <Checkbox
        label="Include in net worth"
        checked={include}
        onChange={setInclude}
        hint="Leave unticked for accounts you only track"
      />
      <Checkbox label="Closed account" checked onChange={() => undefined} disabled />
    </Stack>
  );
}

function SwitchDemo(): JSX.Element {
  const [auto, setAuto] = useState(true);
  const [alerts, setAlerts] = useState(false);
  return (
    <Stack gap={3}>
      <Switch label="Record snapshots automatically" checked={auto} onChange={setAuto} />
      <Switch
        label="Flag stale prices"
        checked={alerts}
        onChange={setAlerts}
        hint="After 2 days without a price"
      />
      <Switch label="Managed by the server" checked onChange={() => undefined} disabled />
    </Stack>
  );
}

/* ───────────────────────── Section ───────────────────────── */

const STATUSES: StatusKind[] = [
  'go',
  'check',
  'stop',
  'fresh',
  'stale',
  'failed',
  'recorded',
  'pending',
];
// Every allowed span (12, 6, 4, 3, 2) in three rows.
const GRID_ROWS: Span[][] = [[12], [6, 3, 3], [4, 4, 2, 2]];

export function CoreSection(): JSX.Element {
  return (
    <section id="core" className="jf-app-styleguide__section" aria-labelledby="core-title">
      <SectionBar id="core-title" title="Core" role="reference" />

      <GalleryItem
        name="AppShell"
        note="Embedded demo: nothing fixed or sticky, and no spectrum rules (those belong to the real frame around this page)"
      >
        <AppShellDemo />
      </GalleryItem>

      <GalleryItem name="PageHeader" note="H1 31px uppercase, teal sub-line, optional actions">
        <PageHeader
          title="Managed Funds"
          subtitle="Investments"
          level={2}
          actions={
            <>
              <Button icon={Download} size="sm">
                Export
              </Button>
              <Button icon={Plus} size="sm" variant="primary">
                Add trade
              </Button>
            </>
          }
        />
      </GalleryItem>

      <GalleryItem name="SectionBar" note="Orange primary · teal supporting · violet reference">
        <Stack gap={3}>
          <SectionBar
            title="Holdings"
            role="primary"
            level={3}
            actions={
              <Button icon={Plus} size="sm" variant="ghost">
                Add
              </Button>
            }
          />
          <SectionBar title="Price history" role="supporting" level={3} />
          <SectionBar title="Raw data" role="reference" level={3} />
        </Stack>
      </GalleryItem>

      <Grid>
        <GridItem span={6}>
          <GalleryItem name="Card" note="Surface panel, teal H3; flush for tables">
            <Stack gap={3}>
              <Card
                title="Summary"
                subtitle={`As at ${formatDate('2026-08-18')}`}
                actions={
                  <Button icon={Pencil} size="sm" variant="ghost">
                    Edit
                  </Button>
                }
              >
                <p className="jf-prose">
                  Cards group related content on the surface step. Depth comes from the surface
                  steps, never from shadows.
                </p>
              </Card>
              <Card title="Flush card" padding="none">
                <KeyValueTable
                  caption="Flush card example"
                  items={[
                    { label: 'Holdings', value: '4', numeric: true },
                    { label: 'Value', value: <Amount cents={TOTAL_VALUE} />, numeric: true },
                  ]}
                />
              </Card>
            </Stack>
          </GalleryItem>
        </GridItem>
        <GridItem span={6}>
          <GalleryItem name="Callout" note="Note · Important · Do not (use sparingly)">
            <Stack gap={3}>
              <Callout kind="note">
                <p>Figures on this page are examples.</p>
              </Callout>
              <Callout kind="important">
                <p>Prices are 2 days old. Refresh them before you record a snapshot.</p>
              </Callout>
              <Callout kind="do-not">
                <p>Do not delete a recorded snapshot. Deleting it cannot be undone.</p>
              </Callout>
            </Stack>
          </GalleryItem>
        </GridItem>
      </Grid>

      <GalleryItem name="Grid" note="12 columns on desktop, 6 on tablet, 1 on phone; 12px gutters">
        <Stack gap={3}>
          {GRID_ROWS.map((row, rowIndex) => (
            <Grid key={rowIndex}>
              {row.map((span, index) => (
                <GridItem key={index} span={span}>
                  <Card>
                    <span className="jf-num">{span}</span> of 12
                  </Card>
                </GridItem>
              ))}
            </Grid>
          ))}
        </Stack>
      </GalleryItem>

      <GalleryItem
        name="StatTile"
        note="Only the key figure is teal; deltas show an arrow, a sign and a word"
      >
        <Grid>
          <GridItem span={3}>
            <StatTile
              label="Net worth"
              value={formatMoney(TOTAL_VALUE, { wholeDollars: true })}
              keyFigure
              delta={{
                value: formatMoney(124_000, { wholeDollars: true, signDisplay: 'always' }),
                direction: 'up',
                text: 'this month',
              }}
            />
          </GridItem>
          <GridItem span={3}>
            <StatTile
              label="Savings rate"
              value={formatPercent(0.074)}
              delta={{
                value: formatPercent(-0.021, { signDisplay: 'always' }),
                direction: 'down',
                text: 'on last month',
              }}
            />
          </GridItem>
          <GridItem span={3}>
            <StatTile
              label="Monthly spend"
              value={formatMoney(320_000, { wholeDollars: true })}
              delta={{
                value: formatMoney(15_000, { wholeDollars: true, signDisplay: 'always' }),
                direction: 'up',
                text: 'on last month',
                tone: 'stop',
              }}
            />
          </GridItem>
          <GridItem span={3}>
            <StatTile
              label="Last snapshot"
              value={formatMonth('2026-08')}
              delta={{ value: '0', direction: 'flat', text: 'missed months' }}
              hint="Recorded on the 1st"
            />
          </GridItem>
        </Grid>
      </GalleryItem>

      <GalleryItem
        name="StatTile/footer"
        note="Stage 6: a meter and a muted Saved line under the hint, at the tile's foot"
      >
        <Grid>
          <GridItem span={4} spanTablet={3}>
            <StatTile
              label="Years to go"
              value="5 years"
              keyFigure
              hint="Reached in 2031 · age 56"
              footer={<p>Saved: reached in 2033 · age 58</p>}
            />
          </GridItem>
          <GridItem span={4} spanTablet={3}>
            <StatTile
              label="Super needed"
              value={formatMoney(SUPER_TARGET, { wholeDollars: true })}
              hint={`You have ${formatMoney(SUPER_NOW, { wholeDollars: true })}`}
              footer={
                <Meter
                  label="Progress"
                  valueCents={SUPER_NOW}
                  targetCents={SUPER_TARGET}
                  markerCents={SUPER_PROJECTED}
                  markerLabel="Projected at 60"
                  wholeDollars
                />
              }
            />
          </GridItem>
          <GridItem span={4} spanTablet={6}>
            <StatTile
              label="Yearly spend"
              value={formatMoney(4_000_000, { wholeDollars: true })}
              hint="From your last 12 months"
            />
          </GridItem>
        </Grid>
      </GalleryItem>

      <GalleryItem
        name="Skeleton"
        note="First load only (a refetch dims instead); a slow pulse, none under reduced motion; hidden from screen readers"
      >
        <Stack gap={3}>
          <Skeleton variant="text" lines={2} />
          <Grid>
            {[0, 1, 2, 3].map((index) => (
              <GridItem key={index} span={3} spanTablet={3}>
                <Skeleton variant="tile" />
              </GridItem>
            ))}
          </Grid>
          <Grid>
            <GridItem span={6}>
              <Skeleton variant="chart" height={160} />
            </GridItem>
            <GridItem span={6}>
              <Stack gap={3}>
                <Skeleton variant="card" height={96} />
                <Skeleton variant="table" lines={3} />
              </Stack>
            </GridItem>
          </Grid>
        </Stack>
      </GalleryItem>

      <GalleryItem
        name="ColumnTable"
        note="Sortable headers; total row white bold with one teal figure; scrolls inside its box with a sticky first column"
      >
        <Stack gap={4}>
          <ColumnTable
            caption="Example holdings"
            showCaption
            columns={HOLDING_COLUMNS}
            rows={HOLDINGS}
            getRowId={(row) => row.code}
            total={{
              label: 'Total',
              keyColumnId: 'value',
              cells: {
                value: formatMoney(TOTAL_VALUE),
                cost: formatMoney(TOTAL_COST),
                gain: <Amount cents={TOTAL_VALUE - TOTAL_COST} signDisplay="always" />,
                gainPct: formatPercent((TOTAL_VALUE - TOTAL_COST) / TOTAL_COST, {
                  signDisplay: 'always',
                }),
                weight: formatPercent(1),
              },
            }}
          />
          <ColumnTable
            caption="Empty table"
            showCaption
            columns={EMPTY_COLUMNS}
            rows={[]}
            getRowId={(row) => row.code}
            density="regular"
          />
        </Stack>
      </GalleryItem>

      <Grid>
        <GridItem span={6}>
          <GalleryItem
            name="KeyValueTable"
            note="Raised label column at 38%; hairlines between rows; values left-aligned, figures monospaced; rows stack below 480 px of its width"
          >
            <KeyValueTable
              caption="Example account"
              items={[
                { label: 'Account', value: 'Example Co savings' },
                { label: 'Type', value: 'Offset' },
                { label: 'Opened', value: formatDate('2025-07-01'), numeric: true },
                { label: 'Balance', value: <Amount cents={TOTAL_VALUE} />, numeric: true },
                { label: 'Interest rate', value: formatPercent(0.045), numeric: true },
                { label: 'Prices', value: <StatusBadge status="fresh" /> },
              ]}
            />
          </GalleryItem>
        </GridItem>
        <GridItem span={6}>
          <GalleryItem
            name="KeyValueTable/narrow"
            note="In a 343 px box: each label strip sits above its value; words never split"
          >
            <div style={{ maxWidth: '343px' }}>
              <KeyValueTable
                caption="Example account at phone width"
                items={[
                  { label: 'Super contribution a year', value: 'From your contributions' },
                  { label: 'Balance', value: <Amount cents={TOTAL_VALUE} />, numeric: true },
                  { label: 'Interest rate', value: formatPercent(0.045), numeric: true },
                ]}
              />
            </div>
          </GalleryItem>
        </GridItem>
        <GridItem span={6}>
          <GalleryItem name="StepCard" note="The only use of the violet–fuchsia gradient">
            <Stack gap={3}>
              <StepCard step={1} title="Import your data" subtitle="About five minutes">
                <p>Choose the exported workbook.</p>
              </StepCard>
              <StepCard step={2} title="Check the reconciliation" subtitle="Differences are listed">
                <p>Every total is compared with the source.</p>
              </StepCard>
              <StepCard step={3} title="Record a snapshot" subtitle="Monthly" />
            </Stack>
          </GalleryItem>
        </GridItem>
      </Grid>

      <Grid>
        <GridItem span={6}>
          <GalleryItem name="StatusBadge" note="Always an icon and a word; readable in greyscale">
            <Cluster gap={2}>
              {STATUSES.map((status) => (
                <StatusBadge key={status} status={status} />
              ))}
            </Cluster>
          </GalleryItem>
        </GridItem>
        <GridItem span={6}>
          <GalleryItem name="Pill" note="Teal by default; violet and fuchsia for real categories">
            <Cluster gap={2}>
              <Pill>Dividend</Pill>
              <Pill>Growth</Pill>
              <Pill tone="violet">Category A</Pill>
              <Pill tone="fuchsia">Category B</Pill>
              <Pill tone="na">Not applicable</Pill>
            </Cluster>
          </GalleryItem>
        </GridItem>
      </Grid>

      <GalleryItem
        name="ImageFrame"
        note="1px hairline frame, radius 6; full or exactly half width"
      >
        <Stack gap={4}>
          <ImageFrame
            loading="eager"
            src={FRAME_SRC}
            alt="An example line chart"
            caption="Full width"
          />
          <ImageFrame
            loading="eager"
            src={FRAME_SRC}
            alt="An example line chart"
            width="half"
            caption="Half width"
          />
        </Stack>
      </GalleryItem>

      <Grid>
        <GridItem span={6}>
          <GalleryItem
            name="Icon"
            note="lucide, stroke 1.75: 16px inline, 20px in the nav; always beside a label"
          >
            <Stack gap={3}>
              <Cluster gap={4}>
                <Cluster gap={1}>
                  <Icon icon={Wallet} className="jf-app-icon-demo" />
                  <span>Cash</span>
                </Cluster>
                <Cluster gap={1}>
                  <Icon icon={ChartCandlestick} className="jf-app-icon-demo" />
                  <span>Stocks</span>
                </Cluster>
                <Cluster gap={1}>
                  <Icon icon={History} className="jf-app-icon-demo" />
                  <span>History</span>
                </Cluster>
              </Cluster>
              <Cluster gap={4}>
                <Cluster gap={2}>
                  <Icon icon={Wallet} size={20} className="jf-app-icon-demo" />
                  <span>Cash</span>
                </Cluster>
                <Cluster gap={2}>
                  <Icon icon={Settings} size={20} className="jf-app-icon-demo" />
                  <span>Settings</span>
                </Cluster>
                <Cluster gap={2}>
                  <Icon icon={RefreshCw} size={20} className="jf-app-icon-demo" />
                  <span>Refresh prices</span>
                </Cluster>
              </Cluster>
            </Stack>
          </GalleryItem>
        </GridItem>
        <GridItem span={6}>
          <GalleryItem
            name="Button"
            note="Uppercase, letter-spaced, no shadow; icon-only only with a label"
          >
            <Stack gap={3}>
              <Cluster gap={2}>
                <Button variant="primary" icon={Camera}>
                  Record snapshot
                </Button>
                <Button icon={Download}>Export</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="danger" icon={Trash2}>
                  Delete
                </Button>
              </Cluster>
              <Cluster gap={2}>
                <Button size="sm" variant="primary">
                  Save
                </Button>
                <Button size="sm">Edit</Button>
                <Button size="sm" variant="ghost" icon={Plus}>
                  Add
                </Button>
                <Button icon={RefreshCw} aria-label="Refresh prices" />
                <Button size="sm" icon={Trash2} variant="danger" aria-label="Delete row" />
                <Button disabled>Disabled</Button>
              </Cluster>
            </Stack>
          </GalleryItem>
        </GridItem>
      </Grid>

      <Grid>
        <GridItem span={6}>
          <GalleryItem name="TextField" note="Label above; focus, error and disabled states">
            <TextFieldDemo />
          </GalleryItem>
        </GridItem>
        <GridItem span={6}>
          <GalleryItem name="MoneyField" note="Raw while typing, formatted on blur; integer cents">
            <MoneyFieldDemo />
          </GalleryItem>
        </GridItem>
        <GridItem span={6}>
          <GalleryItem name="NumberField" note="Decimal strings; monospaced, right-aligned">
            <NumberFieldDemo />
          </GalleryItem>
        </GridItem>
        <GridItem span={6}>
          <GalleryItem name="DateField" note="dd/mm/yyyy text with a calendar picker">
            <DateFieldDemo />
          </GalleryItem>
        </GridItem>
        <GridItem span={6}>
          <GalleryItem name="Select">
            <SelectDemo />
          </GalleryItem>
        </GridItem>
        <GridItem span={3}>
          <GalleryItem name="Checkbox">
            <CheckboxDemo />
          </GalleryItem>
        </GridItem>
        <GridItem span={3}>
          <GalleryItem name="Switch">
            <SwitchDemo />
          </GalleryItem>
        </GridItem>
      </Grid>

      <GalleryItem
        name="Amount"
        note="Money in a line of text or a cell; negatives in the stop colour"
      >
        <Cluster gap={6}>
          <Amount cents={TOTAL_VALUE} />
          <Amount cents={-123_400} />
          <Amount cents={124_000} wholeDollars signDisplay="always" />
        </Cluster>
      </GalleryItem>

      <GalleryItem
        name="Formatters"
        note="STYLE_GUIDE §8: U+2212 minus, en-AU grouping, dd/mm/yyyy, FY 1 July – 30 June"
      >
        <ColumnTable
          caption="Formatter examples"
          columns={FORMATTER_COLUMNS}
          rows={FORMATTER_EXAMPLES}
          getRowId={(row) => row.call}
          stickyFirstColumn={false}
          density="regular"
        />
      </GalleryItem>
    </section>
  );
}
