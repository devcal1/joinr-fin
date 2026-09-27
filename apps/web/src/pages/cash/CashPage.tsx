// The Cash page (stage-3.md §6.3, §6.8–6.10): the KPI tiles, the accounts by kind with balance
// updates and history, savings by period (adjusted or raw), the cash target, the end-of-year goal
// and the savings goals, and the page's settings. One inline form is open at a time.
import type { EditableSettingKey } from '@joinr/schema';
import { Button, Callout, PageHeader, SectionBar } from '@joinr/ui';
import { Plus, Target, Wallet } from 'lucide-react';
import type { JSX } from 'react';
import { useCashPage } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { SettingsSection } from '../cashflow/SettingsSection';
import { actionSelector, useEditor } from '../cashflow/formState';
import { AccountForm } from './AccountForm';
import { AccountsSection } from './AccountsSection';
import { CashTiles } from './CashTiles';
import { isFormOpen, type CashEditor } from './cashEditor';
import { accountActionKey } from './cashText';
import { GoalsSection } from './GoalsSection';
import { SavingsSection } from './SavingsSection';

/** The Cash page's settings, in the order §6.3 item 6 lists them. */
const CASH_SETTING_KEYS: readonly EditableSettingKey[] = [
  'savings.yearBasis',
  'savings.includeMortgagePrincipal',
  'property.offsetsIncludeEmergencyFund',
  'goals.cashSavingsTargetCents',
  'goals.eoyCashGoalCents',
  'goals.houseDepositInvestmentShare',
];

const CASH_SETTING_HINTS: Partial<Record<EditableSettingKey, string>> = {
  'savings.yearBasis':
    'The year of the cash figures. Only this app uses it: kept when you re-import.',
  'goals.houseDepositInvestmentShare': 'The share of investments counted as saved toward goals',
};

const CASH_SETTING_UNSET: Partial<Record<EditableSettingKey, string>> = {
  'savings.includeMortgagePrincipal': 'counted (Yes)',
  'property.offsetsIncludeEmergencyFund': 'not counted (No)',
  'goals.houseDepositInvestmentShare': '0%',
};

const UPDATE_BALANCES = 'update-balances';
const ADD_ACCOUNT = 'add-account';
const ADD_GOAL = 'add-goal';
const EDIT_SETTINGS = 'cash-settings';

export function CashPage(): JSX.Element {
  const query = useCashPage();
  const page = query.data;
  const editor = useEditor<CashEditor>();
  const open = editor.editor;

  const actions = page ? (
    <>
      {page.accounts.length > 0 ? (
        <Button
          variant="primary"
          icon={Wallet}
          data-cf-action={UPDATE_BALANCES}
          onClick={() => editor.open({ form: 'balances', opener: actionSelector(UPDATE_BALANCES) })}
          disabled={open?.form === 'balances'}
        >
          Update balances
        </Button>
      ) : null}
      <Button
        variant="secondary"
        icon={Plus}
        data-cf-action={ADD_ACCOUNT}
        onClick={() => editor.open({ form: 'account', opener: actionSelector(ADD_ACCOUNT) })}
      >
        Add account
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader title="Cash" subtitle="Cash flow" actions={actions} />
      <QueryStates
        query={query}
        loading="Loading cash…"
        layout="dashboard"
        errorTitle="Could not load the cash page"
      />
      {page ? (
        <>
          <LiveRegion kind="status" label="Save result">
            {editor.notice ? (
              <Callout kind="note" title="Saved">
                <p>{editor.notice}.</p>
              </Callout>
            ) : null}
          </LiveRegion>
          <CashTiles page={page} />
          <section className="jf-app-block" aria-labelledby="cash-accounts-heading">
            <SectionBar id="cash-accounts-heading" title="Accounts" role="primary" />
            {open?.form === 'account' ? (
              <AccountForm
                key={open.account ? `account-${open.account.id}` : 'new-account'}
                account={open.account}
                historyBeforeLastRun={
                  open.account !== undefined &&
                  page.lastRun !== null &&
                  page.entries.some(
                    (e) =>
                      e.accountId === open.account?.id &&
                      page.lastRun !== null &&
                      e.asOf <= page.lastRun,
                  )
                }
                onDone={editor.done}
                onCancel={editor.close}
              />
            ) : null}
            <AccountsSection
              page={page}
              editingBalances={open?.form === 'balances'}
              locked={isFormOpen(open)}
              onEditAccount={(account) =>
                editor.open({
                  form: 'account',
                  account,
                  opener: actionSelector(accountActionKey('edit', account.id)),
                })
              }
              onBalancesDone={editor.done}
              onBalancesCancel={editor.close}
            />
          </section>
          <section className="jf-app-block" aria-labelledby="cash-savings-heading">
            <SectionBar id="cash-savings-heading" title="Savings" role="supporting" />
            <SavingsSection page={page} editor={editor} />
          </section>
          <section className="jf-app-block" aria-labelledby="cash-goals-heading">
            <SectionBar
              id="cash-goals-heading"
              title="Goals"
              role="supporting"
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Target}
                  data-cf-action={ADD_GOAL}
                  onClick={() => editor.open({ form: 'goal', opener: actionSelector(ADD_GOAL) })}
                  disabled={open?.form === 'goal'}
                >
                  Add goal
                </Button>
              }
            />
            <GoalsSection page={page} editor={editor} />
          </section>
          <SettingsSection
            headingId="cash-settings-heading"
            title="Settings for this page"
            role="reference"
            keys={CASH_SETTING_KEYS}
            hints={CASH_SETTING_HINTS}
            unset={CASH_SETTING_UNSET}
            slice={page.settings}
            editing={open?.form === 'settings'}
            actionKey={EDIT_SETTINGS}
            onEdit={() => editor.open({ form: 'settings', opener: actionSelector(EDIT_SETTINGS) })}
            onCancel={editor.close}
            onDone={editor.done}
          />
        </>
      ) : null}
    </>
  );
}
