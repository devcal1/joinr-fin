// The Property page (stage-4.md §6.5, §6.7–6.9, D66–D68): the KPI tiles, the callouts (estimated
// repayments, an unlinked offset, a loan without a property, a repayment below the interest, a
// missing rate, repayment or compounding), the properties with Update values, the property form and
// the valuations, the mortgages with their facts, balance logs, forms and charts, the value over
// time, and the page's settings. One inline form is open at a time.
import type { EditableSettingKey, LoanDto, PropertyDto, PropertyPageResponse } from '@joinr/schema';
import { Button, Callout, PageHeader, SectionBar } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { Building2, Landmark, Link2, Tags, Wallet } from 'lucide-react';
import { useRef, useState, type JSX } from 'react';
import { usePropertyPage } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { SettingsSection } from '../cashflow/SettingsSection';
import { actionSelector, useEditor, type EditorState } from '../cashflow/formState';
import { LoanBalancesForm } from './LoanBalancesForm';
import { LoanCard } from './LoanCard';
import { LoanEntryForm } from './LoanEntryForm';
import { LoanForm } from './LoanForm';
import { OffsetsForm } from './OffsetsForm';
import { PropertyCards, ValuesForm } from './PropertiesSection';
import { PropertyCharts } from './PropertyCharts';
import { PropertyForm } from './PropertyForm';
import { PropertyTiles } from './PropertyTiles';
import {
  DEFAULT_REPAYMENTS_NOTE,
  NO_LOANS,
  NO_PROPERTIES,
  PAYMENT_BELOW_INTEREST_NOTE,
  PROPERTY_SETTING_KEYS,
  anyDefaultRepayments,
  loanActionKey,
  loanEntryActionKey,
  loansWithoutPropertyText,
  missingFieldTexts,
  propertyActionKey,
  unlinkedOffsetText,
  unlinkedOffsets,
  type PropertyEditor,
} from './propertyText';
import { ValuationHistory } from './ValuationHistory';

const SETTING_UNSET: Partial<Record<EditableSettingKey, string>> = {
  'savings.includeMortgagePrincipal': 'counted (Yes)',
  'property.offsetsIncludeEmergencyFund': 'not counted (No)',
};

const UPDATE_BALANCES = 'property-update-balances';
const UPDATE_VALUES = 'property-update-values';
const ADD_PROPERTY = 'property-add';
const ADD_LOAN = 'property-add-loan';
const EDIT_SETTINGS = 'property-settings';
const LINK_OFFSET = 'property-link-offset';

export function PropertyPage(): JSX.Element {
  const query = usePropertyPage();
  const page = query.data;
  const editor = useEditor<PropertyEditor>();
  const open = editor.editor;

  const actions = page ? (
    <>
      {page.loans.length > 0 ? (
        <Button
          variant="primary"
          icon={Wallet}
          data-cf-action={UPDATE_BALANCES}
          onClick={() =>
            editor.open({ form: 'loanBalances', opener: actionSelector(UPDATE_BALANCES) })
          }
          disabled={open?.form === 'loanBalances'}
        >
          Update balances
        </Button>
      ) : null}
      {page.properties.length > 0 ? (
        <Button
          variant="secondary"
          icon={Tags}
          data-cf-action={UPDATE_VALUES}
          onClick={() => editor.open({ form: 'values', opener: actionSelector(UPDATE_VALUES) })}
          disabled={open?.form === 'values'}
        >
          Update values
        </Button>
      ) : null}
      <Button
        variant="secondary"
        icon={Building2}
        data-cf-action={ADD_PROPERTY}
        onClick={() => editor.open({ form: 'property', opener: actionSelector(ADD_PROPERTY) })}
      >
        Add property
      </Button>
      <Button
        variant="secondary"
        icon={Landmark}
        data-cf-action={ADD_LOAN}
        onClick={() => editor.open({ form: 'loan', opener: actionSelector(ADD_LOAN) })}
        disabled={page.properties.length === 0}
      >
        Add loan
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader title="Property" subtitle="Assets" actions={actions} />
      <QueryStates
        query={query}
        loading="Loading property…"
        layout="dashboard"
        errorTitle="Could not load property"
      />
      {page ? <PropertyContent page={page} editor={editor} /> : null}
    </>
  );
}

function PropertyCallouts({
  page,
  onLink,
}: {
  page: PropertyPageResponse;
  onLink: (() => void) | null;
}): JSX.Element {
  const unlinked = unlinkedOffsets(page);
  const withoutProperty = page.loans.filter((l) => l.propertyId === null);
  const belowInterest = page.loans.filter((l) => l.flags.includes('payment_below_interest'));
  const missing = missingFieldTexts(page.loans);
  return (
    <>
      {belowInterest.length > 0 ? (
        <Callout kind="important" title="Repayment below the interest">
          <p>
            {belowInterest.length === 1
              ? PAYMENT_BELOW_INTEREST_NOTE
              : `${belowInterest.map((l) => l.name).join(', ')}: ${PAYMENT_BELOW_INTEREST_NOTE.toLowerCase()}`}
          </p>
        </Callout>
      ) : null}
      {anyDefaultRepayments(page) ? (
        <Callout kind="note" title="Estimated repayments">
          <p>{DEFAULT_REPAYMENTS_NOTE}</p>
        </Callout>
      ) : null}
      {unlinked.length > 0 ? (
        <Callout kind="note" title="Offset not linked">
          <p>{unlinkedOffsetText(unlinked.length)}</p>
          {onLink ? (
            <p>
              <Button
                variant="secondary"
                size="sm"
                icon={Link2}
                data-cf-action={LINK_OFFSET}
                onClick={onLink}
              >
                Link
              </Button>
            </p>
          ) : (
            <p>Add a loan to link it to.</p>
          )}
        </Callout>
      ) : null}
      {withoutProperty.length > 0 ? (
        <Callout kind="note" title="Loans without a property">
          <p>{loansWithoutPropertyText(withoutProperty.length)}</p>
        </Callout>
      ) : null}
      {missing.length > 0 ? (
        <Callout kind="note" title="Loan details missing">
          {missing.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </Callout>
      ) : null}
    </>
  );
}

function PropertyContent({
  page,
  editor,
}: {
  page: PropertyPageResponse;
  editor: EditorState<PropertyEditor>;
}): JSX.Element {
  const open = editor.editor;
  const locked = open !== null;
  const [valuationsId, setValuationsId] = useState<number | null>(null);
  // A read-only action's announcement (UX-18): a hidden live region, never the "Saved" callout.
  const [navNotice, setNavNotice] = useState<string | null>(null);
  const valuationsRef = useRef<HTMLDivElement>(null);
  const linkTarget: LoanDto | undefined =
    page.loans.find((l) => l.propertyId !== null) ?? page.loans[0];

  // Valuations (UX-18): choose the property, scroll the card in, focus its heading, announce it.
  const showValuations = (property: PropertyDto): void => {
    setValuationsId(property.id);
    const card = valuationsRef.current;
    card?.scrollIntoView?.({ block: 'nearest' });
    const heading = card?.querySelector<HTMLElement>('h3');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
    setNavNotice(`Showing ${property.name} valuations`);
  };

  const loanForms = (loan: LoanDto): JSX.Element | null => {
    if (open?.form === 'loan' && open.loan?.id === loan.id) {
      return (
        <LoanForm
          key={`loan-${loan.id}`}
          page={page}
          loan={loan}
          onDone={editor.done}
          onCancel={editor.close}
        />
      );
    }
    if (open?.form === 'loanEntry' && open.loan.id === loan.id) {
      return (
        <LoanEntryForm
          key={open.entry ? `entry-${open.entry.id ?? 'start'}` : `new-entry-${loan.id}`}
          page={page}
          loan={loan}
          entry={open.entry}
          onDone={editor.done}
          onCancel={editor.close}
        />
      );
    }
    if (open?.form === 'offsets' && open.loan.id === loan.id) {
      return (
        <OffsetsForm
          key={`offsets-${loan.id}`}
          page={page}
          loan={loan}
          onDone={editor.done}
          onCancel={editor.close}
        />
      );
    }
    return null;
  };

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
      <PropertyTiles page={page} />
      <PropertyCallouts
        page={page}
        onLink={
          linkTarget
            ? () =>
                editor.open({
                  form: 'offsets',
                  loan: linkTarget,
                  opener: actionSelector(LINK_OFFSET),
                })
            : null
        }
      />

      <section className="jf-app-block" aria-labelledby="property-properties-heading">
        <SectionBar id="property-properties-heading" title="Properties" role="primary" />
        {open?.form === 'property' ? (
          <PropertyForm
            key={open.property ? `property-${open.property.id}` : 'new-property'}
            property={open.property}
            onDone={editor.done}
            onCancel={editor.close}
          />
        ) : null}
        {open?.form === 'values' ? (
          <ValuesForm page={page} onDone={editor.done} onCancel={editor.close} />
        ) : null}
        {page.properties.length === 0 ? (
          <Callout kind="note" title="No properties">
            <p>
              {NO_PROPERTIES} Add one, or import the workbook on the{' '}
              <Link to="/import">Import page</Link>.
            </p>
          </Callout>
        ) : (
          <>
            <PropertyCards
              page={page}
              locked={locked}
              onEdit={(property) =>
                editor.open({
                  form: 'property',
                  property,
                  opener: actionSelector(propertyActionKey('edit', property.id)),
                })
              }
              onValuations={showValuations}
            />
            <div ref={valuationsRef}>
              <ValuationHistory
                page={page}
                propertyId={valuationsId}
                onPropertyChange={setValuationsId}
                onDeleted={editor.announce}
              />
            </div>
          </>
        )}
      </section>

      <section className="jf-app-block" aria-labelledby="property-mortgages-heading">
        <SectionBar id="property-mortgages-heading" title="Mortgages" role="primary" />
        {open?.form === 'loan' && !open.loan ? (
          <LoanForm key="new-loan" page={page} onDone={editor.done} onCancel={editor.close} />
        ) : null}
        {open?.form === 'loanBalances' ? (
          <LoanBalancesForm page={page} onDone={editor.done} onCancel={editor.close} />
        ) : null}
        {page.loans.length === 0 ? (
          <Callout kind="note" title="No loans">
            <p>{NO_LOANS}</p>
          </Callout>
        ) : (
          page.loans.map((loan) => (
            <LoanCard
              key={loan.id}
              page={page}
              loan={loan}
              locked={locked}
              onEdit={(l) =>
                editor.open({
                  form: 'loan',
                  loan: l,
                  opener: actionSelector(loanActionKey('edit', l.id)),
                })
              }
              onUpdate={(l) =>
                editor.open({
                  form: 'loanEntry',
                  loan: l,
                  opener: actionSelector(loanActionKey('update', l.id)),
                })
              }
              onOffsets={(l) =>
                editor.open({
                  form: 'offsets',
                  loan: l,
                  opener: actionSelector(loanActionKey('offsets', l.id)),
                })
              }
              onEditEntry={(l, entry) =>
                editor.open({
                  form: 'loanEntry',
                  loan: l,
                  entry,
                  opener: actionSelector(loanEntryActionKey('edit', entry.id ?? 0)),
                })
              }
              onDeleted={editor.announce}
            >
              {loanForms(loan)}
            </LoanCard>
          ))
        )}
      </section>

      <section className="jf-app-block" aria-labelledby="property-history-heading">
        <SectionBar id="property-history-heading" title="Value over time" role="supporting" />
        <PropertyCharts points={page.charts.points} hasOffsets={page.totals.offsetCents > 0} />
      </section>

      <SettingsSection
        headingId="property-settings-heading"
        title="Settings for this page"
        role="reference"
        keys={PROPERTY_SETTING_KEYS}
        unset={SETTING_UNSET}
        hints={{
          'property.offsetsIncludeEmergencyFund': 'Also on the Cash page',
          'savings.includeMortgagePrincipal': 'Also on the Cash page',
        }}
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
