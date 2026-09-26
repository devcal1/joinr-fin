// The Other Assets table (stage-4.md §6.3 item 4, UX-5, UX-13): Item · Bought · Units · Unit cost ·
// Price · Cost · Value · Gain · Gain % · Return / yr · Actions (phone: status-first, §6.8, with the
// row's markers under the name). Cost is the AUD cost of the units still held, so Value − Cost =
// Gain on every row. In Update prices mode (D72) every hand-priced row's Price cell becomes a
// decimal field with a Still current box, above the row's latest price date and its markers (so a
// stale row still reads Stale); bullion rows read "Spot". Mark current (UX-6) sits in a stale hand
// price's Price cell, beside the state it clears, so it is in view at every width.
import type { OtherAssetDto, OtherAssetsPageResponse } from '@joinr/schema';
import {
  Amount,
  Button,
  Checkbox,
  ColumnTable,
  NumberField,
  Pill,
  formatDate,
  formatPrice,
  formatQuantity,
  type ColumnTableColumn,
} from '@joinr/ui';
import { CalendarCheck, HandCoins, History, Pencil } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { MoneyCell, RatioCell } from '../cashflow/cells';
import { orderColumns } from '../cashflow/formState';
import { DashWithReason } from '../investments/cells';
import {
  HELD_UNDER_90_DAYS,
  annualisedHidden,
  fxLine,
  isUrlName,
  plainPrice,
  shortName,
  unitCostText,
  unitsText,
} from '../assets/display';
import { FirstCell, Markers } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { OlderNote } from '../assets/SharedEntryForm';
import { isOlder, olderThanLatest } from '../assets/sharedEntry';
import {
  METAL_LABELS,
  assetActionKey,
  assetMarkers,
  priceMarkers,
  priceRowChanged,
  type PriceEdit,
} from './otherAssetsText';

const DESKTOP_ORDER = [
  'item',
  'bought',
  'units',
  'unitCost',
  'price',
  'cost',
  'value',
  'gain',
  'gainRatio',
  'cagr',
  'actions',
] as const;

const PHONE_ORDER = [
  'item',
  'value',
  'gain',
  'price',
  'actions',
  'cost',
  'bought',
  'units',
  'unitCost',
  'gainRatio',
  'cagr',
] as const;

/** The link an item's name opens: its valuation source, or the description when it is a URL. */
function linkOf(asset: OtherAssetDto): string | null {
  const href = asset.url ?? (isUrlName(asset.description) ? asset.description.trim() : null);
  return href && /^https?:\/\//i.test(href) ? href : null;
}

/** An item's name: a link to its valuation source (new tab); a URL name shows its short form. */
export function ItemName({ asset }: { asset: OtherAssetDto }): JSX.Element {
  const short = shortName(asset.description);
  const href = linkOf(asset);
  const urlNamed = isUrlName(asset.description);
  const nameClass = urlNamed ? 'jf-app-item-name jf-app-item-name--url' : 'jf-app-item-name';
  if (!href) return <span className={nameClass}>{short}</span>;
  return (
    <a
      className={`${nameClass} jf-app-item-link`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={urlNamed ? asset.description.trim() : href}
      aria-label={`${urlNamed ? asset.description.trim() : short} (valuation source)`}
    >
      {short}
    </a>
  );
}

function ItemCell({ asset, phone }: { asset: OtherAssetDto; phone: boolean }): JSX.Element {
  const legacy = Number(asset.legacySoldUnits);
  return (
    <FirstCell
      phone={phone}
      markers={assetMarkers(asset)}
      extra={
        <>
          {asset.priceSource === 'bullion' && asset.metal ? (
            <Pill>
              {METAL_LABELS[asset.metal]} · {formatQuantity(asset.ozPerUnit ?? '0')} oz each
            </Pill>
          ) : null}
          {legacy > 0 ? (
            <span className="jf-app-muted jf-app-small">
              {formatQuantity(asset.legacySoldUnits)} sold in the workbook
            </span>
          ) : null}
          {asset.note ? <span className="jf-app-muted jf-app-small">{asset.note}</span> : null}
        </>
      }
    >
      <ItemName asset={asset} />
    </FirstCell>
  );
}

function boughtCell(asset: OtherAssetDto, phone: boolean): ReactNode {
  if (asset.effectiveDate === null) {
    return <DashWithReason reason="No purchase date and no recorded month" />;
  }
  return (
    <span className="jf-app-period-cell">
      <span className="jf-app-nowrap">{formatDate(asset.effectiveDate)}</span>
      {asset.dateAssumed && !phone ? <Markers ids={['assumed']} /> : null}
    </span>
  );
}

function unitCostCell(asset: OtherAssetDto): ReactNode {
  if (asset.unitCost === null) return <DashWithReason reason="No cost" />;
  const text = unitCostText(asset.unitCost, asset.currency);
  if (asset.currency === 'AUD') return text;
  return (
    <span className="jf-app-kv-stack jf-app-align-end">
      <span>{text}</span>
      <span className="jf-app-muted jf-app-small jf-app-fx-line">
        {asset.purchaseFxRate === null
          ? 'No exchange rate on the purchase date yet'
          : fxLine(asset.currency, asset.purchaseFxRate, asset.purchaseFxDate)}
      </span>
    </span>
  );
}

function priceCell(
  asset: OtherAssetDto,
  phone: boolean,
  edit: PriceEdit | null,
  markCurrent: ReactNode,
): ReactNode {
  const short = shortName(asset.description);
  if (edit) {
    if (asset.priceSource === 'bullion') {
      return <span className="jf-app-muted jf-app-text-value jf-app-text-value--whole">Spot</span>;
    }
    const draft = edit.drafts[asset.id] ?? '';
    const changed = priceRowChanged(edit, asset);
    return (
      <span className="jf-app-balance-edit">
        <NumberField
          label={`Price, ${short}`}
          labelHidden
          value={draft}
          onChange={(value) => edit.onDraft(asset.id, value)}
          maxDp={8}
          suffix={asset.currency === 'AUD' ? undefined : asset.currency}
          disabled={edit.pending}
        />
        {asset.unitPrice !== null ? (
          <Checkbox
            label="Still current"
            labelSuffix={`, ${short}`}
            checked={edit.current[asset.id] === true}
            onChange={(checked) => edit.onCurrent(asset.id, checked)}
            disabled={edit.pending}
          />
        ) : null}
        {changed && isOlder(edit.asOf, asset.priceAsOf) && asset.priceAsOf ? (
          <OlderNote text={olderThanLatest('price', asset.priceAsOf)} />
        ) : null}
        {/* The row's latest price date and markers stay in view (on a phone the markers are in
            the first cell, UX-4), so the stale rows this mode is for can be told apart. */}
        {!phone && (asset.priceAsOf || priceMarkers(asset).length > 0) ? (
          <span className="jf-app-price-edit-meta">
            {asset.priceAsOf ? (
              <span className="jf-app-muted jf-app-small">{formatDate(asset.priceAsOf)}</span>
            ) : null}
            <Markers ids={priceMarkers(asset)} />
          </span>
        ) : null}
      </span>
    );
  }
  const markers = phone ? null : <Markers ids={priceMarkers(asset)} />;
  if (asset.unitPriceAud === null) {
    // A foreign price without today's rate still shows in its currency.
    return (
      <span className="jf-app-kv-stack jf-app-align-end">
        {asset.unitPrice !== null ? (
          <span>
            {plainPrice(asset.unitPrice)} {asset.currency}
          </span>
        ) : (
          <Missing />
        )}
        {asset.flags.includes('live_fx_missing') ? (
          <span className="jf-app-muted jf-app-small">No current exchange rate</span>
        ) : null}
        {markers}
        {markCurrent}
      </span>
    );
  }
  return (
    <span className="jf-app-kv-stack jf-app-align-end">
      <span>{formatPrice(asset.unitPriceAud)}</span>
      {asset.priceAsOf ? (
        <span className="jf-app-muted jf-app-small">{formatDate(asset.priceAsOf)}</span>
      ) : null}
      {markers}
      {markCurrent}
    </span>
  );
}

function costReason(asset: OtherAssetDto): string {
  if (Number(asset.remainingUnits) <= 0) return 'Sold';
  if (asset.flags.includes('purchase_fx_missing')) return 'No exchange rate on the purchase date';
  if (asset.flags.includes('no_cost')) return 'No cost';
  return 'Not known';
}

function valueReason(asset: OtherAssetDto): string {
  if (Number(asset.remainingUnits) <= 0) return 'Sold';
  if (asset.flags.includes('live_fx_missing')) return 'No current exchange rate';
  if (asset.priceStatus === 'none') return 'No price yet';
  return 'Not known';
}

function gainReason(asset: OtherAssetDto): string {
  return asset.valueCents === null ? valueReason(asset) : costReason(asset);
}

function cagrCell(asset: OtherAssetDto, phone: boolean): ReactNode {
  const marker = asset.dateAssumed && !phone ? <Markers ids={['assumed']} /> : null;
  let figure: ReactNode;
  if (asset.cagrRatio === null) {
    figure =
      asset.effectiveDate === null ? (
        <DashWithReason reason="No purchase date and no recorded month" />
      ) : asset.valueCents === null || asset.costCents === null ? (
        <DashWithReason reason={gainReason(asset)} />
      ) : (
        <Missing />
      );
  } else if (annualisedHidden(asset.heldDays)) {
    figure = <DashWithReason reason={HELD_UNDER_90_DAYS} />;
  } else {
    figure = <RatioCell ratio={asset.cagrRatio} loss />;
  }
  return marker ? (
    <span className="jf-app-rate-cell">
      {figure}
      {marker}
    </span>
  ) : (
    figure
  );
}

export interface AssetsTableProps {
  page: OtherAssetsPageResponse;
  edit: PriceEdit | null;
  /** Another form is open: row actions are disabled. */
  locked: boolean;
  markingId: number | null;
  onEdit: (asset: OtherAssetDto) => void;
  onSell: (asset: OtherAssetDto) => void;
  onHistory: (asset: OtherAssetDto) => void;
  onMarkCurrent: (asset: OtherAssetDto) => void;
}

export function AssetsTable({
  page,
  edit,
  locked,
  markingId,
  onEdit,
  onSell,
  onHistory,
  onMarkCurrent,
}: AssetsTableProps): JSX.Element {
  const { phone, firstMin } = useTableLayout();
  // Mark current (UX-6): a stale hand price saved again at today's date, from its Price cell.
  const markCurrentButton = (a: OtherAssetDto): ReactNode => {
    const staleManual =
      a.priceSource === 'manual' && a.priceStatus === 'stale' && a.unitPrice !== null;
    if (!staleManual) return null;
    return (
      <Button
        variant="ghost"
        size="sm"
        icon={CalendarCheck}
        className="jf-app-mark-current"
        aria-label={`Mark the price of ${shortName(a.description)} current`}
        data-cf-action={assetActionKey('current', a.id)}
        onClick={() => onMarkCurrent(a)}
        disabled={locked || edit !== null || markingId !== null}
        aria-busy={markingId === a.id || undefined}
      >
        Mark current
      </Button>
    );
  };
  const all: Record<string, ColumnTableColumn<OtherAssetDto>> = {
    item: {
      id: 'item',
      header: 'Item',
      value: (a) => shortName(a.description),
      cell: (a) => <ItemCell asset={a} phone={phone} />,
      minWidth: firstMin(200, 150),
    },
    bought: {
      id: 'bought',
      header: 'Bought',
      value: (a) => a.effectiveDate,
      cell: (a) => boughtCell(a, phone),
      numeric: true,
    },
    units: {
      id: 'units',
      header: 'Units',
      value: (a) => Number(a.remainingUnits),
      cell: (a) => unitsText(a.remainingUnits, a.unitOfMeasure),
      numeric: true,
    },
    unitCost: {
      id: 'unitCost',
      header: 'Unit cost',
      value: (a) => (a.unitCost === null ? null : Number(a.unitCost)),
      cell: unitCostCell,
      numeric: true,
    },
    price: {
      id: 'price',
      header: 'Price',
      value: (a) => (a.unitPriceAud === null ? null : Number(a.unitPriceAud)),
      cell: (a) => priceCell(a, phone, edit, markCurrentButton(a)),
      numeric: true,
    },
    cost: {
      id: 'cost',
      header: 'Cost',
      value: (a) => a.costCents,
      cell: (a) =>
        a.costCents === null ? (
          <DashWithReason reason={costReason(a)} />
        ) : (
          <MoneyCell cents={a.costCents} loss={false} />
        ),
      numeric: true,
    },
    value: {
      id: 'value',
      header: 'Value',
      value: (a) => a.valueCents,
      cell: (a) =>
        a.valueCents === null ? (
          <DashWithReason reason={valueReason(a)} />
        ) : (
          <MoneyCell cents={a.valueCents} loss={false} />
        ),
      numeric: true,
    },
    gain: {
      id: 'gain',
      header: 'Gain',
      value: (a) => a.gainCents,
      cell: (a) =>
        a.gainCents === null ? (
          <DashWithReason reason={gainReason(a)} />
        ) : (
          <MoneyCell cents={a.gainCents} loss />
        ),
      numeric: true,
    },
    gainRatio: {
      id: 'gainRatio',
      header: 'Gain %',
      value: (a) => (a.gainRatio === null ? null : Number(a.gainRatio)),
      cell: (a) =>
        a.gainRatio === null ? (
          <DashWithReason reason={gainReason(a)} />
        ) : (
          <RatioCell ratio={a.gainRatio} loss />
        ),
      numeric: true,
    },
    cagr: {
      id: 'cagr',
      header: 'Return / yr',
      value: (a) => (a.cagrRatio === null ? null : Number(a.cagrRatio)),
      cell: (a) => cagrCell(a, phone),
      numeric: true,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (a) => {
        const short = shortName(a.description);
        const disabled = locked || edit !== null;
        return (
          // Edit · Sell on the first line and Price history on the second, from 768 px, so a row
          // stays two lines tall (the Stage 3 savings pattern). Mark current sits in the Price
          // cell (STYLE-10).
          <span className="jf-app-row-actions jf-app-row-actions--pairs">
            <span className="jf-app-row-actions__pair">
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                aria-label={`Edit ${short}`}
                data-cf-action={assetActionKey('edit', a.id)}
                onClick={() => onEdit(a)}
                disabled={disabled}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={HandCoins}
                aria-label={`Sell ${short}`}
                data-cf-action={assetActionKey('sell', a.id)}
                onClick={() => onSell(a)}
                disabled={disabled || Number(a.remainingUnits) <= 0}
              >
                Sell
              </Button>
            </span>
            <span className="jf-app-row-actions__pair">
              <Button
                variant="ghost"
                size="sm"
                icon={History}
                aria-label={`Price history of ${short}`}
                data-cf-action={assetActionKey('history', a.id)}
                onClick={() => onHistory(a)}
                disabled={edit !== null}
              >
                Price history
              </Button>
            </span>
          </span>
        );
      },
    },
  };
  const { totals } = page;
  return (
    <div className="jf-app-assets-table">
      <ColumnTable
        columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
        rows={page.assets}
        getRowId={(a) => String(a.id)}
        caption={`Assets: ${plural(page.assets.length, 'item')}`}
        showCaption
        total={{
          label: 'Total',
          cells: {
            cost: <Amount cents={totals.costCents} />,
            value: <Amount cents={totals.valueCents} />,
            gain: <Amount cents={totals.gainCents} />,
          },
        }}
      />
    </div>
  );
}
