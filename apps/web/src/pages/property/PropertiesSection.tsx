// The Properties section (stage-4.md §6.5 item 4, D67, D68): a Card per property (span 12 for one,
// 6 each for more) with its facts (Purchased · Primary residence · Purchase price · Value · Net rent
// · Gain · Annualised gain · Mortgage (net) · Equity · Loan to value) and the Edit and Valuations
// actions. Update values (a page action) wraps a one-row-per-property table in the shared entry
// form: one value field per property, the shared As of and Note, Save sends the changed ones.
import type { PropertyDto, PropertyPageResponse } from '@joinr/schema';
import {
  Button,
  Card,
  ColumnTable,
  Grid,
  GridItem,
  KeyValueTable,
  MoneyField,
  formatDate,
  type ColumnTableColumn,
  type KeyValueItem,
} from '@joinr/ui';
import { History, Pencil } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useSaveValuations } from '../../api/hooks';
import { plural } from '../../formatting';
import { MoneyCell, RatioCell } from '../cashflow/cells';
import { DashWithReason } from '../investments/cells';
import { HELD_UNDER_90_DAYS, annualisedHidden, percentText } from '../assets/display';
import { FirstCell } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { OlderNote, SharedEntryForm } from '../assets/SharedEntryForm';
import { isOlder, olderThanLatest, useSharedEntry } from '../assets/sharedEntry';
import { NO_MORTGAGE, PRIMARY_RESIDENCE_NOTE, propertyActionKey } from './propertyText';

function annualisedCell(property: PropertyDto): JSX.Element {
  if (property.cagrRatio === null) {
    return (
      <DashWithReason
        reason={property.purchaseDate === null ? 'No purchase date' : 'Not known yet'}
      />
    );
  }
  if (annualisedHidden(property.heldDays)) return <DashWithReason reason={HELD_UNDER_90_DAYS} />;
  return <RatioCell ratio={property.cagrRatio} loss />;
}

function PropertyCard({
  property,
  locked,
  onEdit,
  onValuations,
}: {
  property: PropertyDto;
  locked: boolean;
  onEdit: (property: PropertyDto) => void;
  onValuations: (property: PropertyDto) => void;
}): JSX.Element {
  const hasLoan = property.loanIds.length > 0;
  const items: KeyValueItem[] = [
    {
      label: 'Purchased',
      value: property.purchaseDate ? (
        formatDate(property.purchaseDate)
      ) : (
        <DashWithReason reason="No purchase date" />
      ),
      numeric: true,
    },
    {
      label: 'Primary residence',
      value: property.isPrimaryResidence ? (
        <span className="jf-app-kv-stack">
          <span>Yes</span>
          <span className="jf-app-muted jf-app-small jf-app-text-value">
            {PRIMARY_RESIDENCE_NOTE}
          </span>
        </span>
      ) : (
        'No'
      ),
    },
    {
      label: 'Purchase price',
      value: <MoneyCell cents={property.purchaseValueCents} loss={false} />,
      numeric: true,
    },
    {
      label: 'Value',
      value: (
        <span className="jf-app-kv-stack jf-app-align-end">
          <MoneyCell cents={property.valueCents} loss={false} />
          <span className="jf-app-muted jf-app-small">
            as of {formatDate(property.valuationDate)}
          </span>
        </span>
      ),
      numeric: true,
    },
    {
      label: 'Net rent to date',
      value: <MoneyCell cents={property.netRentToDateCents} loss={false} />,
      numeric: true,
    },
    {
      label: 'Gain',
      value: (
        <span className="jf-app-kv-stack jf-app-align-end">
          <MoneyCell cents={property.gainCents} loss />
          {property.gainRatio !== null ? (
            <span className="jf-app-small">
              <RatioCell ratio={property.gainRatio} loss />
            </span>
          ) : null}
        </span>
      ),
      numeric: true,
    },
    { label: 'Annualised gain', value: annualisedCell(property), numeric: true },
    {
      label: 'Mortgage (net)',
      value: hasLoan ? (
        <MoneyCell cents={property.debtCents} loss={false} />
      ) : (
        <span className="jf-app-muted jf-app-text-value">{NO_MORTGAGE}</span>
      ),
      numeric: hasLoan,
    },
    {
      label: 'Equity',
      value: <MoneyCell cents={property.equityCents} loss />,
      numeric: true,
    },
    {
      label: 'Loan to value',
      value:
        property.lvrRatio === null ? (
          <DashWithReason reason="No value" />
        ) : (
          (percentText(property.lvrRatio) ?? '—')
        ),
      numeric: true,
    },
  ];
  return (
    <Card
      as="section"
      title={property.name}
      subtitle={property.isPrimaryResidence ? 'Primary residence' : 'Property'}
      actions={
        <span className="jf-app-row-actions jf-app-row-actions--wrap">
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            aria-label={`Edit ${property.name}`}
            data-cf-action={propertyActionKey('edit', property.id)}
            onClick={() => onEdit(property)}
            disabled={locked}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={History}
            aria-label={`Valuations of ${property.name}`}
            data-cf-action={propertyActionKey('valuations', property.id)}
            onClick={() => onValuations(property)}
          >
            Valuations
          </Button>
        </span>
      }
    >
      <KeyValueTable caption={`${property.name}: facts`} items={items} />
      {property.note ? <p className="jf-app-meta">{property.note}</p> : null}
    </Card>
  );
}

export interface PropertyCardsProps {
  page: PropertyPageResponse;
  locked: boolean;
  onEdit: (property: PropertyDto) => void;
  onValuations: (property: PropertyDto) => void;
}

export function PropertyCards({
  page,
  locked,
  onEdit,
  onValuations,
}: PropertyCardsProps): JSX.Element {
  const span = page.properties.length === 1 ? 12 : 6;
  return (
    <Grid>
      {page.properties.map((property) => (
        <GridItem key={property.id} span={span}>
          <PropertyCard
            property={property}
            locked={locked}
            onEdit={onEdit}
            onValuations={onValuations}
          />
        </GridItem>
      ))}
    </Grid>
  );
}

// ─── Update values ──────────────────────────────────────────────────────────────────────────────

interface ValueEdit {
  drafts: Readonly<Record<number, number | null>>;
  asOf: string | null;
  pending: boolean;
  onDraft: (id: number, cents: number | null) => void;
}

function valueChanged(edit: ValueEdit, property: PropertyDto): boolean {
  const draft = edit.drafts[property.id];
  return draft !== undefined && draft !== null && draft !== property.valueCents;
}

export function ValuesForm({
  page,
  onDone,
  onCancel,
}: {
  page: PropertyPageResponse;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const { phone, firstMin } = useTableLayout();
  const state = useSharedEntry();
  const save = useSaveValuations();
  const [drafts, setDrafts] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(page.properties.map((p) => [p.id, p.valueCents])),
  );
  const edit: ValueEdit = {
    drafts,
    asOf: state.asOf,
    pending: save.isPending,
    onDraft: (id, cents) => setDrafts((d) => ({ ...d, [id]: cents })),
  };
  const rows = page.properties.filter((p) => valueChanged(edit, p));

  const columns: ColumnTableColumn<PropertyDto>[] = [
    {
      id: 'property',
      header: 'Property',
      value: (p) => p.name,
      cell: (p) => (
        <FirstCell phone={phone} markers={[]}>
          <span>{p.name}</span>
        </FirstCell>
      ),
      minWidth: firstMin(200, 140),
    },
    {
      id: 'value',
      header: 'Value',
      value: (p) => p.valueCents,
      cell: (p) => (
        <span className="jf-app-balance-edit">
          <MoneyField
            label={`Value, ${p.name}`}
            labelHidden
            value={edit.drafts[p.id] ?? null}
            onChange={(cents) => edit.onDraft(p.id, cents)}
            disabled={edit.pending}
          />
          {valueChanged(edit, p) && isOlder(edit.asOf, p.valuationDate) ? (
            <OlderNote text={olderThanLatest('value', p.valuationDate)} />
          ) : null}
        </span>
      ),
      numeric: true,
    },
    {
      id: 'valued',
      header: 'Valued',
      value: (p) => p.valuationDate,
      cell: (p) => formatDate(p.valuationDate),
      numeric: true,
    },
  ];

  const submit = (): boolean => {
    if (!state.asOf) return false;
    save.mutate(
      {
        asOf: state.asOf,
        entries: rows.map((p) => ({
          propertyId: p.id,
          valueCents: drafts[p.id] ?? p.valueCents,
          ...(state.sharedNote ? { note: state.sharedNote } : {}),
        })),
      },
      { onSuccess: () => onDone('Values saved'), onError: state.fail },
    );
    return true;
  };

  return (
    <SharedEntryForm
      label="Update values"
      saveLabel="Save values"
      state={state}
      pristine={rows.length === 0}
      statusLine={
        rows.length === 0
          ? 'Type the new values below; only the properties you change are saved.'
          : `${plural(rows.length, 'value')} changed.`
      }
      workbook={rows.some((p) => p.origin === 'import')}
      pending={save.isPending}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <ColumnTable
        columns={columns}
        rows={page.properties}
        getRowId={(p) => String(p.id)}
        caption={`Property values: ${plural(page.properties.length, 'property', 'properties')}`}
        showCaption
      />
    </SharedEntryForm>
  );
}
