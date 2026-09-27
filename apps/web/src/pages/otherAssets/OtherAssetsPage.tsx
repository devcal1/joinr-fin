// The Other Assets page (stage-4.md §6.3, §6.7–6.9, D72, D73): the KPI tiles, the callouts
// (assumed dates, FX, market off), the assets table with Update prices, the item and sale forms,
// the price history, the sales, the value-over-time charts and the page's setting. One inline
// form is open at a time.
import type { OtherAssetDto, OtherAssetsPageResponse } from '@joinr/schema';
import { Button, Callout, PageHeader, SectionBar, toIsoDate } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { Plus, Tags } from 'lucide-react';
import { useRef, useState, type JSX } from 'react';
import { useOtherAssetsPage, useSaveOtherAssetPrices } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { SettingsSection } from '../cashflow/SettingsSection';
import { FormError } from '../cashflow/forms';
import {
  actionErrorText,
  actionSelector,
  useEditor,
  type EditorState,
} from '../cashflow/formState';
import { SharedEntryForm } from '../assets/SharedEntryForm';
import { useSharedEntry } from '../assets/sharedEntry';
import { AssetForm } from './AssetForm';
import { AssetsTable } from './AssetsTable';
import { OtherAssetsCharts } from './OtherAssetsCharts';
import { OtherAssetsTiles } from './OtherAssetsTiles';
import { PriceHistory } from './PriceHistory';
import { SaleForm } from './SaleForm';
import { SalesTable } from './SalesTable';
import {
  COST_TOTAL_NOTE,
  MARKET_OFF_NOTE,
  NO_ASSETS,
  assetActionKey,
  assumedText,
  historyAnnouncement,
  liveFxText,
  priceRowChanged,
  purchaseFxText,
  saleActionKey,
  type OtherAssetsEditor,
  type PriceEdit,
} from './otherAssetsText';

const UPDATE_PRICES = 'update-prices';
const ADD_ASSET = 'add-asset';
const EDIT_SETTINGS = 'other-assets-settings';

export function OtherAssetsPage(): JSX.Element {
  const query = useOtherAssetsPage();
  const page = query.data;
  const editor = useEditor<OtherAssetsEditor>();
  const open = editor.editor;
  const hasManual = page?.assets.some((a) => a.priceSource === 'manual') ?? false;

  const actions = page ? (
    <>
      {hasManual ? (
        <Button
          variant="primary"
          icon={Tags}
          data-cf-action={UPDATE_PRICES}
          onClick={() => editor.open({ form: 'prices', opener: actionSelector(UPDATE_PRICES) })}
          disabled={open?.form === 'prices'}
        >
          Update prices
        </Button>
      ) : null}
      <Button
        variant="secondary"
        icon={Plus}
        data-cf-action={ADD_ASSET}
        onClick={() => editor.open({ form: 'asset', opener: actionSelector(ADD_ASSET) })}
      >
        Add asset
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader title="Other Assets" subtitle="Assets" actions={actions} />
      <QueryStates
        query={query}
        loading="Loading other assets…"
        layout="dashboard"
        errorTitle="Could not load other assets"
      />
      {page ? <OtherAssetsContent page={page} editor={editor} /> : null}
    </>
  );
}

function OtherAssetsCallouts({ page }: { page: OtherAssetsPageResponse }): JSX.Element {
  const { totals } = page;
  const marketOff = page.market.mode === 'off';
  return (
    <>
      {totals.assumedDateCount > 0 && page.assumedDate ? (
        <Callout kind="note" title="Assumed dates">
          <p>{assumedText(totals.assumedDateCount, page.assumedDate)}</p>
        </Callout>
      ) : null}
      {totals.fxMissingCount > 0 ? (
        <Callout kind="important" title="Exchange rate needed">
          <p>{purchaseFxText(totals.fxMissingCount)}</p>
        </Callout>
      ) : null}
      {marketOff ? (
        <Callout kind="note" title="Market data off">
          <p>{MARKET_OFF_NOTE}</p>
        </Callout>
      ) : totals.liveFxMissingCount > 0 ? (
        <Callout kind="note" title="No current exchange rate">
          <p>{liveFxText(totals.liveFxMissingCount)}</p>
        </Callout>
      ) : null}
    </>
  );
}

function OtherAssetsContent({
  page,
  editor,
}: {
  page: OtherAssetsPageResponse;
  editor: EditorState<OtherAssetsEditor>;
}): JSX.Element {
  const open = editor.editor;
  const [historyId, setHistoryId] = useState<number | null>(null);
  // A read-only action's announcement (UX-18): a hidden live region, never the "Saved" callout.
  const [navNotice, setNavNotice] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const mark = useSaveOtherAssetPrices();
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const locked = open !== null;

  const showHistory = (asset: OtherAssetDto): void => {
    setHistoryId(asset.id);
    const card = historyRef.current;
    card?.scrollIntoView?.({ block: 'nearest' });
    const heading = card?.querySelector<HTMLElement>('h3');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
    setNavNotice(historyAnnouncement(asset));
  };

  // Mark current (UX-6): the latest price saved again at today's date clears Stale.
  const markCurrent = (asset: OtherAssetDto): void => {
    if (asset.unitPrice === null) return;
    setMarkError(null);
    setMarkingId(asset.id);
    mark.mutate(
      { asOf: toIsoDate(new Date()), entries: [{ assetId: asset.id, unitPrice: asset.unitPrice }] },
      {
        onSuccess: () => {
          setMarkingId(null);
          editor.announce('Prices saved');
        },
        onError: (error) => {
          setMarkingId(null);
          setMarkError(actionErrorText(error));
        },
      },
    );
  };

  const table = (edit: PriceEdit | null) => (
    <AssetsTable
      page={page}
      edit={edit}
      locked={locked}
      markingId={markingId}
      onEdit={(asset) =>
        editor.open({
          form: 'asset',
          asset,
          opener: actionSelector(assetActionKey('edit', asset.id)),
        })
      }
      onSell={(asset) =>
        editor.open({
          form: 'sale',
          asset,
          opener: actionSelector(assetActionKey('sell', asset.id)),
        })
      }
      onHistory={showHistory}
      onMarkCurrent={markCurrent}
    />
  );

  return (
    <>
      <LiveRegion kind="status" label="Save result">
        {editor.notice ? (
          <Callout kind="note" title="Saved">
            <p>{editor.notice}.</p>
          </Callout>
        ) : null}
      </LiveRegion>
      <LiveRegion kind="status" label="Page updates" className="jf-visually-hidden">
        {navNotice}
      </LiveRegion>
      <OtherAssetsTiles page={page} />
      <OtherAssetsCallouts page={page} />
      <section className="jf-app-block" aria-labelledby="other-assets-heading">
        <SectionBar id="other-assets-heading" title="Assets" role="primary" />
        {open?.form === 'asset' ? (
          <AssetForm
            key={open.asset ? `asset-${open.asset.id}` : 'new-asset'}
            asset={open.asset}
            onDone={editor.done}
            onCancel={editor.close}
          />
        ) : null}
        {page.assets.length === 0 ? (
          <Callout kind="note" title="No other assets">
            <p>
              {NO_ASSETS} <Link to="/import">Import page</Link>.
            </p>
          </Callout>
        ) : open?.form === 'prices' ? (
          <PricesForm
            page={page}
            renderTable={table}
            onDone={editor.done}
            onCancel={editor.close}
          />
        ) : (
          <>
            <FormError message={markError} title="Not saved" />
            {table(null)}
            <p className="jf-app-meta">{COST_TOTAL_NOTE}</p>
          </>
        )}
        {open?.form === 'sale' ? (
          <SaleForm
            key={open.sale ? `sale-${open.sale.id}` : `sell-${open.asset.id}`}
            asset={open.asset}
            sale={open.sale}
            onDone={editor.done}
            onCancel={editor.close}
          />
        ) : null}
        {page.assets.length > 0 ? (
          <div ref={historyRef}>
            <PriceHistory
              page={page}
              assetId={historyId}
              onAssetChange={setHistoryId}
              onDeleted={editor.announce}
            />
          </div>
        ) : null}
        {page.sales.length > 0 ? (
          <SalesTable
            page={page}
            locked={locked}
            onEdit={(asset, sale) =>
              editor.open({
                form: 'sale',
                asset,
                sale,
                opener: actionSelector(saleActionKey('edit', sale.id)),
              })
            }
            onDeleted={editor.announce}
          />
        ) : null}
      </section>
      <section className="jf-app-block" aria-labelledby="other-assets-history-heading">
        <SectionBar id="other-assets-history-heading" title="Value over time" role="supporting" />
        <OtherAssetsCharts points={page.charts.points} />
      </section>
      <SettingsSection
        headingId="other-assets-settings-heading"
        title="Settings for this page"
        role="reference"
        keys={['otherAssets.stalePriceDays']}
        hints={{ 'otherAssets.stalePriceDays': 'Kept when you re-import' }}
        slice={page.settings}
        editing={open?.form === 'settings'}
        actionKey={EDIT_SETTINGS}
        onEdit={() => editor.open({ form: 'settings', opener: actionSelector(EDIT_SETTINGS) })}
        onCancel={editor.close}
        onDone={editor.done}
      />
    </>
  );
}

// ─── Update prices (D72) ────────────────────────────────────────────────────────────────────────

function PricesForm({
  page,
  renderTable,
  onDone,
  onCancel,
}: {
  page: OtherAssetsPageResponse;
  renderTable: (edit: PriceEdit) => JSX.Element;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const state = useSharedEntry();
  const save = useSaveOtherAssetPrices();
  const [drafts, setDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      page.assets.filter((a) => a.priceSource === 'manual').map((a) => [a.id, a.unitPrice ?? '']),
    ),
  );
  const [current, setCurrent] = useState<Record<number, boolean>>({});
  const pending = save.isPending;
  const edit: PriceEdit = {
    drafts,
    current,
    asOf: state.asOf,
    pending,
    onDraft: (id, value) => setDrafts((d) => ({ ...d, [id]: value })),
    onCurrent: (id, checked) => setCurrent((c) => ({ ...c, [id]: checked })),
  };
  const changed = page.assets.filter((a) => priceRowChanged(edit, a));
  const workbook = changed.some((a) => a.origin === 'import');

  const submit = (): boolean => {
    if (!state.asOf) return false;
    save.mutate(
      {
        asOf: state.asOf,
        entries: changed.map((a) => {
          const draft = drafts[a.id] ?? '';
          const unitPrice = draft !== '' ? draft : (a.unitPrice ?? '0');
          return {
            assetId: a.id,
            unitPrice,
            ...(state.sharedNote ? { note: state.sharedNote } : {}),
          };
        }),
      },
      { onSuccess: () => onDone('Prices saved'), onError: state.fail },
    );
    return true;
  };

  return (
    <SharedEntryForm
      label="Update prices"
      saveLabel="Save prices"
      state={state}
      pristine={changed.length === 0}
      statusLine={
        changed.length === 0
          ? 'Type the new prices below, or tick Still current; only those rows are saved.'
          : `${plural(changed.length, 'price')} to save.`
      }
      workbook={workbook}
      pending={pending}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {renderTable(edit)}
    </SharedEntryForm>
  );
}
