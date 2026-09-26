// The Budget page (stage-3.md §6.5, D53, D54, D61): KPI tiles (left over each month is the teal
// figure), the pay and budget settings, the spending and leftover-split tables, yearly expenses,
// payday transfers and the charts. One inline form is open at a time.
import type { EditableSettingKey } from '@joinr/schema';
import { Button, Callout, PageHeader, SectionBar, formatMoney } from '@joinr/ui';
import { CalendarPlus, Plus } from 'lucide-react';
import type { JSX } from 'react';
import { useBudgetPage } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { LoadError, Loading } from '../../components/QueryStates';
import { missingInputLabel } from '../investments/display';
import { transfersHeading } from '../cashflow/display';
import { SettingsSection } from '../cashflow/SettingsSection';
import { actionSelector, useEditor } from '../cashflow/formState';
import { BudgetCharts } from './BudgetCharts';
import { BudgetItemsSection } from './BudgetItemsSection';
import type { BudgetEditor } from './budgetModel';
import { BudgetTiles } from './BudgetTiles';
import { AutoRowForm, ItemForm } from './ItemForm';
import { TransfersSection } from './TransfersSection';
import { YearlyExpensesSection } from './YearlyExpensesSection';

/** The Budget page's settings (§3.3: the first nine editable keys). */
const BUDGET_SETTING_KEYS: readonly EditableSettingKey[] = [
  'pay.frequency',
  'pay.netPayCents',
  'pay.dayOfMonth',
  'pay.jobStartDate',
  'budget.includeSideIncome',
  'budget.emergencyFundMonths',
  'budget.emergencyFundOverrideCents',
  'budget.autoInvestSplit',
  'budget.useForInvestAmount',
];

const BUDGET_SETTING_LABELS: Partial<Record<EditableSettingKey, string>> = {
  'pay.frequency': 'Pay frequency',
  'pay.netPayCents': 'Net pay per pay',
  'pay.dayOfMonth': 'Pay day (day of the month)',
  'pay.jobStartDate': 'Job start date',
  'budget.includeSideIncome': 'Include side income',
  'budget.emergencyFundMonths': 'Emergency fund (months of spending)',
  'budget.emergencyFundOverrideCents': 'Emergency fund override',
  'budget.autoInvestSplit': 'Automatic investment split',
  'budget.useForInvestAmount': 'Use the budget for the amount to invest',
};

const BUDGET_SETTING_HINTS: Partial<Record<EditableSettingKey, string>> = {
  'pay.dayOfMonth': 'From 1 to 28; 0 when not paid on a fixed day',
  'budget.includeSideIncome': 'Adds the 365-day side-income average to monthly income',
  'budget.emergencyFundOverrideCents': 'Leave empty to use the months of spending',
  'budget.autoInvestSplit': 'Off: you set the investment amount on its row',
};

const BUDGET_SETTING_UNSET: Partial<Record<EditableSettingKey, string>> = {
  'budget.emergencyFundOverrideCents': 'the months of spending are used',
  'budget.includeSideIncome': 'not included',
};

const ADD_ITEM = 'add-budget-item';
const ADD_YEARLY = 'add-yearly-expense';
const EDIT_SETTINGS = 'budget-settings';

export function BudgetPage(): JSX.Element {
  const query = useBudgetPage();
  const page = query.data;
  const editor = useEditor<BudgetEditor>();
  const open = editor.editor;

  const actions = page ? (
    <>
      <Button
        variant="primary"
        icon={Plus}
        data-cf-action={ADD_ITEM}
        onClick={() => editor.open({ form: 'item', opener: actionSelector(ADD_ITEM) })}
      >
        Add item
      </Button>
      <Button
        variant="secondary"
        icon={CalendarPlus}
        data-cf-action={ADD_YEARLY}
        onClick={() => editor.open({ form: 'yearly', opener: actionSelector(ADD_YEARLY) })}
      >
        Add yearly expense
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader title="Budget" subtitle="Cash flow" actions={actions} />
      {query.isPending ? <Loading label="Loading the budget…" /> : null}
      {query.isError ? (
        <LoadError
          title="Could not load the budget"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {page ? (
        <>
          <LiveRegion kind="status" label="Save result">
            {editor.notice ? (
              <Callout kind="note" title="Saved">
                <p>{editor.notice}.</p>
              </Callout>
            ) : null}
          </LiveRegion>
          <BudgetTiles page={page} />
          <SettingsSection
            headingId="budget-settings-heading"
            title="Income and settings"
            role="supporting"
            keys={BUDGET_SETTING_KEYS}
            labels={BUDGET_SETTING_LABELS}
            hints={BUDGET_SETTING_HINTS}
            unset={BUDGET_SETTING_UNSET}
            extras={{
              'budget.includeSideIncome':
                page.summary.sideIncomeAvgCents === null
                  ? 'No side-income average yet'
                  : `365-day side-income average ${formatMoney(page.summary.sideIncomeAvgCents)} a month`,
            }}
            slice={page.settings}
            editing={open?.form === 'settings'}
            actionKey={EDIT_SETTINGS}
            onEdit={() => editor.open({ form: 'settings', opener: actionSelector(EDIT_SETTINGS) })}
            onCancel={editor.close}
            onDone={editor.done}
          >
            {page.missing.length > 0 ? (
              <Callout kind="note" title="Inputs missing">
                <p>The budget needs:</p>
                <ul>
                  {page.missing.map((key) => (
                    <li key={key}>{missingInputLabel(key)}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
          </SettingsSection>
          <section className="jf-app-block" aria-labelledby="budget-items-heading">
            <SectionBar id="budget-items-heading" title="Budget items" role="primary" />
            {open?.form === 'item' ? (
              <ItemForm
                key={open.row ? `item-${open.row.id ?? 'x'}` : 'new-item'}
                page={page}
                row={open.row}
                onDone={editor.done}
                onCancel={editor.close}
              />
            ) : null}
            {open?.form === 'auto' ? (
              <AutoRowForm
                key={`auto-${open.row.kind}`}
                page={page}
                row={open.row}
                onDone={editor.done}
                onCancel={editor.close}
              />
            ) : null}
            <BudgetItemsSection page={page} editor={editor} />
          </section>
          <section className="jf-app-block" aria-labelledby="budget-yearly-heading">
            <SectionBar id="budget-yearly-heading" title="Yearly expenses" role="supporting" />
            <YearlyExpensesSection page={page} editor={editor} />
          </section>
          <section className="jf-app-block" aria-labelledby="budget-transfers-heading">
            <SectionBar
              id="budget-transfers-heading"
              title={transfersHeading(page.summary.payFrequency)}
              role="supporting"
            />
            <TransfersSection page={page} />
          </section>
          <section className="jf-app-block" aria-labelledby="budget-charts-heading">
            <SectionBar id="budget-charts-heading" title="Charts" role="supporting" />
            <BudgetCharts page={page} />
          </section>
        </>
      ) : null}
    </>
  );
}
