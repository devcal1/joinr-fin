// The Super page (stage-4.md §6.4, §6.7–6.9, D69–D71, D75): the KPI tiles, the flag callouts (the
// SG-fund choice is import-safe), the funds with Update balances, the fund form and the balance
// history, the contributions (the cap meters, the table, the form, employer SG by month and the
// statement form), the performance periods with their charts and option notes, and the page's
// settings. One inline form is open at a time.
import {
  SUPER_SG_RATE_DEFAULT,
  type EditableSettingKey,
  type SuperFundDto,
  type SuperPageResponse,
} from '@joinr/schema';
import {
  Button,
  Callout,
  PageHeader,
  SectionBar,
  formatFinancialYear,
  formatMoney,
} from '@joinr/ui';
import { Plus, PiggyBank, Wallet } from 'lucide-react';
import { useRef, useState, type JSX } from 'react';
import { useSuperPage } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { LoadError, Loading } from '../../components/QueryStates';
import { SettingsSection } from '../cashflow/SettingsSection';
import { actionSelector, useEditor, type EditorState } from '../cashflow/formState';
import { NO_HISTORY_NOTE, PROVISIONAL_NOTE, formatRate } from '../assets/display';
import { CapSection } from './CapSection';
import { ContributionForm } from './ContributionForm';
import { ContributionsTable } from './ContributionsTable';
import { FundForm } from './FundForm';
import { FundHistory } from './FundHistory';
import { FundsSection } from './FundsSection';
import { OptionNoteForm, OptionNotes, PeriodsTable } from './PerformanceSection';
import { SgFundPicker } from './SgFundPicker';
import { SgMonthsTable, StatementForm } from './SgMonthsTable';
import { SuperCharts } from './SuperCharts';
import { SuperTiles } from './SuperTiles';
import {
  GAINS_FOOTNOTE,
  NOT_UPDATED_NOTE,
  NO_FUNDS,
  NO_MARGINAL_RATE,
  NO_SALARY,
  NO_SG_FUND,
  RETURN_FOOTNOTE,
  SUPER_SETTING_KEYS,
  contributionActionKey,
  fundActionKey,
  entryActionKey,
  importedText,
  noteActionKey,
  sgActionKey,
  type SuperEditor,
} from './superText';

const SETTING_LABELS: Partial<Record<EditableSettingKey, string>> = {
  'pay.grossAnnualSalaryCents': 'Gross annual salary',
  'tax.marginalRate': 'Marginal tax rate',
  'pay.jobStartDate': 'Job start date',
  'super.sgRate': 'Your employer’s SG rate',
  'super.contributionsTaxRate': 'Contributions tax',
  'super.concessionalCapCents': 'Concessional cap override (this financial year only)',
  'super.importedContributionType': 'Imported contributions are',
};

const APP_ONLY_HINT = 'Only this app uses it: kept when you re-import.';

const SETTING_HINTS: Partial<Record<EditableSettingKey, string>> = {
  'pay.grossAnnualSalaryCents': 'Before tax; the SG estimate uses it',
  'tax.marginalRate': 'Your top rate, e.g. 30',
  'pay.jobStartDate': 'No SG is estimated before it (also on the Budget page)',
  'super.sgRate': `Blank: the legal minimum for each financial year. ${APP_ONLY_HINT}`,
  'super.contributionsTaxRate': APP_ONLY_HINT,
  'super.concessionalCapCents': `Blank: the ATO figure. ${APP_ONLY_HINT}`,
  'super.importedContributionType': APP_ONLY_HINT,
};

const UPDATE_BALANCES = 'super-update-balances';
const ADD_CONTRIBUTION = 'super-add-contribution';
const ADD_FUND = 'super-add-fund';
const EDIT_SETTINGS = 'super-settings';

export function SuperPage(): JSX.Element {
  const query = useSuperPage();
  const page = query.data;
  const editor = useEditor<SuperEditor>();
  const open = editor.editor;
  const held = page?.funds.filter((f) => !f.archived) ?? [];

  const actions = page ? (
    <>
      {held.length > 0 ? (
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
        icon={PiggyBank}
        data-cf-action={ADD_CONTRIBUTION}
        onClick={() =>
          editor.open({ form: 'contribution', opener: actionSelector(ADD_CONTRIBUTION) })
        }
      >
        Add contribution
      </Button>
      <Button
        variant="secondary"
        icon={Plus}
        data-cf-action={ADD_FUND}
        onClick={() => editor.open({ form: 'fund', opener: actionSelector(ADD_FUND) })}
      >
        Add fund
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader title="Super" subtitle="Assets" actions={actions} />
      {query.isPending ? <Loading label="Loading super…" /> : null}
      {query.isError ? (
        <LoadError
          title="Could not load super"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {page ? <SuperContent page={page} editor={editor} /> : null}
    </>
  );
}

/** The flag callouts (§6.4 item 3). */
function SuperCallouts({
  page,
  onDone,
}: {
  page: SuperPageResponse;
  onDone: (message: string) => void;
}): JSX.Element {
  const has = (flag: SuperPageResponse['flags'][number]): boolean => page.flags.includes(flag);
  return (
    <>
      {has('no_salary') ? (
        <Callout kind="important" title="No salary">
          <p>{NO_SALARY}</p>
        </Callout>
      ) : null}
      {has('no_sg_fund') ? (
        <Callout kind="note" title="SG fund">
          <p>{NO_SG_FUND}</p>
          <SgFundPicker funds={page.funds} onDone={onDone} showNote />
        </Callout>
      ) : null}
      {has('no_marginal_rate') ? (
        <Callout kind="important" title="No marginal tax rate">
          <p>{NO_MARGINAL_RATE}</p>
        </Callout>
      ) : null}
      {has('imported_estimates') ? (
        <Callout kind="note" title="Imported contributions">
          <p>{importedText(page)}</p>
        </Callout>
      ) : null}
      {has('balances_not_updated') ? (
        <Callout kind="note" title="Balances not updated">
          <p>{NOT_UPDATED_NOTE}</p>
        </Callout>
      ) : null}
    </>
  );
}

/** This FY's statutory cap (an FY after the table uses its last entry), or null. */
function statutoryCapOf(page: SuperPageResponse): number | null {
  const year = page.capYears[0];
  if (!year) return null;
  return (
    page.statutory.caps.find((c) => c.financialYear === year.financialYear)?.capCents ??
    page.statutory.caps.at(-1)?.capCents ??
    null
  );
}

/**
 * "Legal minimum 12" and "ATO 32,500" (the settings form's placeholders, §6.4 item 7): the fields
 * already show their "%" suffix and "$" prefix, so the placeholders leave them out.
 */
function settingPlaceholders(page: SuperPageResponse): Partial<Record<EditableSettingKey, string>> {
  const statutoryCap = statutoryCapOf(page);
  const rate = (formatRate(SUPER_SG_RATE_DEFAULT) ?? '12%').replace(/%$/, '');
  return {
    'super.sgRate': `Legal minimum ${rate}`,
    ...(statutoryCap !== null
      ? {
          'super.concessionalCapCents': `ATO ${formatMoney(statutoryCap, { wholeDollars: true }).replace(/^\$/, '')}`,
        }
      : {}),
  };
}

function SuperContent({
  page,
  editor,
}: {
  page: SuperPageResponse;
  editor: EditorState<SuperEditor>;
}): JSX.Element {
  const open = editor.editor;
  const locked = open !== null;
  const [historyFundId, setHistoryFundId] = useState<number | null>(null);
  // A read-only action's announcement (UX-18): a hidden live region, never the "Saved" callout.
  const [navNotice, setNavNotice] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const placeholders = settingPlaceholders(page);
  const statutoryCap = statutoryCapOf(page);

  // Balance history (UX-18): choose the fund, scroll the card in, focus its heading, announce it.
  const showHistory = (fund: SuperFundDto): void => {
    setHistoryFundId(fund.id);
    const card = historyRef.current;
    card?.scrollIntoView?.({ block: 'nearest' });
    const heading = card?.querySelector<HTMLElement>('h3');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
    setNavNotice(`Showing ${fund.name} balance history`);
  };

  const hasFunds = page.funds.length > 0;
  const capOverride = page.capOverride;

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
      <SuperTiles page={page} />
      <SuperCallouts page={page} onDone={editor.announce} />

      <section className="jf-app-block" aria-labelledby="super-funds-heading">
        <SectionBar
          id="super-funds-heading"
          title="Funds"
          role="primary"
          actions={
            hasFunds ? (
              <SgFundPicker funds={page.funds} label="SG fund" onDone={editor.announce} />
            ) : undefined
          }
        />
        {open?.form === 'fund' ? (
          <FundForm
            key={open.fund ? `fund-${open.fund.id}` : 'new-fund'}
            fund={open.fund}
            lastRun={page.lastRun}
            onDone={editor.done}
            onCancel={editor.close}
          />
        ) : null}
        {hasFunds ? (
          <>
            <FundsSection
              page={page}
              editingBalances={open?.form === 'balances'}
              locked={locked}
              onEdit={(fund) =>
                editor.open({
                  form: 'fund',
                  fund,
                  opener: actionSelector(fundActionKey('edit', fund.id)),
                })
              }
              onHistory={showHistory}
              onBalancesDone={editor.done}
              onBalancesCancel={editor.close}
            />
            <div ref={historyRef}>
              <FundHistory
                page={page}
                fundId={historyFundId}
                onFundChange={setHistoryFundId}
                editingEntry={open?.form === 'entry' ? open.entry : null}
                locked={locked}
                onEditEntry={(entry) =>
                  editor.open({
                    form: 'entry',
                    entry,
                    opener: actionSelector(entryActionKey('edit', entry.id)),
                  })
                }
                onEntryDone={editor.done}
                onEntryCancel={editor.close}
                onDeleted={editor.announce}
              />
            </div>
          </>
        ) : (
          <Callout kind="note" title="No funds">
            <p>{NO_FUNDS}</p>
          </Callout>
        )}
      </section>

      <section className="jf-app-block" aria-labelledby="super-contributions-heading">
        <SectionBar id="super-contributions-heading" title="Contributions" role="supporting" />
        <CapSection page={page} />
        {open?.form === 'contribution' ? (
          <ContributionForm
            key={open.contribution ? `contribution-${open.contribution.id}` : 'new-contribution'}
            page={page}
            contribution={open.contribution}
            onDone={editor.done}
            onCancel={editor.close}
          />
        ) : null}
        <ContributionsTable
          page={page}
          locked={locked}
          onEdit={(contribution) =>
            editor.open({
              form: 'contribution',
              contribution,
              opener: actionSelector(contributionActionKey('edit', contribution.id)),
            })
          }
          onDeleted={editor.announce}
        />
        <div className="jf-app-block" aria-labelledby="super-sg-heading" role="group">
          <h3 id="super-sg-heading" className="jf-app-subhead__title">
            Employer SG
          </h3>
          {open?.form === 'statement' ? (
            <StatementForm
              key={open.month.month}
              month={open.month}
              onDone={editor.done}
              onCancel={editor.close}
            />
          ) : null}
          <SgMonthsTable
            page={page}
            locked={locked}
            onStatement={(month) =>
              editor.open({
                form: 'statement',
                month,
                opener: actionSelector(sgActionKey('statement', month.month)),
              })
            }
            onRemoved={editor.announce}
          />
        </div>
      </section>

      <section className="jf-app-block" aria-labelledby="super-performance-heading">
        <SectionBar id="super-performance-heading" title="Performance" role="supporting" />
        {open?.form === 'note' ? (
          <OptionNoteForm
            key={open.periodMonth ?? 'new-note'}
            page={page}
            periodMonth={open.periodMonth}
            onDone={editor.done}
            onCancel={editor.close}
          />
        ) : null}
        {page.periods.length === 0 ? (
          <Callout kind="note" title="No recorded months">
            <p>{NO_HISTORY_NOTE}</p>
          </Callout>
        ) : (
          <PeriodsTable
            page={page}
            locked={locked}
            onNote={(period) =>
              editor.open({
                form: 'note',
                periodMonth: period.periodMonth,
                opener: actionSelector(noteActionKey(period.periodMonth)),
              })
            }
          />
        )}
        <div className="jf-app-footnotes">
          <p className="jf-app-meta">{GAINS_FOOTNOTE}</p>
          <p className="jf-app-meta">{RETURN_FOOTNOTE}</p>
          <p className="jf-app-meta">{PROVISIONAL_NOTE}</p>
        </div>
        <SuperCharts points={page.charts.points} />
        <OptionNotes
          page={page}
          locked={locked}
          onAdd={() => editor.open({ form: 'note', opener: actionSelector('super-note-add') })}
          onEdit={(note) =>
            editor.open({
              form: 'note',
              periodMonth: note.periodMonth,
              note,
              opener: actionSelector(noteActionKey(`list-${note.periodMonth}`)),
            })
          }
        />
      </section>

      <SettingsSection
        headingId="super-settings-heading"
        title="Settings for this page"
        role="reference"
        keys={SUPER_SETTING_KEYS}
        labels={SETTING_LABELS}
        hints={SETTING_HINTS}
        placeholders={placeholders}
        unset={{
          'super.sgRate': `the legal minimum (${formatRate(page.statutory.sgRatio) ?? ''} this month)`,
          'super.concessionalCapCents':
            statutoryCap === null
              ? 'the ATO figure'
              : `the ATO figure (${formatMoney(statutoryCap, { wholeDollars: true })})`,
          'tax.marginalRate': 'take-home costs are not shown',
          'pay.grossAnnualSalaryCents': 'no SG estimate',
        }}
        extras={
          capOverride
            ? {
                'super.concessionalCapCents': `Set for ${formatFinancialYear(capOverride.financialYear)}`,
              }
            : undefined
        }
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
